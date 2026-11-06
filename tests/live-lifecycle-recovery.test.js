const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Android pause remembers Live intent and resume schedules recovery', () => {
  assert.match(frontend, /gfcRememberLiveResumeIntent\('native-pause'\)/);
  assert.match(frontend, /gfcScheduleLiveResume\('native-resume'\)/);
  assert.match(frontend, /gfcRememberLiveResumeIntent\('capacitor-background'\)/);
  assert.match(frontend, /gfcScheduleLiveResume\('capacitor-active'\)/);
});

test('abnormal network close 1006 is recoverable without changing VAD', () => {
  const liveStart = frontend.indexOf('async function gfcStartGeminiLive');
  const closeStart = frontend.indexOf('socket.onclose = event =>', liveStart);
  const closeBlock = frontend.slice(closeStart, frontend.indexOf('} catch (error)', closeStart));
  assert.match(closeBlock, /\[1006, 1011, 1012, 1013\]\.includes\(closeCode\)/);
  assert.match(closeBlock, /gfcRememberLiveResumeIntent\('websocket-' \+ closeCode/);
  assert.match(closeBlock, /gfcScheduleLiveResume\('websocket-' \+ closeCode, 900\)/);
  assert.match(frontend, /LIVE_LIFECYCLE_RECOVERY_V1/);
});

test('recovery waits for foreground and network and does not greet again', () => {
  const start = frontend.indexOf('function gfcScheduleLiveResume');
  const block = frontend.slice(start, frontend.indexOf('// Configurar escuchas', start));
  assert.match(block, /document\.visibilityState === 'hidden'/);
  assert.match(block, /!navigator\.onLine/);
  assert.match(block, /lifecycleRecovery: true/);
  assert.doesNotMatch(block, /initialGreeting: true/);
});

test('explicit stop clears pending recovery and inactive session is not reported ready', () => {
  const stopStart = frontend.indexOf('function gfcStopGeminiLive');
  const stopBlock = frontend.slice(stopStart, frontend.indexOf('function gfcToggleGeminiLive', stopStart));
  assert.match(stopBlock, /if \(closeSocket\) gfcClearLiveResumeIntent\('explicit-stop'\)/);
  assert.match(stopBlock, /session\.liveReady = false/);
});
