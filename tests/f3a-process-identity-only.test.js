const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_PATH = path.join(ROOT, 'api', 'ai', 'process.js');
const HOST = 'uevilhbstnmmdlgyshlv.supabase.co';

function token() { return crypto.randomBytes(32).toString('hex'); }

function loadHandler(waited) {
  const marker = 'export default async function handler(req, res) {';
  const raw = fs.readFileSync(HANDLER_PATH, 'utf8');
  assert.ok(raw.includes(marker), 'the source handler export must remain recognizable');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@vercel/functions') return { waitUntil: promise => waited.push(Promise.resolve(promise)) };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const isolated = new Module(HANDLER_PATH, module);
    isolated.filename = HANDLER_PATH;
    isolated.paths = Module._nodeModulePaths(path.dirname(HANDLER_PATH));
    isolated._compile(raw.replace(marker, 'async function handler(req, res) {') + '\nmodule.exports = handler;\n', HANDLER_PATH);
    return isolated.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function responseCapture() {
  let resolve;
  const done = new Promise(r => { resolve = r; });
  const res = {
    statusCode: 0, payload: null,
    setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; resolve(); return this; }, end() { resolve(); return this; }
  };
  return { res, done };
}

test('F3A handler: valid phone resolves identity without Gemini, memory, agenda or external egress', async () => {
  const originalFetch = global.fetch;
  const oldEnv = { ...process.env };
  const waited = [];
  const requests = [];
  const traceStages = [];
  const assistantToken = token();
  try {
    Object.assign(process.env, {
      SUPABASE_URL: `https://${HOST}`,
      SUPABASE_SECRET_KEY: token(),
      ASSISTANT_API_TOKEN: assistantToken,
      YARBI_TRACE_HMAC_KEY: token(),
      YARBI_PREVIEW_SYNTHETIC_TOKEN: token(),
      VERCEL_ENV: 'preview',
      YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: 'true',
      YARBI_PREVIEW_IDENTITY_CRM_ONLY: 'true',
      YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
      YARBI_PREVIEW_DEPLOYMENT_HOST: 'f3a-local.vercel.app',
      AI_PROCESSOR_URL: 'https://f3a-local.vercel.app'
    });
    for (const name of ['GEMINI_API_KEY', 'GEMINI_KEY', 'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN', 'YCLOUD_API_KEY', 'YCLOUD_KEY', 'NOTION_TOKEN', 'FNZ_NOTION_TOKEN', 'GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY']) delete process.env[name];

    global.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      assert.equal(url.hostname, HOST, `unexpected egress: ${url.hostname}`);
      const method = String(init.method || 'GET').toUpperCase();
      requests.push(`${method} ${url.pathname}`);
      const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/rest/v1/rpc/claim_yarbi_message_analysis') return json([{ analysis_id: 801, message_id: 'F3A-handler-valid', attempt_count: 0 }]);
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'GET') return json([{ id: 'F3A-handler-valid', phone: '+51 955411248', title: '', text: 'Mensaje sintético', maps_url: null, timestamp: 1, app_name: 'audit', metadata: { synthetic: true } }]);
      if (url.pathname === '/rest/v1/ai_processing_runs' && method === 'POST') return json([{ id: 901 }]);
      if (url.pathname === '/rest/v1/rpc/resolve_or_create_contact_by_phone') return json([{ contact_id: 701, outcome: 'created_new' }]);
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'PATCH') return json([]);
      if (url.pathname === '/rest/v1/ai_message_analysis' && method === 'PATCH') return json([]);
      if (url.pathname === '/rest/v1/ai_processing_runs' && method === 'PATCH') return json([]);
      if (url.pathname === '/rest/v1/yarbi_agent_actions' && method === 'POST') {
        const body = JSON.parse(init.body);
        traceStages.push(body[0].request_payload?.stage);
        return json([{ action_id: body[0].action_id }]);
      }
      throw new Error(`unexpected isolated route: ${method} ${url.pathname}`);
    };

    const handler = loadHandler(waited);
    const capture = responseCapture();
    await handler({ method: 'POST', headers: { 'x-assistant-token': assistantToken }, body: { limit: 1, priority_message_id: 'F3A-handler-valid', continuation_depth: 2 } }, capture.res);
    await capture.done;
    await Promise.allSettled(waited);

    assert.equal(capture.res.statusCode, 200);
    assert.equal(capture.res.payload.status, 'completed');
    assert.equal(capture.res.payload.identities_created, 1);
    assert.equal(capture.res.payload.messages_processed, 1);
    assert.equal(capture.res.payload.agenda_events_created, 0);
    assert.equal(capture.res.payload.intelligent_alerts_created, 0);
    assert.ok(requests.includes('POST /rest/v1/rpc/resolve_or_create_contact_by_phone'));
    assert.ok(traceStages.includes('identity_created'), `missing identity_created; traces=${traceStages.join(',')}; requests=${requests.join(',')}`);
    assert.ok(traceStages.includes('identity_linked'), `missing identity_linked; traces=${traceStages.join(',')}; requests=${requests.join(',')}`);
    assert.ok(traceStages.includes('operation_closed'), `missing operation_closed; traces=${traceStages.join(',')}; requests=${requests.join(',')}`);
    assert.equal(requests.some(item => /gemini|crm_contacts|contact_identifiers|agenda|memory|alert/i.test(item)), false);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});

