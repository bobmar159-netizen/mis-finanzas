'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-owner-inbox-ui.js'), 'utf8');

test('Yarbi hub preserves the inbox and exposes a direct text chat entry', () => {
  assert.match(source, /id="yarbi-owner-pending"/);
  assert.match(source, /id="yarbi-owner-chat"/);
  assert.match(source, /gfcOpenCopilotModal\('chat'\)/);
});

test('the Yarbi navigation icon opens the real text chat instead of a test hub', () => {
  assert.match(source, /tab\.onclick\s*=\s*\(\)\s*=>\s*\{[\s\S]*?gfcOpenCopilotModal\('chat'\)/);
  assert.match(source, /tab\.title\s*=\s*'Abrir Chat con Yarbi'/);
  assert.doesNotMatch(source, /tab\.onclick\s*=\s*\(\)\s*=>\s*window\.gfcOpenYarbiHub\(\)/);
});

test('Yarbi hub never starts Live voice in an offline Android build', () => {
  assert.match(source, /gfcRuntimeRemoteEnabled/);
  assert.match(source, /La voz en vivo requiere un endpoint de prueba autorizado/);
  assert.match(source, /id="yarbi-owner-voice"/);
});
