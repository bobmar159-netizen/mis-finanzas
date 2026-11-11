const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewHistoricalConversations, reconcileHistoricalCandidates } = require('../frontend/yarbi-historical-learning');

function conversation(name, messages) { return { name, messages }; }
function message(sender, text) { return { sender, text, timestamp: 1 }; }

test('historical review identifies the owner and produces review-only commercial candidates', () => {
  const result = reviewHistoricalConversations({ owner:'Omar', conversations:[conversation('Chat con +51 999 111 222.txt', [
    message('Cliente', 'Necesito una instalación nueva.'),
    message('Omar', 'Claro, primero envíame ubicación.'),
    message('Cliente', 'Ya te pagué S/ 200.')
  ])] });
  assert.equal(result.outcome, 'review_required');
  assert.equal(result.conversations[0].identity_state, 'candidate_phone_match');
  assert.equal(result.totals.owner_messages, 1);
  assert.equal(result.totals.reply_pairs, 1);
  assert.equal(result.safety.automatic_crm_updates, false);
  assert.equal(result.safety.automatic_agenda_updates, false);
  assert.equal(result.safety.automatic_finance_updates, false);
  assert.ok(result.conversations[0].event_candidates.some(item => item.type === 'payment_reported'));
  assert.ok(result.conversations[0].event_candidates.every(item => item.requires_reconciliation && !item.automatic_change));
});

test('historical review refuses to treat a group chat as one verified client', () => {
  const result = reviewHistoricalConversations({ owner:'Omar', conversations:[conversation('Grupo trabajo.txt', [
    message('Omar', 'Buenos días.'), message('Carlos', 'Hola.'), message('Carla', 'También necesito una visita.')
  ])] });
  assert.equal(result.conversations[0].identity_state, 'ambiguous_participants');
  assert.equal(result.conversations[0].identity_confidence, 'none');
});

test('historical review never upgrades a claimed completion into a completed job', () => {
  const result = reviewHistoricalConversations({ owner:'Omar', conversations:[conversation('Chat.txt', [
    message('Cliente', 'Quedó listo el trabajo y cancelé todo.')
  ])] });
  const candidates = result.conversations[0].event_candidates;
  assert.ok(candidates.some(item => item.type === 'work_completion_reported'));
  assert.ok(candidates.some(item => item.type === 'payment_reported'));
  assert.ok(candidates.every(item => item.automatic_change === false));
});

test('historical reconciliation matches one confirmed movement as evidence but never changes a payment', () => {
  const result = reconcileHistoricalCandidates({
    candidates:[{ id:'payment-1', type:'payment_reported', contact_id:'7', phone:'999111222', source_timestamp:Date.parse('2026-11-04T12:00:00-05:00') }],
    contacts:[{ id:'7', display_name:'Cliente A' }],
    agenda:[],
    movements:[{ id:'move-1', contact_id:'7', type:'ingreso', amount:200, date:'2026-11-05' }]
  });
  assert.equal(result.results[0].outcome, 'movement_match_review');
  assert.equal(result.results[0].movement_matches[0].id, 'move-1');
  assert.equal(result.results[0].automatic_change, false);
});

test('historical reconciliation reports ambiguity instead of choosing between two agendas', () => {
  const result = reconcileHistoricalCandidates({
    candidates:[{ id:'visit-1', type:'visit_mentioned', contact_id:'8', service:'reparacion', source_timestamp:Date.parse('2026-11-04T12:00:00-05:00') }],
    contacts:[{ id:'8', display_name:'Cliente B' }], movements:[],
    agenda:[
      { id:'agenda-1', contact_id:'8', event_type:'visita', service:'reparacion', starts_at:'2026-11-05T15:00:00-05:00' },
      { id:'agenda-2', contact_id:'8', event_type:'visita', service:'reparacion', starts_at:'2026-11-06T15:00:00-05:00' }
    ]
  });
  assert.equal(result.results[0].outcome, 'ambiguous_evidence');
  assert.equal(result.results[0].automatic_change, false);
});
