'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('F07 UI revisa la transcripción antes del cerebro central y no incorpora un proveedor externo', () => {
  const ui = fs.readFileSync(path.join(root, 'frontend', 'yarbi-app-voice.js'), 'utf8');
  assert.match(ui, /renderReview\(value\)/);
  assert.match(ui, /gfcSendYarbiUnifiedMessage/);
  assert.match(ui, /gfcOwnerMemoryReviewUtterance\(text, 'voice'\)/);
  assert.match(ui, /no_audio_persistence/);
  assert.equal(ui.includes('fetch('), false);
  assert.equal(ui.includes('ElevenLabs'), false);
});

test('F01 conserva Gemini Live como voz principal y no sustituye Live por TTS local', () => {
  const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'frontend', 'yarbi-app-voice.js'), 'utf8');
  assert.match(html, /yarbi-app-voice\.js/);
  assert.match(html, /voice_output_text_only/);
  assert.equal(ui.includes('speechSynthesis'), false);
  assert.equal(ui.includes('YarbiTts'), false);
});
