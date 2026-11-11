'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requestedReadKind, replyForContext } = require('../lib/yarbi-client-context-read');

const base = {
  contact: { display_name: 'Carlos' },
  dossier: {
    client_name: 'Carlos', service: 'instalación nueva', commercial_status: 'tibio',
    operational_status: 'visita_pendiente', appointment_date: '2026-11-12', appointment_time: '10:00',
    district: 'Surco', location: 'Surco', conversation_brief: 'Siguiente paso: confirmar visita.'
  }
};

test('classifies only deterministic client-read questions', () => {
  assert.equal(requestedReadKind('¿Qué pasó con Carlos?'), 'history');
  assert.equal(requestedReadKind('¿Cuánto debe Carlos?'), 'balance');
  assert.equal(requestedReadKind('Agenda una visita para Carlos'), null);
});

test('summarizes a verified local client dossier without inventing facts', () => {
  const result = replyForContext({ utterance: '¿Qué pasó con Carlos?', context: { ...base, timeline: [
    { id: 'agenda-1', kind: 'agenda', at: '2026-11-12T15:00:00Z', title: 'Visita de evaluación', detail: 'Surco' },
    { id: 'receivable-1', kind: 'receivable', at: '2026-11-10T15:00:00Z', title: 'Cobranza', detail: 'partial · Confirmar abono' }
  ] } });
  assert.equal(result.outcome, 'client_context_found');
  assert.match(result.reply, /## 🧾 Expediente de Carlos/);
  assert.match(result.reply, /Carlos/);
  assert.match(result.reply, /instalación nueva/);
  assert.match(result.reply, /\*\*Estado comercial:\*\* tibio/);
  assert.match(result.reply, /### Últimos registros verificados/);
  assert.match(result.reply, /Agenda · 12\/11\/2026/);
  assert.match(result.reply, /Cobranza/);
  assert.equal(result.execute, false);
});

test('reports a balance only when it has a canonical verified amount', () => {
  const found = replyForContext({ utterance: '¿Cuánto debe Carlos?', context: { ...base, finance: { summary: { pending_amount: 230 } } } });
  assert.equal(found.outcome, 'client_balance_found');
  assert.match(found.reply, /## 💳 Saldo pendiente/);
  assert.match(found.reply, /S\/ 230\.00/);
  const missing = replyForContext({ utterance: '¿Cuánto debe Carlos?', context: base });
  assert.equal(missing.outcome, 'no_verified_balance');
  assert.match(missing.reply, /No tengo un saldo verificable/);
  const zero = replyForContext({ utterance: '¿Cuánto debe Carlos?', context: { ...base, finance: { summary: { pending_amount: 0 } } } });
  assert.equal(zero.outcome, 'no_verified_balance');
});

test('requires clarification rather than selecting a homonym', () => {
  const result = replyForContext({ utterance: '¿Qué pasó con Carlos?', context: { requires_disambiguation: true } });
  assert.equal(result.outcome, 'needs_clarification');
  assert.match(result.reply, /más de un cliente/);
});

test('presents approved historical context as an observation, never as a commercial fact', () => {
  const result = replyForContext({ utterance:'¿Qué pasó con Carlos?', context:{ ...base, historical_context:{
    contact_id:'carlos-1', provenance:'owner_reviewed_historical_context', observations:[
      { id:'observation-1', type:'payment_reported', service:'instalación nueva', source_timestamp:Date.parse('2026-11-04T12:00:00Z'), commercial_fact:false }
    ]
  } } });
  assert.equal(result.outcome, 'client_context_found');
  assert.match(result.reply, /Contexto histórico revisado/);
  assert.match(result.reply, /Pago reportado por chat/);
  assert.match(result.reply, /No confirman pagos, visitas ni cierres/);
});

test('browser adapter does not contain a network or commercial write path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-client-context-read-ui.js'), 'utf8');
  assert.equal(/fetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|send-whatsapp|gfcSyncYarbiLocalMirror|gfcSave/i.test(source), false);
});

test('browser adapter may attach only the locally approved historical context to an already resolved contact', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-client-context-read-ui.js'), 'utf8');
  assert.match(source, /gfcYarbiHistoricalContactContext/);
  assert.match(source, /historical_context/);
});
