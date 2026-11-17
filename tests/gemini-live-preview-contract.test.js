'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Live token contract is fixed to v1beta and gemini-3.8-live with short-lived, one-use auth', () => {
  const backend = read('api_handlers/assistant/live-token.js');
  assert.match(backend, /const GEMINI_LIVE_MODEL = 'gemini-3\.8-live'/);
  assert.match(backend, /const GEMINI_LIVE_API_VERSION = 'v1beta'/);
  assert.match(backend, /liveConnectConstraints: \{ model: GEMINI_LIVE_MODEL \}/);
  assert.match(backend, /uses: 1/);
  assert.match(backend, /now \+ 30 \* 60 \* 1000/);
  assert.match(backend, /now \+ 60 \* 1000/);
  assert.match(backend, /authenticatedOwnerIdentity\(req, runtime\)/);
  assert.equal(/process\.env\.GEMINI_LIVE_(?:MODEL|API_VERSION)/.test(backend), false);
  assert.equal(/req\.(?:query|headers).*protocol/i.test(backend), false);
});

test('Live diagnostic and session use the authenticated owner token, server-selected model, and v1beta socket', () => {
  const frontend = read('frontend/index.html');
  const diagnosticStart = frontend.indexOf('async function gfcRunLiveDiagnostic');
  const diagnosticEnd = frontend.indexOf('function gfcBuildDiagnosticReport', diagnosticStart);
  const tokenStart = frontend.indexOf('async function gfcGetGeminiLiveToken');
  const tokenEnd = frontend.indexOf('function gfcLiveCaptureDiagnostics', tokenStart);
  const liveStart = frontend.indexOf('async function gfcStartGeminiLive');
  const liveEnd = frontend.indexOf('function gfcStopGeminiLive', liveStart);
  assert.ok(diagnosticStart >= 0 && diagnosticEnd > diagnosticStart);
  assert.ok(tokenStart >= 0 && tokenEnd > tokenStart);
  assert.ok(liveStart >= 0 && liveEnd > liveStart);
  const diagnostic = frontend.slice(diagnosticStart, diagnosticEnd);
  const token = frontend.slice(tokenStart, tokenEnd);
  const live = frontend.slice(liveStart, liveEnd);
  for (const block of [diagnostic, token]) {
    assert.match(block, /Authorization: 'Bearer ' \+/);
    assert.equal(block.includes('X-Assistant-Token'), false);
  }
  assert.match(token, /data\.apiVersion !== 'v1beta'/);
  assert.match(token, /model: data\.model/);
  assert.match(diagnostic, /model: 'models\/' \+ tokenData\.model/);
  assert.match(live, /BidiGenerateContentConstrained\?access_token=/);
  assert.match(live, /model: 'models\/' \+ tokenInfo\.model/);
  assert.equal(frontend.includes('GFC_YARBI_LIVE_MODEL'), false);
  assert.equal(frontend.includes('live-token?protocol='), false);
});

test('Live retains the existing single-chat knowledge tool route to the authenticated File Search tutor', () => {
  const frontend = read('frontend/index.html');
  const tutor = read('frontend/yarbi-multimodal-tutor.js');
  const api = read('api_handlers/assistant/gemini.js');
  assert.match(frontend, /name: 'get_approved_knowledge'/);
  assert.match(frontend, /window\.gfcYarbiMultimodalAnswer\(query, \{ context \}\)/);
  assert.match(tutor, /queryGeminiFileSearch\(queryForRetrieval, conversationContext\)/);
  assert.match(tutor, /provider:'gemini_file_search'/);
  assert.match(api, /authenticatedOwnerIdentity\(req, config\)/);
  assert.match(api, /owner_account_id=eq\.' \+ encodeURIComponent\(ownerId\)/);
  assert.match(api, /type:'file_search', file_search_store_names:sources\.map/);
  assert.match(api, /source_sha256:matched\.source_sha256/);
});
