const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('greeting: manual Live activation requests one initial greeting', () => {
  assert.match(frontend, /GREETING_FIRST_V1/);
  const calls = frontend.match(/gfcStartGeminiLive\(\{ initialGreeting: true \}\)/g) || [];
  assert.ok(calls.length >= 2);
});

test('greeting: startup phrase is short and contains no date, time or old task', () => {
  const start = frontend.indexOf('function gfcYarbiInitialGreeting()');
  const end = frontend.indexOf('function gfcYarbiModeSelectorHtml', start);
  const block = frontend.slice(start, end);
  assert.match(block, /Hola, Omar\. Te escucho\./);
  assert.doesNotMatch(block, /fecha|hora|agenda|pendiente|cliente/i);
});

test('greeting: recovery never generates a new startup greeting', () => {
  assert.match(frontend, /!options\.recovery && options\.initialGreeting/);
  assert.match(frontend, /gfcStartGeminiLive\(\{ recovery: true, lifecycleRecovery: true, recoveryPcm: recoveryAudio \}\)/);
});

test('greeting: greeting turn is not stored as conversational memory', () => {
  const start = frontend.indexOf('function gfcCommitLiveTurn(session)');
  const end = frontend.indexOf('function gfcClearLiveMemory', start);
  const block = frontend.slice(start, end);
  assert.match(block, /if \(session\.modeGreetingTurn\)/);
  assert.ok(block.indexOf('if (session.modeGreetingTurn)') < block.indexOf('memory.turns.push'));
  assert.match(frontend, /Responde exactamente con esta frase y nada más/);
});
