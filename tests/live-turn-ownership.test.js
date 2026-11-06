const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Live turn ownership: pending response keeps the current logical turn', () => {
  const start = frontend.indexOf('function gfcLiveBeginCapturedSpeech');
  const end = frontend.indexOf('function gfcLiveAdvanceTurn', start);
  assert.ok(start >= 0 && end > start);
  const block = frontend.slice(start, end);
  assert.match(block, /gfcLiveHasPendingResponse\(session\)/);
  assert.match(block, /live-turn-retained/);
  assert.match(block, /turnId: session\.liveTurnId, retained: true/);
});

test('Live turn ownership: recovered speech releases the stale-content gate', () => {
  const start = frontend.indexOf('function gfcLiveBeginCapturedSpeech');
  const end = frontend.indexOf('function gfcLiveAdvanceTurn', start);
  const block = frontend.slice(start, end);
  assert.match(block, /session\.liveTurnNeedsSpeech = false/);
  assert.match(block, /session\.liveIgnoreServerContentUntilSpeech = false/);
  assert.match(block, /live-recovery-speech-accepted/);
});

test('Live turn ownership: only a genuinely new turn clears conversation buffers', () => {
  const start = frontend.indexOf('function gfcLiveAdvanceTurn');
  const end = frontend.indexOf('function gfcLiveInvalidateTurn', start);
  assert.ok(start >= 0 && end > start);
  const block = frontend.slice(start, end);
  assert.match(block, /session\.inputBuffer = ''/);
  assert.match(block, /session\.outputBuffer = ''/);
  assert.match(block, /session\.liveAwaitingResponse = false/);
});

test('Live turn ownership: activity end marks the same turn as waiting for response', () => {
  const captureStart = frontend.indexOf('processor.onaudioprocess = event => {');
  const captureEnd = frontend.indexOf('source.connect(processor);', captureStart);
  assert.ok(captureStart >= 0 && captureEnd > captureStart);
  const capture = frontend.slice(captureStart, captureEnd);
  assert.match(capture, /gfcLiveBeginCapturedSpeech\(session, 'user-speech'\)/);
  assert.match(capture, /session\.liveAwaitingResponse = true/);
  assert.match(capture, /GFC_LIVE_TURN_STATES\.WAITING_RESPONSE/);
});

test('Live turn ownership: turnComplete releases the pending-response lock', () => {
  const start = frontend.indexOf('if (content.turnComplete)');
  const end = frontend.indexOf('socket.onerror', start);
  assert.ok(start >= 0 && end > start);
  const block = frontend.slice(start, end);
  assert.match(block, /session\.liveAwaitingResponse = false/);
  assert.match(block, /GFC_LIVE_TURN_STATES\.LISTENING/);
});
