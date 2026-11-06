const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function protectedVadBlock() {
  const start = frontend.indexOf('const GFC_LIVE_BARGE_IN_MIN_FRAMES');
  const end = frontend.indexOf('function gfcLivePendingAudioMs', start);
  assert.ok(start >= 0 && end > start);
  return frontend.slice(start, end);
}

test('barge-in guard: protected VAD block matches the approved behavior', () => {
  const digest = crypto.createHash('sha256').update(protectedVadBlock()).digest('hex').toUpperCase();
  assert.equal(digest, 'D2A36061C5FC8292C0453E35014960D72C8CB40D855D333924DCDF469C560EFF');
});

test('barge-in guard: confirmed user speech clears playback immediately', () => {
  const captureStart = frontend.indexOf('processor.onaudioprocess = event => {');
  const captureEnd = frontend.indexOf('source.connect(processor);', captureStart);
  const capture = frontend.slice(captureStart, captureEnd);
  const confirmed = capture.indexOf('const verifiedBargeIn = gfcLiveVerifyBargeIn');
  const guarded = capture.indexOf('if (!verifiedBargeIn)');
  const detected = capture.indexOf("gfcVoicePipelineEvent('barge_in_detected'");
  const cleared = capture.indexOf("gfcClearLivePlayback('user-barge-in')");
  assert.ok(confirmed >= 0 && guarded > confirmed && detected > guarded && cleared > detected);
});

test('barge-in guard: playback clearing empties queues and stops active sources', () => {
  const start = frontend.indexOf('function gfcClearLivePlayback(reason =');
  const end = frontend.indexOf('function gfcLocalWhatsAppMessages', start);
  const block = frontend.slice(start, end);
  assert.match(block, /session\.liveAudioQueue = \[\]/);
  assert.match(block, /session\.liveAudioIngressQueue = \[\]/);
  assert.match(block, /source\.stop\(\)/);
  assert.match(block, /session\.outputPlayingUntil = Date\.now\(\)/);
  assert.match(block, /Live escuchando en tiempo real/);
});

test('barge-in guard: echo requires more evidence but does not disable interruption', () => {
  const block = protectedVadBlock();
  assert.match(block, /GFC_LIVE_VAD_CONFIRM_MIN_FRAMES = 6/);
  assert.match(block, /GFC_LIVE_VAD_ECHO_CONFIRM_MIN_FRAMES = 9/);
  assert.match(block, /bargeInConfirmed/);
  assert.match(frontend, /automaticActivityDetection: \{ disabled: true \}, activityHandling: 'NO_INTERRUPTION'/);
});

test('barge-in guard: playback requires two sustained confirmation stages', () => {
  const start = frontend.indexOf('function gfcLiveVerifyBargeIn');
  const end = frontend.indexOf('function gfcLiveUpdateAudioLossStats', start);
  const block = frontend.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /barge-in-awaiting-second-stage/);
  assert.match(block, /stages: 2/);
  assert.match(block, /signal-not-sustained/);
});
