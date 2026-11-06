const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const processor = fs.readFileSync(path.join(__dirname, '..', 'api', 'ai', 'process.js'), 'utf8');

test('availability conflict: an incoming travel message creates a review alert linked to the next visit', () => {
  const start = processor.indexOf('function detectAgendaAvailabilityConflict');
  const end = processor.indexOf('async function createAgendaEvent', start);
  const block = processor.slice(start, end);
  assert.match(block, /me\\s\+voy\\s\+\(\?:de\\s\+\)\?viaje/);
  assert.match(block, /metadata\?\.direction === 'outgoing'/);
  assert.match(block, /metadata\?\.historical/);
  assert.match(block, /starts_at=gte/);
  assert.match(block, /now\.getTime\(\) - 36 \* 60 \* 60 \* 1000/);
  assert.match(block, /const recent = past\.find/);
  assert.match(block, /status=in.%28pending%2Cconfirmed%29/);
  assert.match(block, /agenda_event_id: agendaEvent\.id/);
  assert.match(block, /alert_type: 'availability_conflict'/);
  assert.match(block, /La agenda original no fue modificada/);
});

test('same-day missed visit remains eligible when the client writes later to reprogram', () => {
  assert.match(processor, /findUpcomingAgendaForAvailabilityConflict\(contactId, agendaClientSignal\)/);
  assert.match(processor, /signalAt - new Date\(row\.starts_at\)\.getTime\(\) <= 36 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(processor, /body: JSON\.stringify\(\{[^}]*starts_at[^}]*\}\).*agendaClientSignal/s);
});

test('availability conflict: it updates CRM to waiting for the customer but never patches or cancels agenda', () => {
  const start = processor.indexOf('function applyAgendaAvailabilityConflict');
  const end = processor.indexOf('async function createAgendaAvailabilityAlert', start);
  const block = processor.slice(start, end);
  assert.match(block, /analysis\.operational_status = 'esperando_cliente'/);
  assert.match(block, /operational_status_source_message_ids = \[signal\.message_id\]/);
  assert.match(block, /Confirmar reprogramación de visita/);
  assert.doesNotMatch(block, /agenda_events.*PATCH|cancelado|DELETE/);
});

test('availability conflict: normal alert is skipped so a linked high-priority alert is the single action', () => {
  assert.match(processor, /const alert = hasHistoricalMessages \|\| agendaAvailabilityConflict/);
  assert.match(processor, /await createAgendaAvailabilityAlert\(contactId, analysisId, availabilitySignal, agendaAvailabilityConflict\)/);
});
