'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const original = 'C:\\Users\\BOB\\Desktop\\Codex Finanzas\\YARBI_BACKEND_MERGED_20260930\\api\\assistant\\collections.js';
const candidate = path.join(__dirname, '..', 'api_handlers', 'assistant', 'collections.js');

test('P0.6.1 collections differs from the original only by the CommonJS handler export token', () => {
  const originalText = fs.readFileSync(original, 'utf8');
  const candidateText = fs.readFileSync(candidate, 'utf8');
  const expected = originalText.replace('export default async function handler(req, res) {', 'module.exports = async function handler(req, res) {');
  assert.notEqual(expected, originalText, 'original contains the expected ESM export token');
  assert.equal(candidateText, expected);
  assert.match(candidateText, /^const \{ validateServerRouteConfig \} = require\(/m);
  assert.doesNotMatch(candidateText, /export default/);
  assert.match(candidateText, /module\.exports = async function handler\(req, res\) \{/);
});

test('P0.6.1 CommonJS collections handler loads and preserves its safe invalid-request response', async () => {
  const handler = require(candidate);
  const state = { status: 200, body: undefined };
  const res = {
    status(value) { state.status = value; return this; },
    setHeader() { return this; },
    json(value) { state.body = value; return this; }
  };
  await handler({ method: 'POST', headers: {}, body: {}, url: '/api/assistant/collections' }, res);
  assert.equal(state.status, 401);
  assert.deepEqual(state.body, { error: 'No autorizado' });
});
