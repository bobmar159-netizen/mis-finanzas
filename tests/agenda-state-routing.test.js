const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const command = fs.readFileSync(path.join(__dirname, '..', 'api_handlers', 'assistant', 'command.js'), 'utf8');
const deletion = fs.readFileSync(path.join(__dirname, '..', 'api', 'actions', 'approve.js'), 'utf8');

test('agenda routing separates future construction from finalized service', () => {
  assert.match(command, /crea una construcción futura/i);
  assert.match(command, /action\.intent = 'create_construction'/);
  assert.match(command, /action\.new_status = 'agendado'/);
  assert.match(command, /Usa register_service exclusivamente/);
});

test('agenda routing recognizes reprogramming and explicit deletion', () => {
  assert.match(command, /action\.new_status = 'reprogramado'/);
  assert.match(command, /action\.intent = 'delete_agenda'/);
  assert.match(command, /Para eliminar usa delete_agenda solo ante una orden explícita/);
});

test('agenda deletion is authenticated, scoped and read-back verified', () => {
  assert.match(deletion, /authenticateCompleteScopedOwner\(req, runtime, supabaseRequest\)/);
  assert.match(deletion, /authenticateCompleteScopedOwner, blockedOwnerInput, scopedContact/);
  assert.match(deletion, /operation === 'delete_agenda'/);
  assert.match(deletion, /source=eq\.yarbi_form/);
  assert.match(deletion, /method: 'DELETE'/);
  assert.match(deletion, /agenda_delete_not_verified/);
  assert.match(deletion, /readback_verified: true/);
});

test('Agenda upsert scopes dedupe keys and safely recovers a verified unique-key race', () => {
  assert.match(deletion, /dedupe_key=eq\.' \+ encodeURIComponent\(dedupeKey\) \+ '&source=eq\.yarbi_form/);
  assert.match(deletion, /String\(saved\.data\?\.code \|\| ''\) === '23505'/);
  assert.match(deletion, /String\(racedRow\.contact_id \|\| ''\) !== String\(contactId \|\| ''\)/);
  assert.match(deletion, /agenda_dedupe_conflict/);
  assert.match(deletion, /sameInstant\(racedRow\.starts_at, startsAt\)/);
});

test('Agenda database idempotency proposal is additive and fails closed on existing duplicates', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'PROPOSED_20261116_agenda_dedupe_guard.sql'), 'utf8');
  assert.match(migration, /PROPOSAL ONLY/);
  assert.match(migration, /having count\(\*\) > 1/);
  assert.match(migration, /raise exception 'duplicate Yarbi agenda keys exist/);
  assert.match(migration, /create unique index if not exists agenda_events_yarbi_dedupe_key_uq/);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.agenda_events|\bupdate\s+public\.agenda_events/i);
});

test('Agenda sync retries use a fresh owner session and never require the retired shared token', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  const sync = html.slice(html.indexOf('function gfcSyncAgendaItemToSupabase'), html.indexOf('function saveAgendaItem'));
  const deletionWorker = html.slice(html.indexOf('async function gfcFlushAgendaRemoteDeletes'), html.indexOf('const GFC_SERVICE_DELETE_UNDO_KEY'));
  assert.match(sync, /gfcRuntimeApiOrigin\(\) \+ '\/api\/actions\/approve'/);
  assert.doesNotMatch(sync, /X-Assistant-Token|fnz_assistant_token/);
  assert.match(sync, /gfcAccountFreshAccessToken !== 'function'/);
  assert.match(sync, /await window\.gfcAccountFreshAccessToken\(\)/);
  assert.doesNotMatch(deletionWorker, /X-Assistant-Token|fnz_assistant_token/);
  assert.match(deletionWorker, /await window\.gfcAccountFreshAccessToken\(\)/);
  assert.match(deletionWorker, /result\.deleted !== true/);
});
