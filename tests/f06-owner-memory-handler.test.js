'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOwnerMemoryHandler } = require('../api_handlers/assistant/memory');

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const ENV_KEYS = ['VERCEL_ENV','YARBI_PREVIEW_OWNER_REFERENCES_ONLY','YARBI_PREVIEW_SUPABASE_PROJECT_REF','SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_PUBLISHABLE_KEY','YARBI_TRACE_HMAC_KEY','YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING','YARBI_PREVIEW_HISTORICAL_INTELLIGENCE_ENABLED','GEMINI_API_KEY','GEMINI_KEY'];
function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }
function responseBox() { const state = { status: 200, body: null }; return { state, status(value) { state.status = value; return this; }, json(value) { state.body = value; return this; } }; }
function preview(run) { const old = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]])); Object.assign(process.env, { VERCEL_ENV:'preview', YARBI_PREVIEW_OWNER_REFERENCES_ONLY:'true', YARBI_PREVIEW_SUPABASE_PROJECT_REF:'uevilhbstnmmdlgyshlv', SUPABASE_URL:'https://uevilhbstnmmdlgyshlv.supabase.co', SUPABASE_SECRET_KEY:'f06-isolated-service-key-not-real-123456789012345678', SUPABASE_PUBLISHABLE_KEY:'f06-isolated-publishable-key-not-real-123456789012', YARBI_TRACE_HMAC_KEY:'f06-trace-hmac-key-not-real-123456789012345678' }); return Promise.resolve().then(run).finally(() => Object.entries(old).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value)); }
function client(calls, store) { return async (raw, options = {}) => { const url = new URL(String(raw)); calls.push({ host:url.hostname, path:url.pathname, method:options.method || 'GET' }); assert.equal(url.hostname, 'uevilhbstnmmdlgyshlv.supabase.co'); if (url.pathname === '/auth/v1/user') return json({ id: OWNER }); if (url.pathname === '/rest/v1/yarbi_owner_instructions' && (!options.method || options.method === 'GET')) return json(store.rows); if (url.pathname === '/rest/v1/yarbi_owner_instructions' && options.method === 'POST') { const row = { id:'00000000-0000-4000-8000-0000000000b1', ...JSON.parse(options.body), created_at:'2026-11-06T12:00:00.000Z', updated_at:'2026-11-06T12:00:00.000Z' }; store.rows.unshift(row); return json([row], 201); } throw new Error('unexpected_request'); }; }
function historicalClient(calls) { return async (raw, options = {}) => { const url = new URL(String(raw)); calls.push({ host:url.hostname, path:url.pathname, method:options.method || 'GET', body:options.body || null }); assert.equal(url.hostname, 'uevilhbstnmmdlgyshlv.supabase.co'); if (url.pathname === '/auth/v1/user') return json({ id: OWNER }); if (url.pathname === '/rest/v1/yarbi_owner_contact_scope') return json([{ contact_id: 71 }]); if (url.pathname === '/rest/v1/whatsapp_messages') return json([{ id:'historical-1', contact_id:71, text:'Necesito una instalación', timestamp:1, metadata:{ historical:true, direction:'incoming' } }]); if (url.pathname === '/rest/v1/rpc/enqueue_yarbi_historical_intelligence_batch') return json([{ batch_id:'00000000-0000-4000-8000-0000000000b1', outcome:'created', status:'ready', attempt_count:0 }]); throw new Error('unexpected_request:' + url.pathname); }; }
function processingClient(calls) { return async (raw, options = {}) => { const url = new URL(String(raw)); calls.push({ host:url.hostname, path:url.pathname, method:options.method || 'GET', body:options.body || null }); assert.equal(url.hostname, 'uevilhbstnmmdlgyshlv.supabase.co'); if (url.pathname === '/auth/v1/user') return json({ id: OWNER }); if (url.pathname === '/rest/v1/yarbi_owner_contact_scope') return json([{ contact_id:71 }]); if (url.pathname === '/rest/v1/rpc/claim_yarbi_historical_intelligence_batch') return json([{ batch_id:'00000000-0000-4000-8000-0000000000b1', contact_id:71, idempotency_key:'a'.repeat(64), message_ids:['historical-1'], outgoing_message_ids:[], segment_index:0, segment_count:1, occurred_from:1, occurred_to:1, attempt_count:1 }]); if (url.pathname === '/rest/v1/whatsapp_messages') return json([{ id:'historical-1', contact_id:71, text:'Necesito una instalación', timestamp:1, metadata:{ historical:true, direction:'incoming' } }]); if (url.pathname === '/rest/v1/rpc/complete_yarbi_historical_intelligence_batch') return json([{ batch_id:'00000000-0000-4000-8000-0000000000b1', status:'awaiting_owner_review' }]); throw new Error('unexpected_request:' + url.pathname); }; }
function reviewClient(calls) { return async (raw, options = {}) => { const url = new URL(String(raw)); calls.push({ host:url.hostname, path:url.pathname, method:options.method || 'GET', body:options.body || null }); assert.equal(url.hostname, 'uevilhbstnmmdlgyshlv.supabase.co'); const proposal = { schema:'yarbi.historical-intelligence-result.v1', contact_id:'71', contact_context_observations:[], reply_style_patterns:[] }; if (url.pathname === '/auth/v1/user') return json({ id:OWNER }); if (url.pathname === '/rest/v1/rpc/list_yarbi_historical_intelligence_review_batches') return json([{ batch_id:'00000000-0000-4000-8000-0000000000b1', contact_id:71, status:'awaiting_owner_review', segment_index:0, segment_count:1, proposal }]); if (url.pathname === '/rest/v1/rpc/review_yarbi_historical_intelligence_batch') return json([{ batch_id:'00000000-0000-4000-8000-0000000000b1', contact_id:71, status:'approved', proposal }]); throw new Error('unexpected_request:' + url.pathname); }; }

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

