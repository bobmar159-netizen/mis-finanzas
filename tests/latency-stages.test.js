const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('latency: diagnostics expose the eight required interaction stages', () => {
  assert.match(frontend, /LATENCY_STAGES_V1/);
  [
    'speechEndAt',
    'intentDetectionMs',
    'clientResolutionMs',
    'supabaseQueryMs',
    'additionalProcessingMs',
    'responseGenerationMs',
    'firstAudioMs',
    'playbackMs'
  ].forEach(field => assert.match(frontend, new RegExp(field)));
});

test('latency: client resolution and Supabase timing wrap real data access', () => {
  const memoryStart = frontend.indexOf('async function gfcFetchProcessedYarbiMemory');
  const memoryEnd = frontend.indexOf('async function gfcExecuteLiveTool', memoryStart);
  const memoryBlock = frontend.slice(memoryStart, memoryEnd);
  assert.match(memoryBlock, /gfcVoicePipelineLatencyStart\('supabase_query'/);
  assert.match(memoryBlock, /gfcVoicePipelineLatencyEnd\('supabase_query'/);
  const toolsStart = frontend.indexOf('async function gfcHandleLiveToolCalls');
  const toolsEnd = frontend.indexOf('async function gfcGetGeminiLiveToken', toolsStart);
  const toolsBlock = frontend.slice(toolsStart, toolsEnd);
  assert.match(toolsBlock, /get_client_memory', 'find_whatsapp_client/);
  assert.match(toolsBlock, /gfcVoicePipelineLatencyStart\('client_resolution'/);
  assert.match(toolsBlock, /gfcVoicePipelineLatencyEnd\('client_resolution'/);
});

test('latency: processing, generation, first audio and playback have independent markers', () => {
  assert.match(frontend, /gfcVoicePipelineLatencyStart\('additional_processing'/);
  assert.match(frontend, /gfcVoicePipelineLatencyEnd\('additional_processing'/);
  assert.match(frontend, /gfcVoicePipelineLatencyStart\('response_generation'/);
  assert.match(frontend, /gfcVoicePipelineLatencyEnd\('response_generation'/);
  assert.match(frontend, /gfcVoicePipelineLatencyMark\('first_audio'/);
  assert.match(frontend, /gfcVoicePipelineLatencyStart\('playback'/);
  assert.match(frontend, /gfcVoicePipelineLatencyEnd\('playback'/);
});

test('latency: instrumentation remains diagnostic and does not alter VAD decisions', () => {
  const start = frontend.indexOf('// LATENCY_STAGES_V1');
  const end = frontend.indexOf('function gfcVoicePipelineSnapshotTurn', start);
  const block = frontend.slice(start, end);
  assert.doesNotMatch(block, /voiceThreshold|bargeThreshold|GFC_LIVE_VAD|onaudioprocess/);
});

test('latency: client lookup prioritizes structured memory before message scans', () => {
  const routingStart = frontend.indexOf("const liveRoutingRule = '");
  const routingEnd = frontend.indexOf("session.liveContextTokensBeforeSend", routingStart);
  const routing = frontend.slice(routingStart, routingEnd);
  assert.match(routing, /ORDEN ESTRICTO PARA CLIENTES/);
  assert.match(routing, /llama SOLO get_client_memory primero y espera su resultado/);
  assert.match(routing, /No llames list_whatsapp_messages ni find_whatsapp_client en esa primera ronda/);
});
