const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function memoryBlock() {
  const start = frontend.indexOf('// FAST_READ_PATH_V1');
  const end = frontend.indexOf('function gfcLiveInputRequestsCurrentClock', start);
  return frontend.slice(start, end);
}

test('fast read: exact client queries use local structured data before cache and Supabase', () => {
  const block = memoryBlock();
  const identity = block.indexOf('gfcResolveLocalClientIdentity');
  const local = block.indexOf('gfcYarbiLocalFindMemory');
  const cache = block.indexOf('gfcClientMemoryCacheRead');
  const remote = block.indexOf("fetch('https://misfinanzas-backend.vercel.app/api/whatsapp/messages?'");
  assert.ok(identity >= 0 && local > identity && cache > local && remote > cache);
});

test('fast read: all structured tiers declare that raw history was not used', () => {
  const block = memoryBlock();
  assert.match(block, /read_tier: 'local_structured'/);
  assert.match(block, /read_tier: 'memory_cache'/);
  assert.match(block, /read_tier: 'supabase_structured'/);
  const safeReturns = block.match(/raw_history_used: false/g) || [];
  assert.equal(safeReturns.length, 4);
});

test('fast read: raw WhatsApp fallback runs only after structured memory misses', () => {
  const start = frontend.indexOf("if (name === 'get_client_memory')");
  const end = frontend.indexOf("if (name === 'get_crm_overview')", start);
  const block = frontend.slice(start, end);
  assert.ok(block.indexOf('gfcFetchProcessedYarbiMemory') < block.indexOf('gfcFetchCloudWhatsAppMessages'));
  assert.match(block, /memory\.verified_local_identity/);
  assert.match(block, /raw_history_used: true/);
  assert.match(block, /fallback_reason: 'structured_memory_miss'/);
});

test('fast read: a stale local mirror responds immediately and refreshes in background', () => {
  const start = frontend.indexOf('async function gfcYarbiLocalFindMemory');
  const end = frontend.indexOf('async function gfcYarbiLocalMessages', start);
  const block = frontend.slice(start, end);
  assert.match(block, /void gfcYarbiLocalEnsureFresh\('memory-query-background'\)/);
  assert.doesNotMatch(block, /await gfcYarbiLocalEnsureFresh\('memory-query'/);
});
