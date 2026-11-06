const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const webhook = fs.readFileSync(path.join(root, 'api', 'webhook.js'), 'utf8');

test('two brains: webhook persists a message before scheduling canonical background processing', () => {
  const persisted = webhook.indexOf('const whatsappSaveResponse = await fetch');
  const scheduled = webhook.indexOf('scheduleCanonicalProcessing(messageId)', persisted);
  assert.ok(persisted >= 0 && scheduled > persisted);
  assert.match(webhook, /waitUntil\(task\)/);
  assert.match(webhook, /requested_by: 'whatsapp-webhook-background'/);
});

test('two brains: Gemini Live startup never starts historical AI processing', () => {
  const start = frontend.indexOf('async function gfcStartGeminiLive');
  const end = frontend.indexOf('function gfcStopGeminiLive', start);
  const block = frontend.slice(start, end);
  assert.doesNotMatch(block, /\/api\/ai\/process|scheduleCanonicalProcessing|requested_by|history-backfill/);
  assert.match(block, /gfcBuildLiveMemoryContext\(\)/);
  assert.match(block, /tools: gfcLiveToolDeclarations\(\)/);
});

test('two brains: conversation reads structured tools instead of reconstructing CRM memory', () => {
  const start = frontend.indexOf('async function gfcExecuteLiveTool');
  const end = frontend.indexOf('// BACKGROUND_PROCESSING_STATUS_V1', start);
  const block = frontend.slice(start, end);
  assert.match(block, /get_client_memory/);
  assert.match(block, /gfcFetchProcessedYarbiMemory\('memory'/);
  assert.match(block, /get_crm_overview/);
  assert.match(block, /gfcFetchProcessedYarbiMemory\('memory-overview'/);
});

test('two brains: local mirror synchronization is an independent background lifecycle', () => {
  const start = frontend.indexOf('function gfcRunYarbiBackgroundSync');
  const end = frontend.indexOf('function gfcYarbiLocalNormalize', start);
  const block = frontend.slice(start, end);
  assert.match(block, /gfcSyncYarbiLocalMirror/);
  assert.match(block, /visibilitychange/);
  assert.match(block, /setInterval/);
  assert.match(block, /background-auto|startup/);
  assert.doesNotMatch(block, /gfcStartGeminiLive/);
});
