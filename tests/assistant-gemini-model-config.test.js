'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Gemini chat resolves one configured model and uses it in the provider URL', () => {
  const chat = read('api_handlers/assistant/chat.js');
  assert.match(chat, /process\.env\.GEMINI_CHAT_MODEL \|\| process\.env\.GEMINI_MODEL \|\| 'gemini-3\.5-flash-lite'/);
  assert.match(chat, /encodeURIComponent\(GEMINI_CHAT_MODEL\)/);
  assert.equal(chat.includes("process.env.GEMINI_MODEL || 'gemini-3.6-flash'"), false);
});

test('Gemini endpoints keep the validated lightweight model as the explicit fallback', () => {
  for (const file of ['api_handlers/assistant/gemini.js', 'api_handlers/assistant/command.js']) {
    const source = read(file);
    assert.match(source, /'gemini-3\.5-flash-lite'/, file);
    assert.equal(source.includes('gemini-3.6-flash'), false, file);
  }
});

test('Gemini proxy caps provider latency and distinguishes timeout from provider rejection', () => {
  const source = read('api_handlers/assistant/gemini.js');
  assert.match(source, /GEMINI_REQUEST_TIMEOUT_MS/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /res\.status\(504\)\.json\(\{ error: 'gemini_timeout' \}\)/);
});
