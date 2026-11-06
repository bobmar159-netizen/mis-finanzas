const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function liveSetupBlock() {
  const start = frontend.indexOf('const setupMessage = { setup:');
  const end = frontend.indexOf('socket.send(JSON.stringify(setupMessage))', start);
  assert.ok(start >= 0 && end > start);
  return frontend.slice(start, end);
}

function captureBlock() {
  const start = frontend.indexOf('processor.onaudioprocess = event => {');
  const end = frontend.indexOf('source.connect(processor);', start);
  assert.ok(start >= 0 && end > start);
  return frontend.slice(start, end);
}

test('Gemini Live: production setup remains audio-to-audio with the selected Yarbi voice', () => {
  const block = liveSetupBlock();
  assert.match(block, /responseModalities: \['AUDIO'\]/);
  assert.match(block, /maxOutputTokens: 768/);
  assert.match(block, /voiceName: liveVoiceName/);
  assert.match(block, /model: 'models\/' \+ GFC_YARBI_LIVE_MODEL/);
});

test('Gemini Live: Spanish transcription and sliding context stay enabled', () => {
  const block = liveSetupBlock();
  assert.match(block, /contextWindowCompression: \{ slidingWindow: \{\} \}/);
  assert.match(block, /inputAudioTranscription: \{ languageCodes: \['es-PE'\] \}/);
  assert.match(block, /outputAudioTranscription: \{ languageCodes: \['es-PE'\] \}/);
});

test('Gemini Live: server VAD remains disabled because the protected local VAD owns interruption', () => {
  const block = liveSetupBlock();
  assert.match(block, /automaticActivityDetection: \{ disabled: true \}/);
  assert.match(block, /activityHandling: 'NO_INTERRUPTION'/);
});

test('Gemini Live: microphone capture block matches the turn-ownership version', () => {
  const digest = crypto.createHash('sha256').update(captureBlock()).digest('hex').toUpperCase();
  assert.equal(digest, '2AA6FDB411876CA66199BC96E80547F5659C34259B48E28502F5D3E58757B767');
});

test('Gemini Live: response policy is concise by default but allows complete explanations', () => {
  assert.match(frontend, /Por defecto responde en una o dos frases directas/);
  assert.match(frontend, /Si el Maestro pide explicar, analizar, dar detalles, justificar o hacerlo paso a paso, desarrolla una respuesta completa/);
  assert.match(frontend, /nunca termines una frase a medias ni cortes una idea esencial/);
});
