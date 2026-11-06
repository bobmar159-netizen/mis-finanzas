const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');

test('CRM/Yarbi: creates a compact local snapshot from the existing local mirror', () => {
  assert.match(source, /const GFC_YARBI_CLIENT_SNAPSHOT_KEY = 'gfc_yarbi_client_snapshot_v1'/);
  assert.match(source, /function gfcYarbiClientSnapshotsWrite\(items = \[\], source = 'local-mirror'\)/);
  assert.match(source, /commercial_status:String\(item\.commercial_status \|\| ''\)/);
  assert.match(source, /operational_status:String\(item\.operational_status \|\| ''\)/);
  assert.match(source, /gfcYarbiClientSnapshotsWrite\(items, options\.reason \|\| 'local-mirror'\)/);
});

test('CRM/Yarbi: restores the active client context from the compact local snapshot', () => {
  const start = source.indexOf('function gfcYarbiConversationFocusFromMemory');
  const end = source.indexOf('\nfunction ', start + 20);
  const block = source.slice(start, end);
  assert.ok(start >= 0);
  assert.match(block, /gfcYarbiClientSnapshotForIdentity/);
  assert.match(block, /conversation_brief/);
  assert.match(block, /operational_status/);
});

test('CRM/Yarbi: increases sync cadence only while the CRM or Yarbi screen is active', () => {
  assert.match(source, /function gfcYarbiFastCrmSyncActive\(\)/);
  assert.match(source, /gfcYarbiFastCrmSyncActive\(\) \? 12000 : 30000/);
  assert.match(source, /if \(document\.visibilityState !== 'visible'\) return/);
});
