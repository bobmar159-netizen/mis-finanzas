'use strict';

// FASE 2D.2: los handlers reales se ejecutan con un gateway local en memoria.
// Cualquier origen distinto al gateway sintético se rechaza antes de salir de
// este proceso. No usa Supabase, Gemini, Maps ni otros servicios remotos.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://f2d2.local.invalid';
const TOKEN = 'a'.repeat(40);
const TRACE_SECRET = 't'.repeat(40);
const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';
const PREVIEW_HOST = 'yarbi-f2d2-synthetic.vercel.app';
const PREVIEW_SUPABASE_ORIGIN = `https://${PREVIEW_REF}.supabase.co`;
const PREVIEW_PROCESSOR_ORIGIN = `https://${PREVIEW_HOST}`;
const YCLOUD_WEBHOOK_SECRET = 'f2d2-local-webhook-secret';

function response(status, body) {
  const payload = JSON.stringify(body === undefined ? null : body);
  return { ok: status >= 200 && status < 300, status, url: ORIGIN + '/synthetic', headers: { get: () => null }, text: async () => payload, json: async () => JSON.parse(payload) };
}

function makeRes() {
  return { code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end(body) { this.body = body; return this; } };
}

function loadHandler(relativeFile) {
  const file = path.join(ROOT, relativeFile);
  const source = fs.readFileSync(file, 'utf8')
    // Las rutas de Vercel pueden declarar configuración de API junto al
    // export por defecto. El sandbox CJS conserva esa declaración como una
    // constante local antes de ejecutar el handler real.
    .replace(/^export const config\s*=/m, 'const config =')
    .replace('export default async function handler(req, res) {', 'async function handler(req, res) {')
    .concat('\nmodule.exports = handler;\n');
  const holder = { exports: {} };
  const wrapped = vm.runInThisContext(Module.wrap(source), { filename: file + '.f2d2.cjs' });
  wrapped.call(holder.exports, holder.exports, createRequire(file), holder, file, path.dirname(file));
  return holder.exports;
}

function loadCommonJsHandler(relativeFile) {
  const file = path.join(ROOT, relativeFile);
  delete require.cache[file];
  return require(file);
}

