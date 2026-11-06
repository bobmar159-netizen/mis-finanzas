'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const OWNER_A = '00000000-0000-4000-8000-0000000000a1';
const ENV = { VERCEL_ENV: 'preview', YARBI_PREVIEW_OWNER_REFERENCES_ONLY: 'true', YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv', SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co', SUPABASE_SECRET_KEY: 'isolated-service-key-only-for-local-tests-1234567890', YARBI_TRACE_HMAC_KEY: 'trace-hmac-only-for-local-tests-1234567890' };

function responseBox() { let statusCode = 0; let body; return { status(value) { statusCode = value; return this; }, json(value) { body = value; return this; }, get value() { return { statusCode, body }; } }; }
function setEnv() { const before = Object.fromEntries(Object.keys(ENV).map(key => [key, process.env[key]])); Object.assign(process.env, ENV); return () => Object.entries(before).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value); }
function rows(url) {
  if (url.includes('yarbi_owner_contact_scope')) return [{ contact_id: 101 }];
  if (url.includes('crm_contacts')) return [{ id: 101, display_name: 'F02 Endpoint', commercial_status: 'frio', latest_service: 'instalacion_nueva' }];
  if (url.includes('contact_identifiers')) return [{ contact_id: 101, normalized_value: '900000101', is_primary: true }];
  if (url.includes('whatsapp_messages')) return [{ id: 'F02-ENDPOINT-MSG', contact_id: 101, title: 'Entrada', text: 'Dato sintético', timestamp: '2026-11-05T15:00:00Z' }];
  return [];
}

test('F02 dossier endpoint authenticates, uses only isolated Supabase reads and never accepts client owner scope', async () => {
  const restore = setEnv(); const originalFetch = global.fetch; const calls = [];
  try {
    global.fetch = async (rawUrl, options = {}) => {
      const url = String(rawUrl); calls.push({ url, method: options.method || 'GET' });
      assert.equal(new URL(url).hostname, 'uevilhbstnmmdlgyshlv.supabase.co');
      if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: OWNER_A }), { status: 200 });
      if (url.includes('/rest/v1/yarbi_agent_actions')) return new Response(JSON.stringify([JSON.parse(options.body)[0]]), { status: 201 });
      return new Response(JSON.stringify(rows(url)), { status: 200 });
    };
    const handler = require('../api_handlers/assistant/crm-dossier'); const res = responseBox();
    await handler({ method: 'POST', url: '/api/assistant/crm-dossier', headers: { authorization: 'Bearer local-owner-token' }, body: { contact_id: 101 } }, res);
    assert.equal(res.value.statusCode, 200); assert.equal(res.value.body.ok, true); assert.equal(res.value.body.outcome, 'dossier_found'); assert.equal(res.value.body.execute, false);
    assert.equal(calls.every(call => new URL(call.url).hostname === 'uevilhbstnmmdlgyshlv.supabase.co'), true);
    const writes = calls.filter(call => call.method !== 'GET' && !call.url.includes('yarbi_agent_actions'));
    assert.deepEqual(writes, []);
    await handler({ method: 'POST', url: '/api/assistant/crm-dossier', headers: { authorization: 'Bearer local-owner-token' }, body: { contact_id: 101, owner_id: '00000000-0000-4000-8000-0000000000b2' } }, res);
    assert.equal(res.value.statusCode, 400); assert.equal(res.value.body.error, 'owner_scope_client_input_forbidden');
  } finally { global.fetch = originalFetch; restore(); }
});