test('F07 conserva procedencia voice solo tras la confirmación explícita del owner', async () => preview(async () => {
  const calls = []; const store = { rows: [] }; const handler = createOwnerMemoryHandler({ fetchImpl: client(calls, store), now: () => Date.parse('2026-11-06T12:00:00.000Z') });
  const proposed = responseBox(); await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'propose', source_channel:'voice', utterance:'Yarbi, recuerda que prefiero respuestas cortas.' } }, proposed);
  assert.equal(proposed.state.body.proposal.source_channel, 'voice'); assert.equal(store.rows.length, 0);
  const confirmed = responseBox(); await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'confirm', confirm:true, proposal_token:proposed.state.body.proposal_token } }, confirmed);
  assert.equal(store.rows[0].source_channel, 'voice'); assert.equal(store.rows[0].origin, 'voice_proposed');
}));

test('historial canónico se planifica desde owner scope sin exponer texto ni escribir', async () => preview(async () => {
  const calls = []; const handler = createOwnerMemoryHandler({ fetchImpl: historicalClient(calls) }); const res = responseBox();
  await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'historical-plan', limit:12 } }, res);
  assert.equal(res.state.status, 200); assert.equal(res.state.body.outcome, 'historical_plan_ready');
  assert.equal(res.state.body.tasks[0].contact_id, 71); assert.equal(JSON.stringify(res.state.body).includes('Necesito una instalación'), false);
  assert.equal(calls.some(call => call.path.includes('/rpc/')), false);
  assert.equal(calls.some(call => call.path === '/rest/v1/yarbi_owner_instructions'), false);
}));

test('historial requiere confirmación antes de encolar y la cola no tiene efectos comerciales', async () => preview(async () => {
  const calls = []; const handler = createOwnerMemoryHandler({ fetchImpl: historicalClient(calls) }); const rejected = responseBox();
  await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'historical-enqueue' } }, rejected);
  assert.equal(rejected.state.status, 400); assert.equal(rejected.state.body.error, 'historical_enqueue_confirmation_required');
  const confirmed = responseBox(); await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'historical-enqueue', confirm_historical_preparation:true } }, confirmed);
  assert.equal(confirmed.state.status, 200); assert.equal(confirmed.state.body.outcome, 'historical_segments_enqueued');
  assert.equal(confirmed.state.body.commercial_effects_allowed, false);
  assert.equal(calls.some(call => call.path.includes('generativelanguage')), false);
}));

