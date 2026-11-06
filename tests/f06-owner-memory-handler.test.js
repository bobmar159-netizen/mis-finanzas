'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOwnerMemoryHandler } = require('../api_handlers/assistant/memory');

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const ENV_KEYS = ['VERCEL_ENV','YARBI_PREVIEW_OWNER_REFERENCES_ONLY','YARBI_PREVIEW_SUPABASE_PROJECT_REF','SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_PUBLISHABLE_KEY','YARBI_TRACE_HMAC_KEY'];
function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }
function responseBox() { const state = { status: 200, body: null }; return { state, status(value) { state.status = value; return this; }, json(value) { state.body = value; return this; } }; }
function preview(run) { const old = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]])); Object.assign(process.env, { VERCEL_ENV:'preview', YARBI_PREVIEW_OWNER_REFERENCES_ONLY:'true', YARBI_PREVIEW_SUPABASE_PROJECT_REF:'uevilhbstnmmdlgyshlv', SUPABASE_URL:'https://uevilhbstnmmdlgyshlv.supabase.co', SUPABASE_SECRET_KEY:'f06-isolated-service-key-not-real-123456789012345678', SUPABASE_PUBLISHABLE_KEY:'f06-isolated-publishable-key-not-real-123456789012', YARBI_TRACE_HMAC_KEY:'f06-trace-hmac-key-not-real-123456789012345678' }); return Promise.resolve().then(run).finally(() => Object.entries(old).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value)); }
function client(calls, store) { return async (raw, options = {}) => { const url = new URL(String(raw)); calls.push({ host:url.hostname, path:url.pathname, method:options.method || 'GET' }); assert.equal(url.hostname, 'uevilhbstnmmdlgyshlv.supabase.co'); if (url.pathname === '/auth/v1/user') return json({ id: OWNER }); if (url.pathname === '/rest/v1/yarbi_owner_instructions' && (!options.method || options.method === 'GET')) return json(store.rows); if (url.pathname === '/rest/v1/yarbi_owner_instructions' && options.method === 'POST') { const row = { id:'00000000-0000-4000-8000-0000000000b1', ...JSON.parse(options.body), created_at:'2026-11-06T12:00:00.000Z', updated_at:'2026-11-06T12:00:00.000Z' }; store.rows.unshift(row); return json([row], 201); } throw new Error('unexpected_request'); }; }

test('F06 propone sin escribir y confirma una única vez para el owner autenticado', async () => preview(async () => {
  const calls = []; const store = { rows: [] }; const handler = createOwnerMemoryHandler({ fetchImpl: client(calls, store), now: () => Date.parse('2026-11-06T12:00:00.000Z') });
  const proposed = responseBox(); await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'propose', utterance:'Yarbi, recuerda que prefiero respuestas cortas.' } }, proposed);
  assert.equal(proposed.state.status, 200); assert.equal(proposed.state.body.outcome, 'proposal_requires_confirmation'); assert.equal(calls.some(call => call.method === 'POST'), false);
  const confirmed = responseBox(); await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'confirm', confirm:true, proposal_token:proposed.state.body.proposal_token } }, confirmed);
  assert.equal(confirmed.state.status, 200); assert.equal(confirmed.state.body.outcome, 'created'); assert.equal(store.rows.length, 1);
  const duplicate = responseBox(); await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'propose', utterance:'Yarbi, recuerda que prefiero respuestas cortas.' } }, duplicate);
  assert.equal(duplicate.state.body.outcome, 'duplicate'); assert.equal(store.rows.length, 1);
}));

test('F06 rechaza owner declarado por navegador y no sale del Supabase aislado', async () => preview(async () => {
  const calls = []; const handler = createOwnerMemoryHandler({ fetchImpl: client(calls, { rows: [] }) }); const res = responseBox();
  await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'list', owner_account_id:'00000000-0000-4000-8000-0000000000a2' } }, res);
  assert.equal(res.state.status, 400); assert.equal(calls.length, 0);
}));
