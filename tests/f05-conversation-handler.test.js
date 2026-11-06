'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationHandler } = require('../api_handlers/assistant/conversation');

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const ENV_KEYS = ['VERCEL_ENV', 'YARBI_PREVIEW_OWNER_REFERENCES_ONLY', 'YARBI_PREVIEW_SUPABASE_PROJECT_REF', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'YARBI_TRACE_HMAC_KEY', 'YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING', 'GEMINI_API_KEY', 'GEMINI_KEY'];
const NOW = Date.parse('2026-11-05T17:00:00.000Z');

function responseBox() { const state = { status: 200, body: null }; return { state, status(value) { state.status = value; return this; }, json(value) { state.body = value; return this; } }; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }
function withPreviewEnv(run) {
  const before = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    VERCEL_ENV: 'preview', YARBI_PREVIEW_OWNER_REFERENCES_ONLY: 'true', YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
    SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co', SUPABASE_SECRET_KEY: 'f05-isolated-service-key-not-real-123456789012345678',
    SUPABASE_PUBLISHABLE_KEY: 'f05-isolated-publishable-key-not-real-123456789012', YARBI_TRACE_HMAC_KEY: 'f05-trace-hmac-key-not-real-123456789012345678'
  });
  delete process.env.YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_KEY;
  return Promise.resolve().then(run).finally(() => Object.entries(before).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value));
}

test('F05 handler autentica, mantiene scope y responde Agenda sintética sin Gemini ni egress externo', async () => withPreviewEnv(async () => {
  const calls = [];
  const fetchImpl = async (raw, options = {}) => {
    const url = new URL(String(raw)); calls.push({ host: url.hostname, path: url.pathname, method: options.method || 'GET' });
    assert.equal(url.hostname, 'uevilhbstnmmdlgyshlv.supabase.co');
    if (url.pathname === '/auth/v1/user') return json({ id: OWNER });
    if (url.pathname === '/rest/v1/yarbi_owner_contact_scope') return json([{ contact_id: 17 }]);
    if (url.pathname === '/rest/v1/yarbi_agent_actions') return json([JSON.parse(options.body)[0]], 201);
    if (url.pathname === '/rest/v1/agenda_events') return json([{ id: 'F05-AGENDA-1', contact_id: 17, event_type: 'visita', service: 'instalacion_nueva', status: 'scheduled', starts_at: '2026-11-06T15:00:00.000Z' }]);
    if (url.pathname === '/rest/v1/crm_contacts') return json([{ id: 17, display_name: 'F05-Synthetic', latest_service: 'instalacion_nueva' }]);
    if (['/rest/v1/contact_identifiers', '/rest/v1/yarbi_contact_operational_memory', '/rest/v1/whatsapp_messages', '/rest/v1/ai_message_analysis', '/rest/v1/yarbi_receivables'].includes(url.pathname)) return json([]);
    throw new Error('unexpected_synthetic_request');
  };
  const handler = createConversationHandler({ fetchImpl, now: () => NOW, providerFactory: () => { throw new Error('gemini_must_not_initialize'); } });
  const res = responseBox();
  await handler({ method: 'POST', url: '/api/assistant/conversation', headers: { authorization: 'Bearer synthetic-owner-session' }, body: { utterance: '¿Qué tengo mañana?' } }, res);
  assert.equal(res.state.status, 200, JSON.stringify(res.state.body));
  assert.equal(res.state.body.execute, false);
  assert.equal(res.state.body.outcome, 'fast_local_agenda');
  assert.equal(res.state.body.commercial_effects_allowed, false);
  assert.equal(typeof res.state.body.conversation_token, 'string');
  assert.equal(calls.some(call => /gemini|google|whatsapp|notion|calendar/i.test(call.host)), false);
  assert.equal(calls.filter(call => call.path === '/rest/v1/yarbi_agent_actions').length, 3, 'start, terminal and close trace only');
}));

test('F05 handler rechaza ausencia de Bearer y scope declarado por navegador antes de leer datos', async () => withPreviewEnv(async () => {
  let calls = 0;
  const handler = createConversationHandler({ fetchImpl: async () => { calls += 1; return json([]); }, now: () => NOW });
  const noBearer = responseBox();
  await handler({ method: 'POST', url: '/api/assistant/conversation', headers: {}, body: { utterance: '¿Qué tengo mañana?' } }, noBearer);
  assert.equal(noBearer.state.status, 401); assert.equal(calls, 0);
  const injected = responseBox();
  await handler({ method: 'POST', url: '/api/assistant/conversation', headers: { authorization: 'Bearer synthetic' }, body: { utterance: '¿Qué tengo mañana?', owner_id: OWNER } }, injected);
  assert.equal(injected.state.status, 400); assert.equal(injected.state.body.error, 'owner_scope_client_input_forbidden'); assert.equal(calls, 0);
}));