function installSandbox(scenario) {
  const prior = { fetch: global.fetch, load: Module._load, env: {} };
  const variables = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'ASSISTANT_API_TOKEN', 'GEMINI_API_KEY', 'GEMINI_KEY', 'YARBI_TRACE_HMAC_KEY', 'AI_PROCESSOR_URL', 'ENABLE_LEGACY_WEBHOOK_EXTRACTION', 'YCLOUD_WEBHOOK_SECRET', 'VERCEL_ENV', 'YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY', 'YARBI_PREVIEW_AUDIT_ONLY', 'YARBI_PREVIEW_SUPABASE_PROJECT_REF', 'YARBI_PREVIEW_SYNTHETIC_TOKEN', 'YARBI_PREVIEW_DEPLOYMENT_HOST', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL'];
  for (const key of variables) prior.env[key] = process.env[key];
  const state = { calls: [], external_attempts: [], canonical: [], canonicalById: new Map(), legacy: [], patches: [], processor_requests: 0, waited: [], ledger: new Map() };
  Object.assign(process.env, {
    SUPABASE_URL: PREVIEW_SUPABASE_ORIGIN,
    SUPABASE_SECRET_KEY: 's'.repeat(40),
    ASSISTANT_API_TOKEN: TOKEN,
    GEMINI_API_KEY: '',
    GEMINI_KEY: '',
    YARBI_TRACE_HMAC_KEY: TRACE_SECRET,
    AI_PROCESSOR_URL: PREVIEW_PROCESSOR_ORIGIN,
    ENABLE_LEGACY_WEBHOOK_EXTRACTION: 'false',
    YCLOUD_WEBHOOK_SECRET,
    VERCEL_ENV: 'preview',
    YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: 'true',
    YARBI_PREVIEW_AUDIT_ONLY: 'false',
    YARBI_PREVIEW_SUPABASE_PROJECT_REF: PREVIEW_REF,
    YARBI_PREVIEW_SYNTHETIC_TOKEN: 'p'.repeat(40),
    YARBI_PREVIEW_DEPLOYMENT_HOST: PREVIEW_HOST,
    VERCEL_URL: PREVIEW_HOST,
    VERCEL_PROJECT_PRODUCTION_URL: ''
  });
  global.fetch = async (rawUrl, options = {}) => {
    const url = new URL(String(rawUrl));
    const method = String(options.method || 'GET').toUpperCase();
    state.calls.push({ method, origin: url.origin, path: url.pathname, query: url.search });
    if (![ORIGIN, PREVIEW_SUPABASE_ORIGIN, PREVIEW_PROCESSOR_ORIGIN].includes(url.origin)) {
      state.external_attempts.push({ method, origin: url.origin, path: url.pathname });
      throw new Error('F2D2_EXTERNAL_EGRESS_BLOCKED');
    }
    if (url.pathname === '/api/ai/process') { state.processor_requests += 1; return response(202, { status: 'synthetic_accepted' }); }
    if (url.pathname === '/rest/v1/whatsapp_messages') {
      if (method === 'POST') {
        if (scenario === 'webhook_storage_failure') return response(503, { error: 'F2D2_CANONICAL_STORAGE_FAILURE' });
        const row = JSON.parse(String(options.body || '[]'))[0]; state.canonical.push(row); state.canonicalById.set(String(row.id), row); return response(201, [row]);
      }
      if (method === 'GET') {
        if (scenario === 'processor') return response(200, [{ id: 'F2D2-PROCESSOR-URL', phone: '', title: 'F2D2 identidad pendiente', text: 'https://maps.app.goo.gl/F2D2synthetic', maps_url: null, timestamp: Date.now(), app_name: 'F2D2', metadata: { direction: 'incoming', historical: false } }]);
        const id = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
        return response(200, state.canonicalById.has(id) ? [state.canonicalById.get(id)] : []);
      }
      return response(200, []);
    }
    if (url.pathname === '/rest/v1/rpc/claim_yarbi_message_analysis') return response(200, scenario === 'processor' ? [{ analysis_id: 2202, message_id: 'F2D2-PROCESSOR-URL', attempt_count: 1, status: 'processing' }] : []);
    if (url.pathname === '/rest/v1/ai_processing_runs' && method === 'POST') return response(201, [{ id: 'F2D2-run' }]);
    if (url.pathname === '/rest/v1/ai_message_analysis' && method === 'PATCH') { state.patches.push(JSON.parse(String(options.body || '{}'))); return response(200, [{ id: 2202 }]); }
    if (url.pathname === '/rest/v1/yarbi_agent_actions') {
      if (method === 'POST') {
        const record = JSON.parse(String(options.body || '[]'))[0];
        if (state.ledger.has(record.action_id)) return response(201, []);
        state.ledger.set(record.action_id, record);
        return response(201, [record]);
      }
      const actionId = String(url.searchParams.get('action_id') || '').replace(/^eq\./, '');
      return response(200, state.ledger.has(actionId) ? [state.ledger.get(actionId)] : []);
    }
    if (url.pathname === '/rest/v1/messages') { state.legacy.push(JSON.parse(String(options.body || '[]'))[0]); return response(201, []); }
    if (url.pathname === '/rest/v1/clients') {
      if (method === 'GET') return response(200, []);
      if (scenario === 'client_association_failure') return response(503, { error: 'F2D2_CLIENT_FAILURE' });
      return response(201, [{ id: 'F2D2-client', name: 'F2D2 Cliente' }]);
    }
    return response(200, []);
  };
  Module._load = function patched(request, parent, isMain) {
    if (request === '@vercel/functions') return { waitUntil: promise => state.waited.push(Promise.resolve(promise)) };
    return prior.load.call(this, request, parent, isMain);
  };
  return {
    state,
    async drain() { while (state.waited.length) await Promise.allSettled(state.waited.splice(0)); },
    restore() { global.fetch = prior.fetch; Module._load = prior.load; for (const [key, value] of Object.entries(prior.env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  };
}

function webhookBody(id, text) {
  return { type: 'whatsapp.inbound_message.received', whatsappInboundMessage: { id, from: '51999990001', type: 'text', text: { body: text }, sendTime: new Date().toISOString(), customerProfile: { name: 'F2D2 Cliente' } } };
}

function signedWebhookRequest(body, timestamp = '1793372400') {
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', YCLOUD_WEBHOOK_SECRET).update(`${timestamp}.${raw}`, 'utf8').digest('hex');
  return {
    method: 'POST',
    headers: { 'ycloud-signature': `t=${timestamp},s=${signature}` },
    rawBody: Buffer.from(raw, 'utf8'),
    body: raw
  };
}

test('F2D2 resolver never fetches Google Maps or short links in synthetic preview', { concurrency: false }, async () => {
  const resolver = require('../lib/location-resolver');
  const priorFetch = global.fetch;
  const priorEnv = { VERCEL_ENV: process.env.VERCEL_ENV, YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: process.env.YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY };
  let fetchCalls = 0;
  try {
    process.env.VERCEL_ENV = 'preview'; process.env.YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY = 'true';
    global.fetch = async () => { fetchCalls += 1; throw new Error('must not fetch'); };
    for (const url of ['https://www.google.com/maps/@-12.0464,-77.0428,16z', 'https://maps.app.goo.gl/F2D2notfollowed']) {
      const value = await resolver.resolveGoogleMapsUrl(url);
      assert.equal(value.resolution_status, 'preview_synthetic_network_disabled');
      assert.equal(value.hasExactCoordinates, false);
      assert.equal(value.lat, null); assert.equal(value.lng, null); assert.equal(value.district, '');
    }
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = priorFetch;
    for (const [key, value] of Object.entries(priorEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('F2D2 real webhook handles Maps, short Maps and no location without external egress', { concurrency: false }, async () => {
  for (const [suffix, text] of [['maps', 'F2D2 https://www.google.com/maps/@-12.0464,-77.0428,16z'], ['short', 'F2D2 https://maps.app.goo.gl/F2D2notfollowed'], ['none', 'F2D2 sin ubicación']]) {
    const sandbox = installSandbox('webhook');
    try {
      const handler = loadHandler('api/webhook.js'); const res = makeRes();
      await handler(signedWebhookRequest(webhookBody('F2D2-WEBHOOK-' + suffix, text)), res); await sandbox.drain();
      assert.equal(res.code, 200); assert.equal(res.body?.status, 'success'); assert.equal(sandbox.state.external_attempts.length, 0);
      const saved = sandbox.state.canonical[0]; assert.ok(saved);
      assert.equal(saved.maps_url, null); assert.equal(saved.metadata.location_district, null);
      assert.equal(sandbox.state.processor_requests, 1);
      assert.ok([...sandbox.state.ledger.values()].some(row => row.result_payload?.stage === 'operation_closed'));
    } finally { sandbox.restore(); }
  }
});

test('F2D2 real webhook records dependency failure locally and schedules no processor', { concurrency: false }, async () => {
  const sandbox = installSandbox('webhook_storage_failure');
  try {
    const handler = loadHandler('api/webhook.js'); const res = makeRes();
    await handler(signedWebhookRequest(webhookBody('F2D2-WEBHOOK-FAIL', 'https://maps.app.goo.gl/F2D2notfollowed')), res); await sandbox.drain();
    assert.equal(res.code, 503); assert.equal(res.body?.error_code, 'canonical_message_storage_failed');
    assert.equal(sandbox.state.processor_requests, 0); assert.equal(sandbox.state.external_attempts.length, 0);
    assert.equal(sandbox.state.calls.filter(call => call.path === '/rest/v1/clients' && call.method !== 'GET').length, 0);
    assert.ok([...sandbox.state.ledger.values()].some(row => row.result_payload?.stage === 'operation_closed'));
  } finally { sandbox.restore(); }
});

test('F2D6 commits canonical storage before client mutation and deduplicates a re-delivery', { concurrency: false }, async () => {
  const sandbox = installSandbox('webhook');
  try {
    const handler = loadHandler('api/webhook.js');
    const first = makeRes();
    const payload = webhookBody('F2D6-ORDER-001', 'F2D6 registrar después del compromiso canónico');
    await handler(signedWebhookRequest(payload), first); await sandbox.drain();
    const repeat = makeRes();
    await handler(signedWebhookRequest(payload), repeat); await sandbox.drain();
    const canonicalPost = sandbox.state.calls.findIndex(call => call.method === 'POST' && call.path === '/rest/v1/whatsapp_messages');
    const clientPost = sandbox.state.calls.findIndex(call => call.method === 'POST' && call.path === '/rest/v1/clients');
    assert.ok(canonicalPost >= 0 && clientPost > canonicalPost);
    assert.equal(sandbox.state.canonical.length, 1);
    assert.equal(sandbox.state.calls.filter(call => call.method === 'POST' && call.path === '/rest/v1/clients').length, 1);
    assert.equal(sandbox.state.processor_requests, 1);
    assert.equal(first.code, 200);
    assert.equal(repeat.code, 200);
    assert.equal(repeat.body?.status, 'duplicate_ignored');
    assert.equal(sandbox.state.external_attempts.length, 0);
  } finally { sandbox.restore(); }
});

test('F2D6 preserves canonical evidence when post-canonical client association fails', { concurrency: false }, async () => {
  const sandbox = installSandbox('client_association_failure');
  try {
    const handler = loadHandler('api/webhook.js'); const res = makeRes();
    await handler(signedWebhookRequest(webhookBody('F2D6-CLIENT-FAIL-001', 'F2D6 sin asociación inventada')), res); await sandbox.drain();
    assert.equal(res.code, 200);
    assert.equal(sandbox.state.canonical.length, 1);
    assert.equal(sandbox.state.legacy.length, 1);
    assert.equal(sandbox.state.legacy[0].client_id, null);
    assert.ok([...sandbox.state.ledger.values()].some(row => row.result_payload?.stage === 'whatsapp_client_association_failed' && row.result_payload?.error_code === 'client_association_failed'));
    assert.equal(sandbox.state.processor_requests, 1);
  } finally { sandbox.restore(); }
});

test('F2D6 rejects missing or forbidden runtime destinations before handler side effects', { concurrency: false }, async () => {
  for (const [name, mutate, expected] of [
    ['missing_supabase', () => { process.env.SUPABASE_URL = ''; }, 'yarbi_config_supabase_url_missing'],
    ['missing_processor', () => { process.env.AI_PROCESSOR_URL = ''; }, 'functional_preview_processor_url_missing_or_invalid'],
    ['production_preview', () => { process.env.SUPABASE_URL = 'https://haifktjvyhbsazmiyqps.supabase.co'; }, 'functional_preview_supabase_url_not_authorized']
  ]) {
    const sandbox = installSandbox('webhook');
    try {
      const handler = loadHandler('api/webhook.js'); const res = makeRes(); mutate();
      await handler({ method: 'POST', headers: {}, body: webhookBody('F2D6-CONFIG-' + name, 'F2D6 configuración') }, res);
      assert.equal(res.code, 503, name);
      assert.equal(res.body?.code, expected, name);
      assert.equal(sandbox.state.calls.length, 0, name);
    } finally { sandbox.restore(); }
  }
});

test('F2D6 processor rejects a missing explicit processor URL before reading the queue', { concurrency: false }, async () => {
  const sandbox = installSandbox('processor');
  try {
    const handler = loadHandler('api/ai/process.js'); const res = makeRes();
    process.env.AI_PROCESSOR_URL = '';
    await handler({ method: 'POST', headers: { 'x-assistant-token': TOKEN }, body: { limit: 1, requested_by: 'F2D6-config' } }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body?.code, 'functional_preview_processor_url_missing_or_invalid');
    assert.equal(sandbox.state.calls.length, 0);
  } finally { sandbox.restore(); }
});

test('F2D6 assistant chat rejects missing Supabase configuration before history or model calls', { concurrency: false }, async () => {
  const sandbox = installSandbox('webhook');
  try {
    const handler = loadCommonJsHandler('api/assistant/chat.js'); const res = makeRes();
    process.env.SUPABASE_URL = '';
    await handler({ method: 'POST', headers: { 'x-assistant-token': TOKEN }, body: { text: 'F2D6 no debe salir' } }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body?.code, 'yarbi_config_supabase_url_missing');
    assert.equal(sandbox.state.calls.length, 0);
  } finally { sandbox.restore(); }
});

test('F2D2 real processor keeps URL-only synthetic message identity_pending without egress', { concurrency: false }, async () => {
  const sandbox = installSandbox('processor');
  try {
    const handler = loadHandler('api/ai/process.js'); const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-assistant-token': TOKEN }, body: { limit: 1, requested_by: 'F2D2' } }, res); await sandbox.drain();
    assert.equal(res.code, 200); assert.equal(res.body?.status, 'completed');
    assert.ok(sandbox.state.patches.some(patch => patch.status === 'identity_pending'));
    assert.equal(sandbox.state.external_attempts.length, 0);
    assert.ok([...sandbox.state.ledger.values()].some(row => row.result_payload?.stage === 'operation_closed'));
  } finally { sandbox.restore(); }
});
