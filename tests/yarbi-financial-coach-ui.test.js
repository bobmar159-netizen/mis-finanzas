'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const coach = require('../lib/yarbi-financial-coach');

function uiWith(input) {
  const window = { YarbiFinancialCoach:coach, gfcGetFinancialCoachInput:() => input };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-financial-coach-ui.js'), 'utf8'), { window, Number, String, Intl });
  return window;
}

test('Financial Coach chat replies locally without treating receivables as cash', () => {
  const window = uiWith({
    now:Date.parse('2026-11-10T15:00:00Z'),
    transactions:[{ id:'income', type:'ingreso', amount:380, date:'2026-11-10' }],
    receivables:[{ id:'receivable', balance_amount:220 }],
    commitments:[]
  });
  const response = window.gfcTryFinancialCoachMessage('¿Cómo va mi caja y cuánto tengo por cobrar?');
  assert.equal(response.handled, true);
  assert.match(response.reply, /S\/ 220\.00/);
  assert.match(response.reply, /separado de la caja/i);
  assert.equal(window.gfcTryFinancialCoachMessage('¿Qué pasó con Carlos?'), null);
});

test('Financial Coach distinguishes an elapsed-days projection from a promised collection', () => {
  const window = uiWith({
    now:Date.parse('2026-11-10T15:00:00Z'),
    transactions:[{ id:'income', type:'ingreso', amount:1000, date:'2026-11-01' }],
    receivables:[{ id:'receivable', balance_amount:220 }], commitments:[]
  });
  const response = window.gfcTryFinancialCoachMessage('¿Cuál es la proyección para este mes?');
  assert.equal(response.handled, true);
  assert.match(response.reply, /^## 📈 Proyección del mes/);
  assert.match(response.reply, /estimación/i);
  assert.match(response.reply, /excluye/i);
});

test('Financial Coach reports a recorded upcoming commitment without inventing a payment', () => {
  const window = uiWith({
    now:Date.parse('2026-11-10T15:00:00Z'), transactions:[], receivables:[],
    commitments:[{ id:'commitment', amount:400, next_due_amount:80, due_at:'2026-11-16' }]
  });
  const response = window.gfcTryFinancialCoachMessage('¿Cuál es mi próximo vencimiento?');
  assert.equal(response.handled, true);
  assert.match(response.reply, /2026-11-16/);
  assert.match(response.reply, /80\.00/);
});

test('Financial Coach answers structured installation collections without reading text-only rows', () => {
  const window = uiWith({
    now:Date.parse('2026-11-10T15:00:00Z'),
    transactions:[
      { id:'linked', type:'ingreso', amount:450, date:'2026-11-06', service:'Instalación nueva' },
      { id:'text', type:'ingreso', amount:900, date:'2026-11-07', description:'instalación' }
    ], receivables:[], commitments:[]
  });
  const response = window.gfcTryFinancialCoachMessage('¿Cuánto hemos cobrado por instalaciones este mes?');
  assert.equal(response.handled, true);
  assert.match(response.reply, /450\.00/);
  assert.doesNotMatch(response.reply, /900\.00/);
});

test('Financial Coach names only structured pending receivables on request', () => {
  const window = uiWith({
    now:Date.parse('2026-11-10T15:00:00Z'), transactions:[], commitments:[],
    receivables:[{ id:'a', name:'Ana', balance_amount:120 }, { id:'b', name:'Bruno', balance_amount:80 }]
  });
  const response = window.gfcTryFinancialCoachMessage('¿Quién me debe?');
  assert.equal(response.handled, true);
  assert.match(response.reply, /Ana/);
  assert.match(response.reply, /Bruno/);
});

test('Financial Coach UI contains no network client or commercial write path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-financial-coach-ui.js'), 'utf8');
  assert.equal(/fetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|localStorage\.setItem|sessionStorage\.setItem/i.test(source), false);
});

test('the final local chat dispatcher preserves the Financial Coach fast read', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  const finalDispatcher = source.slice(source.lastIndexOf('window.gfcHandleYarbiLocalCommand = async function'));
  assert.match(finalDispatcher, /gfcTryFinancialCoachMessage/);
  assert.match(finalDispatcher, /kind:'financial_coach'/);
  assert.match(finalDispatcher, /gfcTryAgendaReadMessage/);
  assert.match(finalDispatcher, /kind:'agenda_read'/);
  assert.match(finalDispatcher, /gfcTryClientContextReadMessage/);
  assert.match(finalDispatcher, /kind:'client_context_read'/);
});
