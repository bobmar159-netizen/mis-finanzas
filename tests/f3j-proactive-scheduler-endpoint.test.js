'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeEnv, intervalPolicy } = require('../api_handlers/assistant/proactive-loop');
const { compactInboxPayload } = require('../lib/yarbi-proactive-supabase-store');
const { decidePreviewRouteRequest } = require('../lib/preview-route-policy');

const TOKEN = 'f3j-test-token-only-not-a-real-secret-1234567890';
const BASE_ENV = Object.freeze({
  VERCEL_ENV: 'preview',
  YARBI_PREVIEW_PROACTIVE_LOOP_ONLY: 'true',
  YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
  SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co',
  SUPABASE_SECRET_KEY: TOKEN,
  CRON_SECRET: TOKEN
});

test('F3J scheduler endpoint accepts only the isolated preview configuration and a bounded interval', () => {
  const config = safeEnv(BASE_ENV);
  assert.equal(config.url, 'https://uevilhbstnmmdlgyshlv.supabase.co');
  assert.equal(safeEnv({ ...BASE_ENV, VERCEL_ENV: 'production' }), null);
  assert.equal(safeEnv({ ...BASE_ENV, SUPABASE_URL: 'https://haifktjvyhbsazmiyqps.supabase.co' }), null);
  assert.equal(safeEnv({ ...BASE_ENV, YARBI_F3J_REMOTE_TEST_MODE: 'true', YARBI_F3J_REMOTE_FIXTURE_PREFIX: 'F3J-REMOTE-' }).fixtureCandidatePrefix, 'F3J-REMOTE-');
  assert.equal(safeEnv({ ...BASE_ENV, YARBI_F3J_REMOTE_TEST_MODE: 'true' }), null);
  assert.equal(safeEnv({ ...BASE_ENV, YARBI_F3J_REMOTE_FIXTURE_PREFIX: 'F3J-REMOTE-' }), null);
  assert.deepEqual(intervalPolicy({}), { interval_ms: 15 * 60 * 1000 });
  assert.deepEqual(intervalPolicy({ YARBI_PROACTIVE_INTERVAL_MINUTES: '30' }), { interval_ms: 30 * 60 * 1000 });
  assert.equal(intervalPolicy({ YARBI_PROACTIVE_INTERVAL_MINUTES: '0' }), null);
  assert.equal(intervalPolicy({ YARBI_PROACTIVE_INTERVAL_MINUTES: '1441' }), null);
});

test('F3J inbox payload is compact and omits phone, name and customer text', () => {
  const payload = compactInboxPayload({
    headline: { type: 'owner_attention', count: 1 },
    business_snapshot: { daily_goal: 700, confirmed_today: null, remaining_to_goal: null, currency: 'PEN' },
    items: [{ type: 'request_location', contact_id: 501, action: 'request_location', priority: 'high', reason: 'missing_location', requires_authorization: true, phone: '999999999', name: 'F3J Cliente', message_text: 'texto privado' }]
  });
  const encoded = JSON.stringify(payload);
  assert.equal(/999999999|F3J Cliente|texto privado/.test(encoded), false);
  assert.deepEqual(payload.items[0], { type: 'request_location', contact_id: 501, action: 'request_location', priority: 'high', reason: 'missing_location', requires_authorization: true });
});

test('F3J preview scheduler firewall permits only its isolated GET route and blocks commercial routes', () => {
  const request = (pathname, method, authorization = `Bearer ${TOKEN}`) => ({ url: `https://f3j-local.vercel.app${pathname}`, method, headers: { authorization } });
  const allowed = decidePreviewRouteRequest(request('/api/assistant/proactive-loop', 'GET'), BASE_ENV);
  assert.deepEqual([allowed.allow, allowed.code], [true, 'proactive_preview_allowed']);
  assert.equal(decidePreviewRouteRequest(request('/api/webhook', 'POST'), BASE_ENV).allow, false);
  assert.equal(decidePreviewRouteRequest(request('/api/assistant/send-whatsapp', 'GET'), BASE_ENV).allow, false);
  assert.equal(decidePreviewRouteRequest(request('/api/assistant/proactive-loop', 'POST'), BASE_ENV).allow, false);
  assert.equal(decidePreviewRouteRequest(request('/api/assistant/proactive-loop', 'GET', 'Bearer wrong'), BASE_ENV).allow, false);
  assert.equal(decidePreviewRouteRequest(request('/api/assistant/proactive-loop', 'GET'), { ...BASE_ENV, YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: 'true' }).allow, false);
  assert.equal(decidePreviewRouteRequest(request('/api/assistant/proactive-loop', 'GET'), { ...BASE_ENV, YARBI_F3J_REMOTE_TEST_MODE: 'true' }).allow, false);
});
