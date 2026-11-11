const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewHistoricalConversations } = require('../frontend/yarbi-historical-learning');

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
