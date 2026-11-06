const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function loadStatusLabel() {
  const start = frontend.indexOf('// BACKGROUND_PROCESSING_STATUS_V1');
  const end = frontend.indexOf('async function gfcHandleLiveToolCalls', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(frontend.slice(start, end), context);
  return context.gfcLiveToolStatusLabel;
}

test('processing status: structured reads are labeled as consultation, not reprocessing', () => {
  const label = loadStatusLabel();
  assert.equal(label([{ name:'get_client_memory' }]), 'Consultando datos ya procesados...');
  assert.equal(label([{ name:'get_agenda_summary' }, { name:'get_proactive_alerts' }]), 'Consultando datos ya procesados...');
});

test('processing status: write-capable tools use a distinct execution label', () => {
  const label = loadStatusLabel();
  assert.equal(label([{ name:'record_daily_outcome' }]), 'Ejecutando la solicitud...');
});

test('processing status: manual update downloads the mirror and never starts AI analysis', () => {
  const start = frontend.indexOf('async function gfcProcessYarbiInformation');
  const end = frontend.indexOf('function gfcOpenCopilotModal', start);
  const block = frontend.slice(start, end);
  assert.match(block, /gfcSyncYarbiLocalMirror\(\{ reason: 'manual-download', backfill: true \}\)/);
  assert.doesNotMatch(block, /requested_by|action:\s*'process'|Gemini.*proces/i);
});

test('processing status: real background work remains visible as background', () => {
  const start = frontend.indexOf('function gfcSetYarbiProcessingUi');
  const end = frontend.indexOf('async function gfcRefreshYarbiProcessingStatus', start);
  const block = frontend.slice(start, end);
  assert.match(block, /chat\(s\) en segundo plano/);
  assert.match(block, /chat\(s\) pendientes · proceso automático/);
  assert.match(block, /Yarbi al día · chats y memoria local/);
});
