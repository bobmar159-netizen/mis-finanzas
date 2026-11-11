'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFinancialCoach, normalizeTransactions } = require('../lib/yarbi-financial-coach');

const NOW = Date.parse('2026-11-10T15:00:00.000Z');

test('Financial Coach separates recorded cash from receivables, commitments and duplicate movements', () => {
  const result = buildFinancialCoach({
    now:NOW,
    transactions:[
      { id:'income-1', type:'ingreso', amount:700, date:'2026-11-10', negocio:true },
      { id:'expense-1', type:'egreso', amount:180, date:'2026-11-10', negocio:true },
      { id:'income-1', type:'ingreso', amount:700, date:'2026-11-10', negocio:true },
      { id:'personal', type:'ingreso', amount:999, date:'2026-11-10', negocio:false },
      { id:'stock-use', type:'egreso', amount:90, date:'2026-11-10', negocio:true, materialUsoServicio:true }
    ],
    receivables:[{ id:'pending-1', balance_amount:300, status:'partial' }],
    commitments:[{ id:'fixed-1', amount:80, paid:false }]
  });
  assert.equal(result.summary.collected_cash_today, 700);
  assert.equal(result.summary.operating_expenses_today, 180);
  assert.equal(result.summary.free_cash_today, 520);
  assert.equal(result.summary.pending_receivables, 300);
  assert.equal(result.summary.projected_free_after_known_commitments, 440);
  assert.equal(result.summary.quote_or_receivable_is_not_cash, true);
  assert.equal(result.quality.duplicate_transactions, 1);
  assert.equal(result.recommendations.some(row => row.kind === 'daily_goal_met'), true);
});

test('Financial Coach refuses malformed or conflicting rows instead of manufacturing a cash total', () => {
  const normalized = normalizeTransactions([
    { id:'same', type:'ingreso', amount:50, date:'2026-11-10' },
    { id:'same', type:'egreso', amount:50, date:'2026-11-10' },
    { id:'bad-amount', type:'ingreso', amount:'n/a', date:'2026-11-10' },
    { id:'bad-date', type:'ingreso', amount:100, date:'not-a-date' }
  ]);
  assert.equal(normalized.rows.length, 1);
  assert.equal(normalized.conflicts, 1);
  assert.equal(normalized.invalid, 2);
  const result = buildFinancialCoach({ now:NOW, transactions:null, receivables:null, commitments:null });
  assert.equal(result.source_status.transactions, 'unavailable');
  assert.equal(result.summary.collected_cash_today, 0);
  assert.equal(result.recommendations[0].kind, 'source_unavailable');
});

test('Financial Coach is deterministic, read-only and performs no network or commercial operation', () => {
  const input = { now:NOW, transactions:[{ id:'a', type:'ingreso', amount:300, date:'2026-11-10' }], policy:{ daily_free_cash_goal:500 } };
  const before = JSON.stringify(input);
  const first = buildFinancialCoach(input);
  const second = buildFinancialCoach(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(first, second);
  assert.equal(first.execute, false);
  const fs = require('node:fs');
  assert.equal(/fetch\s*\(|supabase|whatsapp|gemini|notion|calendar/i.test(fs.readFileSync(require.resolve('../lib/yarbi-financial-coach'), 'utf8')), false);
});

test('Financial Coach projects only from recorded cash and labels the elapsed-days basis', () => {
  const result = buildFinancialCoach({
    now:Date.parse('2026-11-10T15:00:00Z'),
    transactions:[
      { id:'income-1', type:'ingreso', amount:1000, date:'2026-11-01' },
      { id:'expense-1', type:'egreso', amount:200, date:'2026-11-03' }
    ],
    receivables:[{ id:'pending', balance_amount:900 }], commitments:[]
  });
  assert.equal(result.summary.average_free_cash_per_elapsed_day, 80);
  assert.equal(result.summary.projected_free_cash_month, 2400);
  assert.equal(result.summary.monthly_projection_status, 'estimated_elapsed_days');
  assert.equal(result.summary.monthly_projection_excludes_receivables, true);
  assert.ok(result.recommendations.some(item => item.kind === 'monthly_projection'));
});

test('Financial Coach exposes only a dated and recorded upcoming commitment', () => {
  const result = buildFinancialCoach({
    now:NOW,
    transactions:[], receivables:[],
    commitments:[
      { id:'later', amount:900, next_due_amount:100, due_at:'2026-11-28' },
      { id:'first', amount:300, next_due_amount:75, due_at:'2026-11-13' },
      { id:'no-date', amount:120 }
    ]
  });
  assert.deepEqual(result.summary.next_known_commitment, { due_at:'2026-11-13', scheduled_amount:75, status:'scheduled' });
  assert.equal(result.recommendations.some(row => row.kind === 'next_commitment'), true);
});

test('Financial Coach aggregates a service only from structured service-linked collections', () => {
  const result = buildFinancialCoach({
    now:NOW,
    transactions:[
      { id:'linked-1', type:'ingreso', amount:400, date:'2026-11-06', vinculadoServicioId:'svc-1', category:'Instalación nueva' },
      { id:'linked-2', type:'ingreso', amount:200, date:'2026-11-07', service:'Instalación nueva' },
      { id:'text-only', type:'ingreso', amount:999, date:'2026-11-08', description:'instalación' },
      { id:'other-month', type:'ingreso', amount:500, date:'2026-10-30', service:'Instalación nueva' }
    ], receivables:[], commitments:[]
  });
  assert.deepEqual(result.summary.collected_by_service_month, [{ service:'Instalación nueva', collected:600 }]);
});
