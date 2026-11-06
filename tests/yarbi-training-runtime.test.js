const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'www', 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'www', 'yarbi-memory-center.js'), 'utf8');

test('training runtime is deployed beside the Yarbi page', () => {
  assert.match(html, /<script src="yarbi-memory-center\.js"><\/script>/);
  assert.match(runtime, /window\.gfcYarbiTrainingLiveContext/);
  assert.match(runtime, /window\.gfcHandleYarbiTrainingLiveTurn/);
});

test('training examples record actual use locally and synchronize that evidence', () => {
  assert.match(runtime, /async function trainingMarkUsed\(ids, source\)/);
  assert.match(runtime, /void trainingMarkUsed\(examples\.map\(item => item\.id\), 'simulator-generate'\)/);
  assert.match(runtime, /void trainingMarkUsed\(window\._gfcYarbiTrainingLiveExampleIds \|\| \[\], 'live-context'\)/);
  assert.match(runtime, /await trainingSyncItem\(item\)/);
});

test('autonomy remains safely limited to observation, suggestion, and approval', () => {
  assert.match(runtime, /\['observe','suggest','approval'\]/);
  assert.match(runtime, /Responder por mí/);
  assert.match(runtime, /Desactivado/);
  assert.doesNotMatch(runtime, /mode === 'automatic'/);
});
