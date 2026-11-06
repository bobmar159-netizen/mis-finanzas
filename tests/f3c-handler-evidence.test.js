'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { adaptCommercialEvidence, createVerifiedWebhookEvidenceEvent } = require('../lib/yarbi-commercial-evidence');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_PATH = path.join(ROOT, 'api', 'ai', 'process.js');
const HOST = 'uevilhbstnmmdlgyshlv.supabase.co';
const token = () => crypto.randomBytes(32).toString('hex');

function loadHandler(waited) {
  const marker = 'export default async function handler(req, res) {';
  const raw = fs.readFileSync(HANDLER_PATH, 'utf8');
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
  } finally { Module._load = originalLoad; }
}

test('F3C handler: accepted structured visit reaches 3B, never Gemini nor external egress', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const waited = [];
  const hosts = [];
  const stages = [];
  const commercialSources = [];
  const assistantToken = token();
  const evidence = adaptCommercialEvidence(createVerifiedWebhookEvidenceEvent({
    providerVerified: true,
    eventId: 'F3C-handler-event-001',
    messageId: 'F3C-handler-message-001',
    occurredAt: '2026-10-30T15:00:00.000Z',
    interactive: { type: 'list_reply', selection_id: 'yarbi.commercial.v1.visit.requested' }
  })).evidence;
  try {
    Object.assign(process.env, {
      SUPABASE_URL: `https://${HOST}`,
      SUPABASE_SECRET_KEY: token(), ASSISTANT_API_TOKEN: assistantToken,
      YARBI_TRACE_HMAC_KEY: token(), YARBI_PREVIEW_SYNTHETIC_TOKEN: token(),
      VERCEL_ENV: 'preview', YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: 'true',
      YARBI_PREVIEW_IDENTITY_CRM_ONLY: 'true', YARBI_PREVIEW_COMMERCIAL_CONTEXT_ONLY: 'true',
      YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
      YARBI_PREVIEW_DEPLOYMENT_HOST: 'f3c-local.vercel.app', AI_PROCESSOR_URL: 'https://f3c-local.vercel.app'
    });
    for (const name of ['GEMINI_API_KEY', 'GEMINI_KEY', 'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN', 'YCLOUD_API_KEY', 'YCLOUD_KEY', 'NOTION_TOKEN', 'FNZ_NOTION_TOKEN', 'GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY']) delete process.env[name];
    global.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      hosts.push(url.hostname);
      assert.equal(url.hostname, HOST, `external egress blocked: ${url.hostname}`);
      const method = String(init.method || 'GET').toUpperCase();
      const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/rest/v1/rpc/claim_yarbi_message_analysis') return json([
        { analysis_id: 1303, message_id: 'F3C-handler-message-001', attempt_count: 0 },
        { analysis_id: 1304, message_id: 'F3C-handler-message-untrusted', attempt_count: 0 }
      ]);
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'GET') return json([{
        id: 'F3C-handler-message-001', phone: '+51 955400013', text: 'texto sin clasificar', title: '', maps_url: null,
        timestamp: 1793372400000, created_at: '2026-10-30T15:00:00.000Z', app_name: 'audit', metadata: { synthetic: true, commercial_context: evidence }
      }, {
        id: 'F3C-handler-message-untrusted', phone: '+51 955400013', text: 'quiero instalación', title: '', maps_url: null,
        timestamp: 1793372400000, created_at: '2026-10-30T15:00:00.000Z', app_name: 'audit',
        metadata: { synthetic: true, commercial_context: { schema: 'yarbi.commercial.v1', origin: 'interactive_service_selection', service: 'instalacion_nueva', visit_requested: false } }
      }]);
      if (url.pathname === '/rest/v1/ai_processing_runs' && method === 'POST') return json([{ id: 1303 }]);
      if (url.pathname === '/rest/v1/rpc/resolve_or_create_contact_by_phone') return json([{ contact_id: 1303, outcome: 'resolved_existing' }]);
      if (url.pathname === '/rest/v1/rpc/update_yarbi_commercial_context') {
        const body = JSON.parse(init.body);
        commercialSources.push(body.p_source);
        if (body.p_source === 'interactive_service_selection') {
          assert.equal(body.p_visit_requested, true);
          assert.equal(body.p_service, null);
          return json([{ outcome: 'status_changed', previous_status: 'tibio', current_status: 'caliente', previous_service: null, current_service: null, last_contact_at: body.p_occurred_at }]);
        }
        assert.equal(body.p_source, 'none');
        assert.equal(body.p_service, null);
        return json([{ outcome: 'unchanged', previous_status: 'caliente', current_status: 'caliente', previous_service: null, current_service: null, last_contact_at: body.p_occurred_at }]);
      }
      if ((url.pathname === '/rest/v1/whatsapp_messages' || url.pathname === '/rest/v1/ai_message_analysis' || url.pathname === '/rest/v1/ai_processing_runs') && method === 'PATCH') return json([]);
      if (url.pathname === '/rest/v1/yarbi_agent_actions' && method === 'POST') {
        const body = JSON.parse(init.body);
        stages.push(body[0].request_payload?.stage);
        return json([{ action_id: body[0].action_id }]);
      }
      throw new Error(`unexpected isolated route: ${method} ${url.pathname}`);
    };
    const handler = loadHandler(waited);
    const res = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
    await handler({ method: 'POST', headers: { 'x-assistant-token': assistantToken }, body: { limit: 1, priority_message_id: 'F3C-handler-message-001', continuation_depth: 2 } }, res);
    // recordTerminalTrace puede registrar waitUntil anidados; drenamos la
    // cola hasta que deje de crecer antes de restaurar fetch.
    for (let previous = -1; previous !== waited.length; previous = waited.length) {
      await Promise.allSettled(waited);
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(res.code, 200);
    assert.equal(res.body.commercial_status_changed, 1);
    assert.deepEqual(commercialSources.sort(), ['interactive_service_selection', 'none']);
    assert.ok(stages.includes('commercial_evidence_accepted'));
    assert.ok(stages.includes('commercial_evidence_rejected'));
    assert.ok(stages.includes('commercial_status_changed'));
    assert.ok(stages.includes('operation_closed'));
    assert.deepEqual([...new Set(hosts)], [HOST]);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