test('historial no llama al modelo sin las dos banderas Preview y una confirmación por segmento', async () => preview(async () => {
  const calls = []; let factoryCalls = 0;
  const handler = createOwnerMemoryHandler({ fetchImpl: processingClient(calls), historicalInterpreterFactory: () => { factoryCalls += 1; throw new Error('must_not_create_provider'); } });
  const res = responseBox();
  await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'historical-process-one', confirm_historical_model_call:true } }, res);
  assert.equal(res.state.status, 403); assert.equal(res.state.body.error, 'historical_intelligence_preview_not_enabled');
  assert.equal(factoryCalls, 0); assert.equal(calls.length, 1);
}));

test('historial procesa exactamente un segmento confirmado con intérprete inyectado y sin efectos comerciales', async () => preview(async () => {
  Object.assign(process.env, { YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING:'true', YARBI_PREVIEW_HISTORICAL_INTELLIGENCE_ENABLED:'true', GEMINI_API_KEY:'synthetic-gemini-key-not-real' });
  const calls = []; let modelCalls = 0;
  const handler = createOwnerMemoryHandler({
    fetchImpl: processingClient(calls),
    historicalInterpreterFactory: ({ apiKey }) => {
      assert.equal(apiKey, 'synthetic-gemini-key-not-real');
      return { interpretHistoricalSegment: async request => { modelCalls += 1; assert.match(request.prompt, /No declares pagos/); return { contact_context_observations:[{ category:'service_interest', summary:'Consulta un servicio.', source_message_ids:['historical-1'], confidence:0.9 }], reply_style_patterns:[], requires_owner_review:true }; } };
    }
  });
  const missing = responseBox();
  await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'historical-process-one' } }, missing);
  assert.equal(missing.state.status, 400); assert.equal(modelCalls, 0);
  const accepted = responseBox();
  await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'historical-process-one', confirm_historical_model_call:true } }, accepted);
  assert.equal(accepted.state.status, 200); assert.equal(accepted.state.body.outcome, 'historical_segment_awaiting_owner_review');
  assert.equal(accepted.state.body.gemini_invoked, true); assert.equal(accepted.state.body.commercial_effects_allowed, false);
  assert.equal(modelCalls, 1); assert.equal(calls.filter(call => call.path === '/rest/v1/rpc/claim_yarbi_historical_intelligence_batch').length, 1);
  assert.equal(calls.filter(call => call.path === '/rest/v1/rpc/complete_yarbi_historical_intelligence_batch').length, 1);
}));

test('la revisión histórica queda vinculada al owner y no ejecuta cambios comerciales', async () => preview(async () => {
  const calls = []; const handler = createOwnerMemoryHandler({ fetchImpl:reviewClient(calls) });
  const listed = responseBox();
  await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'historical-review-list' } }, listed);
  assert.equal(listed.state.status, 200); assert.equal(listed.state.body.outcome, 'historical_review_ready');
  assert.equal(listed.state.body.batches[0].proposal.commercial_effects_allowed, false);
  const rejected = responseBox();
  await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'historical-review-confirm', batch_id:'00000000-0000-4000-8000-0000000000b1', decision:'approve' } }, rejected);
  assert.equal(rejected.state.status, 400); assert.equal(rejected.state.body.error, 'historical_review_confirmation_required');
  const approved = responseBox();
  await handler({ method:'POST', url:'/api/assistant/memory', headers:{ authorization:'Bearer synthetic' }, body:{ action:'historical-review-confirm', confirm_historical_review:true, batch_id:'00000000-0000-4000-8000-0000000000b1', decision:'approve' } }, approved);
  assert.equal(approved.state.status, 200); assert.equal(approved.state.body.outcome, 'historical_review_approved');
  assert.equal(approved.state.body.commercial_effects_allowed, false);
  assert.equal(calls.filter(call => call.path === '/rest/v1/rpc/review_yarbi_historical_intelligence_batch').length, 1);
}));