test('F3A handler: invalid phone remains identity_pending without attempting CRM resolution or egress', async () => {
  const originalFetch = global.fetch;
  const oldEnv = { ...process.env };
  const waited = [];
  const requests = [];
  const assistantToken = token();
  try {
    Object.assign(process.env, {
      SUPABASE_URL: `https://${HOST}`,
      SUPABASE_SECRET_KEY: token(),
      ASSISTANT_API_TOKEN: assistantToken,
      YARBI_TRACE_HMAC_KEY: token(),
      YARBI_PREVIEW_SYNTHETIC_TOKEN: token(),
      VERCEL_ENV: 'preview',
      YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: 'true',
      YARBI_PREVIEW_IDENTITY_CRM_ONLY: 'true',
      YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
      YARBI_PREVIEW_DEPLOYMENT_HOST: 'f3a-local.vercel.app',
      AI_PROCESSOR_URL: 'https://f3a-local.vercel.app'
    });
    for (const name of ['GEMINI_API_KEY', 'GEMINI_KEY', 'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN', 'YCLOUD_API_KEY', 'YCLOUD_KEY', 'NOTION_TOKEN', 'FNZ_NOTION_TOKEN', 'GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY']) delete process.env[name];

    global.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      assert.equal(url.hostname, HOST, `unexpected egress: ${url.hostname}`);
      const method = String(init.method || 'GET').toUpperCase();
      requests.push(`${method} ${url.pathname}`);
      const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/rest/v1/rpc/claim_yarbi_message_analysis') return json([{ analysis_id: 802, message_id: 'F3A-invalid-phone', attempt_count: 0 }]);
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'GET') return json([{ id: 'F3A-invalid-phone', phone: null, title: '', text: 'Sin teléfono', maps_url: null, timestamp: 1, app_name: 'audit', metadata: { synthetic: true } }]);
      if (url.pathname === '/rest/v1/ai_processing_runs' && method === 'POST') return json([{ id: 902 }]);
      if (url.pathname === '/rest/v1/ai_message_analysis' && method === 'PATCH') return json([]);
      if (url.pathname === '/rest/v1/ai_processing_runs' && method === 'PATCH') return json([]);
      if (url.pathname === '/rest/v1/yarbi_agent_actions' && method === 'POST') {
        const body = JSON.parse(init.body);
        return json([{ action_id: body[0].action_id }]);
      }
      throw new Error(`unexpected isolated route: ${method} ${url.pathname}`);
    };

    const handler = loadHandler(waited);
    const capture = responseCapture();
    await handler({ method: 'POST', headers: { 'x-assistant-token': assistantToken }, body: { limit: 1, priority_message_id: 'F3A-invalid-phone', continuation_depth: 2 } }, capture.res);
    await capture.done;
    await Promise.allSettled(waited);

    assert.equal(capture.res.statusCode, 200);
    assert.equal(capture.res.payload.status, 'completed');
    assert.equal(capture.res.payload.messages_processed, 0);
    assert.equal(requests.includes('POST /rest/v1/rpc/resolve_or_create_contact_by_phone'), false);
    assert.equal(requests.some(item => /gemini|crm_contacts|contact_identifiers|agenda|memory|alert/i.test(item)), false);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});
