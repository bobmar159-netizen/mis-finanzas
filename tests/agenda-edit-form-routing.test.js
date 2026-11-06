const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api_handlers', 'assistant', 'command.js'), 'utf8');

test('open agenda form is a trusted edit context, not a new agenda', () => {
  assert.match(source, /const pendingDraft = compactPendingDraft\(body\.pendingDraft\)/);
  assert.match(source, /pendingDraft\?\.editId/);
  assert.match(source, /action\.intent = 'update_agenda'/);
  assert.match(source, /action\.agenda_id = pendingDraft\.editId/);
});

test('latest incoming Maps link is routed to maps_url and removed from notes', () => {
  assert.match(source, /metadata\?\.direction !== 'outgoing' && isMapsUrl\(message\.maps_url\)/);
  assert.match(source, /action\.maps_url = latestMapsUrl/);
  assert.match(source, /if \(isMapsUrl\(action\.location\)\) action\.location = pendingDraft\.location \|\| ''/);
  assert.match(source, /action\.description = String\(action\.description \|\| ''\)\.replace/);
});

test('the command route only prepares the edit; the app performs the visible save', () => {
  const editBlock = source.slice(source.indexOf("if (pendingDraft?.editId"), source.indexOf('const types ='));
  assert.doesNotMatch(editBlock, /rest\/v1\/agenda_events/);
  assert.doesNotMatch(editBlock, /method: 'POST'/);
  assert.doesNotMatch(editBlock, /method: 'PATCH'/);
});
