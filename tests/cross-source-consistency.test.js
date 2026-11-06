const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const approve = fs.readFileSync(path.join(root, 'api', 'actions', 'approve.js'), 'utf8');
const collections = fs.readFileSync(path.join(root, 'api', 'assistant', 'collections.js'), 'utf8');

test('consistency: local agenda blocks exact duplicates and merges a repeated Yarbi draft', () => {
  assert.match(frontend, /function gfcFindAgendaDuplicate\(candidate\)/);
  assert.match(frontend, /function gfcFindAgendaYarbiMergeCandidate\(candidate\)/);
  assert.match(frontend, /Ese registro ya existe en la agenda; no lo dupliqué/);
  assert.match(frontend, /agenda-yarbi-merge-existing/);
});

test('consistency: canonical agenda reuses dedupe key and same contact-type-time slot', () => {
  assert.match(approve, /agenda_events\?dedupe_key=eq\./);
  assert.match(approve, /contact_id=eq\./);
  assert.match(approve, /event_type=eq\./);
  assert.match(approve, /starts_at=eq\./);
  assert.match(approve, /source=eq\.yarbi_form/);
  assert.match(approve, /method: eventId \? 'PATCH' : 'POST'/);
});

test('consistency: an update targets its canonical agenda id instead of creating another event', () => {
  assert.match(frontend, /agenda_event_id: item\._remoteAgendaEventId \|\| null/);
  assert.match(approve, /payload\.agenda_event_id/);
  assert.match(approve, /requestedEvent\?\.contact_id/);
  assert.match(approve, /Ya existe otro evento canónico con ese horario/);
});

test('consistency: clients and receivables use stable identities', () => {
  assert.match(approve, /contact_identifiers\?identifier_type=eq\.phone&normalized_value=eq\./);
  assert.match(collections, /on_conflict=agenda_event_id/);
  assert.match(collections, /readback_verified: true/);
});

test('consistency audit: external integrations currently expose more than one possible writer', () => {
  assert.match(frontend, /syncAgendaToSheets\(item\)/);
  assert.match(frontend, /_pushToNotionClientes\(item\)/);
  assert.match(approve, /action: 'add_agenda'/);
  assert.match(approve, /action: 'create_calendar_event'/);
  assert.match(approve, /https:\/\/api\.notion\.com\/v1\/pages/);
});

test.todo('consistency external: choose one confirmed writer for Google Sheets after Vercel/config audit');
test.todo('consistency external: choose one confirmed writer for Notion after Vercel/config audit');
test.todo('consistency external: implement stable Calendar event id for create, update and cancel');
