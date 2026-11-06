'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decidePreviewRouteRequest } = require('../lib/preview-route-policy');
const { configuration } = require('../lib/preview-owner-action-policy');

const TOKEN = 'f3k-owner-token-isolated-not-a-real-secret-123456789';
const KEY = 'f3k-service-key-isolated-not-a-real-secret-123456789';
const ENV = Object.freeze({
  VERCEL_ENV: 'preview',
  YARBI_PREVIEW_OWNER_ACTION_ONLY: 'true',
  YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
  SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co',
  SUPABASE_SECRET_KEY: KEY,
  YARBI_OWNER_ACTION_TOKEN: TOKEN
});

function request(pathname, method = 'POST', token = TOKEN) {
  return { url: `https://isolated-preview.example${pathname}`, method, headers: { authorization: `Bearer ${token}` } };
}

test('F3K preview configuration is isolated and fails closed around external integrations', () => {
  const config = configuration(ENV);
  assert.equal(config.valid, true);
  assert.equal(config.supabaseUrl, 'https://uevilhbstnmmdlgyshlv.supabase.co');
  assert.equal(configuration({ ...ENV, YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'haifktjvyhbsazmiyqps' }).valid, false);
  assert.equal(configuration({ ...ENV, SUPABASE_URL: 'https://haifktjvyhbsazmiyqps.supabase.co' }).valid, false);
  assert.equal(configuration({ ...ENV, GEMINI_API_KEY: 'not-empty' }).valid, false);
  assert.equal(configuration({ ...ENV, YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: 'true' }).valid, false);
});

test('F3K preview firewall permits only authenticated owner decisions', () => {
  const allowed = decidePreviewRouteRequest(request('/api/assistant/owner-action'), ENV);
  assert.deepEqual([allowed.allow, allowed.status, allowed.code], [true, 200, 'owner_action_preview_allowed']);
  assert.equal(decidePreviewRouteRequest(request('/api/webhook'), ENV).allow, false);
  assert.equal(decidePreviewRouteRequest(request('/api/assistant/proactive-loop', 'GET'), ENV).allow, false);
  assert.equal(decidePreviewRouteRequest(request('/api/assistant/owner-action', 'GET'), ENV).allow, false);
  assert.equal(decidePreviewRouteRequest(request('/api/assistant/owner-action', 'POST', 'wrong'), ENV).allow, false);
});

test('F3K real endpoint calls only the isolated atomic RPC and exposes no service key', async () => {
  const before = {};
  for (const key of Object.keys(ENV)) { before[key] = process.env[key]; process.env[key] = ENV[key]; }
  const originalFetch = global.fetch;
  const calls = [];
  try {
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), method: options?.method, body: options?.body, headers: options?.headers });
      return new Response(JSON.stringify([{ outcome: 'authorized', decision_id: 12, owner_status: 'authorized', execution_state: 'authorized_pending_execution' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const handler = require('../api/assistant/owner-action');
    let payload = null; let statusCode = null;
    const res = { status(code) { statusCode = code; return this; }, json(value) { payload = value; return this; } };
    await handler({ method: 'POST', url: '/api/assistant/owner-action', headers: { authorization: `Bearer ${TOKEN}` }, body: { inbox_id: 9, item_index: 0, decision: 'authorize' } }, res);
    assert.equal(statusCode, 200);
    assert.deepEqual(payload, { ok: true, outcome: 'authorized', decision_id: 12, owner_status: 'authorized', execution_state: 'authorized_pending_execution' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://uevilhbstnmmdlgyshlv.supabase.co/rest/v1/rpc/apply_yarbi_owner_action');
    assert.equal(calls[0].method, 'POST');
    assert.equal(JSON.parse(calls[0].body).p_decision, 'authorize');
    assert.equal(JSON.stringify(payload).includes(KEY), false);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(ENV)) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  }
});
