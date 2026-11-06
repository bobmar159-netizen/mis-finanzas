'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { adaptCommercialEvidence, createVerifiedOperatorEvidenceEvent } = require('../lib/yarbi-commercial-evidence');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_PATH = path.join(ROOT, 'api', 'ai', 'process.js');
const HOST = 'uevilhbstnmmdlgyshlv.supabase.co';
const token = () => crypto.randomBytes(32).toString('hex');

function loadHandler(waited) {
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
    isolated._compile(raw.replace('export default async function handler(req, res) {', 'async function handler(req, res) {') + '\nmodule.exports = handler;\n', HANDLER_PATH);
    return isolated.exports;
  } finally { Module._load = originalLoad; }
}

test('F3E handler persists only structured memory facts without Gemini, agenda, alerts or external egress', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const waited = [];
  const routes = [];
  const memoryWrites = [];
  const assistantToken = token();
  try {
    Object.assign(process.env, {
      SUPABASE_URL: `https://${HOST}`, SUPABASE_SECRET_KEY: token(), ASSISTANT_API_TOKEN: assistantToken,
      YARBI_TRACE_HMAC_KEY: token(), YARBI_PREVIEW_SYNTHETIC_TOKEN: token(),
      VERCEL_ENV: 'preview', YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: 'true',
      YARBI_PREVIEW_IDENTITY_CRM_ONLY: 'true', YARBI_PREVIEW_COMMERCIAL_CONTEXT_ONLY: 'true',
      YARBI_PREVIEW_OPERATIONAL_MEMORY_ONLY: 'true', YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
      YARBI_PREVIEW_DEPLOYMENT_HOST: 'f3e-local.vercel.app', AI_PROCESSOR_URL: 'https://f3e-local.vercel.app'
    });
    for (const name of ['GEMINI_API_KEY', 'GEMINI_KEY', 'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN', 'YCLOUD_API_KEY', 'YCLOUD_KEY', 'NOTION_TOKEN', 'FNZ_NOTION_TOKEN', 'GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY']) delete process.env[name];
    global.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      assert.equal(url.hostname, HOST, `external egress blocked: ${url.hostname}`);
      const method = String(init.method || 'GET').toUpperCase();
      routes.push(`${method} ${url.pathname}`);
      const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/rest/v1/rpc/claim_yarbi_message_analysis') return json([{ analysis_id: 930, message_id: 'F3E-handler-message', attempt_count: 0 }]);
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'GET') return json([{
        id: 'F3E-handler-message', phone: '+51 955600010', text: 'F3E structured fixture', title: '', maps_url: null, timestamp: 1761801000,
        metadata: { synthetic: true, commercial_context: adaptCommercialEvidence(createVerifiedOperatorEvidenceEvent({
          operatorVerified: true, eventId: 'F3E-handler-event', messageId: 'F3E-handler-message', occurredAt: 1761801000,
          service: 'reparacion', visitRequested: true
        })).evidence }
      }]);
      if (url.pathname === '/rest/v1/ai_processing_runs' && method === 'POST') return json([{ id: 930 }]);
      if (url.pathname === '/rest/v1/rpc/resolve_or_create_contact_by_phone') return json([{ contact_id: 730, outcome: 'resolved_existing' }]);
      if (url.pathname === '/rest/v1/rpc/update_yarbi_commercial_context') return json([{ outcome: 'status_changed', previous_status: 'frio', current_status: 'caliente', previous_service: null, current_service: 'reparacion', last_contact_at: '2025-10-30T05:10:00.000Z' }]);
      if (url.pathname === '/rest/v1/rpc/upsert_yarbi_contact_operational_memory') {
        const body = JSON.parse(init.body); memoryWrites.push(body);
        return json([{ outcome: 'created', memory_id: memoryWrites.length, previous_memory_id: null, state: 'active' }]);
      }
      if ((url.pathname === '/rest/v1/whatsapp_messages' || url.pathname === '/rest/v1/ai_message_analysis' || url.pathname === '/rest/v1/ai_processing_runs') && method === 'PATCH') return json([]);
      if (url.pathname === '/rest/v1/yarbi_agent_actions' && method === 'POST') return json([{ action_id: JSON.parse(init.body)[0].action_id }]);
      throw new Error(`unexpected isolated route: ${method} ${url.pathname}`);
    };
    const handler = loadHandler(waited);
    const res = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
    await handler({ method: 'POST', headers: { 'x-assistant-token': assistantToken }, body: { limit: 1, priority_message_id: 'F3E-handler-message', continuation_depth: 2 } }, res);
    for (let previous = -1; previous !== waited.length; previous = waited.length) {
      await Promise.allSettled(waited);
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(res.code, 200);
    assert.equal(res.body.operational_memory_updated, 3, JSON.stringify({ body: res.body, routes }));
    assert.deepEqual(memoryWrites.map(item => item.p_memory_type), ['service', 'visit', 'pending_step']);
    assert.equal(memoryWrites.every(item => item.p_source_event_id === 'F3E-handler-event'), true);
    assert.equal(routes.some(route => /gemini|agenda|alert|memory\?|notion|calendar|maps/i.test(route)), false);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
