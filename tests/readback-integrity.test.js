const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const approve = fs.readFileSync(path.join(root, 'api', 'actions', 'approve.js'), 'utf8');
const collections = fs.readFileSync(path.join(root, 'api', 'assistant', 'collections.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('read-back: agenda is queried again after POST or PATCH', () => {
  const write = Math.max(
    approve.indexOf("const saved = await supabaseRequest('/rest/v1/agenda_events'"),
    approve.indexOf('let saved = await supabaseRequest(savePath')
  );
  const readBack = approve.indexOf("const readBack = await supabaseRequest('/rest/v1/agenda_events?id=eq.'", write);
  const success = approve.indexOf('syncResults.supabase_agenda = true', readBack);
  assert.ok(write >= 0 && readBack > write && success > readBack);
});

test('read-back: agenda validates identity, client, type, time, source and dedupe key', () => {
  assert.match(approve, /String\(confirmed\.id\) === String\(row\.id\)/);
  assert.match(approve, /confirmed\.contact_id/);
  assert.match(approve, /confirmed\.event_type/);
  assert.match(approve, /sameInstant\(confirmed\.starts_at, event\.starts_at\)/);
  assert.match(approve, /confirmed\.service/);
  assert.match(approve, /confirmed\.location/);
  assert.match(approve, /confirmed\.maps_url/);
  assert.match(approve, /confirmed\.status/);
  assert.match(approve, /confirmed\.source/);
  assert.match(approve, /confirmed\.dedupe_key/);
  assert.match(approve, /readBackVerified: true/);
});

test('read-back: receivable is queried and compared before success', () => {
  const write = collections.indexOf("const saved = await supabaseRequest('/rest/v1/yarbi_receivables?on_conflict=agenda_event_id'");
  const readBack = collections.indexOf("const readBack = await supabaseRequest('/rest/v1/yarbi_receivables?id=eq.'", write);
  const success = collections.indexOf('readback_verified: true', readBack);
  assert.ok(write >= 0 && readBack > write && success > readBack);
  assert.match(collections, /Number\(confirmed\.agenda_event_id\) === agendaEventId/);
  assert.match(collections, /money\(confirmed\.balance_amount\) === balanceAmount/);
});

test('read-back: frontend only marks agenda remote when backend confirms canonical id', () => {
  const start = frontend.indexOf('function gfcSyncAgendaItemToSupabase');
  const end = frontend.indexOf('function saveAgendaItem', start);
  const block = frontend.slice(start, end);
  assert.match(block, /sync\.supabase_agenda === true && sync\.agenda_event_id/);
  assert.match(block, /_remoteSync: remoteOk \? 'synced' : 'pending_sync'/);
});
