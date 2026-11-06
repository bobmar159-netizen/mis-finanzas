'use strict';

const assert = require('node:assert/strict');
const { createAuthContinuityHandler } = require('../PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/auth-continuity');
const ENV = { VERCEL_ENV: 'preview', YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT: 'true', YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv', SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co', SUPABASE_SECRET_KEY: 's'.repeat(40), YARBI_TRACE_HMAC_KEY: 'h'.repeat(40), YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID: '123e4567-e89b-42d3-a456-426614174000', YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING: 'true', GEMINI_API_KEY: 'not-used-by-this-handler' };
const JWT = 'header.payload.signature';
function req(overrides = {}) { return { method: 'POST', url: '/api/diagnostics/auth-continuity', headers: { authorization: `Bearer ${JWT}` }, body: {}, ...overrides }; }
function reply() { const result = {}; return { result, status(value) { result.status = value; return this; }, json(value) { result.body = value; return result; } }; }
const tests = [];
async function test(name, fn) { try { await fn(); tests.push({ name, status: 'PASS' }); } catch (error) { tests.push({ name, status: 'FAIL', error: error.message }); } }
(async () => {
  await test('16 requests válidos conservan owner y nunca invocan Gemini', async () => {
    const saved = process.env; process.env = { ...ENV }; let calls = 0; const handler = createAuthContinuityHandler({ authenticate: async () => { calls += 1; return { ok: true, user: { id: ENV.YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID } }; } });
    for (let index = 0; index < 16; index += 1) { const res = reply(); await handler(req(), res); assert.equal(res.result.status, 200); assert.equal(res.result.body.category, 'authorized'); assert.equal(res.result.body.gemini_invoked, false); assert.equal(res.result.body.owner_matches, true); }
    process.env = saved; assert.equal(calls, 16);
  });
  await test('header ausente se rechaza antes de Supabase Auth', async () => {
    const saved = process.env; process.env = { ...ENV }; let called = false; const handler = createAuthContinuityHandler({ authenticate: async () => { called = true; } }); const res = reply(); await handler(req({ headers: {} }), res); process.env = saved;
    assert.equal(res.result.status, 401); assert.equal(res.result.body.category, 'header_missing'); assert.equal(called, false);
  });
  await test('header inválido se rechaza antes de Supabase Auth', async () => {
    const saved = process.env; process.env = { ...ENV }; let called = false; const handler = createAuthContinuityHandler({ authenticate: async () => { called = true; } }); const res = reply(); await handler(req({ headers: { authorization: 'Bearer malformed' } }), res); process.env = saved;
    assert.equal(res.result.status, 401); assert.equal(res.result.body.category, 'header_invalid'); assert.equal(called, false);
  });
  await test('Auth rechazado no se confunde con owner inválido', async () => {
    const saved = process.env; process.env = { ...ENV }; const handler = createAuthContinuityHandler({ authenticate: async () => ({ ok: false }) }); const res = reply(); await handler(req(), res); process.env = saved;
    assert.equal(res.result.status, 401); assert.equal(res.result.body.category, 'supabase_auth_rejected'); assert.equal(res.result.body.owner_matches, false);
  });
  await test('owner distinto queda separado como 403', async () => {
    const saved = process.env; process.env = { ...ENV }; const handler = createAuthContinuityHandler({ authenticate: async () => ({ ok: true, user: { id: '123e4567-e89b-42d3-a456-426614174001' } }) }); const res = reply(); await handler(req(), res); process.env = saved;
    assert.equal(res.result.status, 403); assert.equal(res.result.body.category, 'owner_mismatch'); assert.equal(res.result.body.supabase_auth_result, 'valid');
  });
  await test('production se bloquea antes de Auth', async () => {
    const saved = process.env; process.env = { ...ENV, VERCEL_ENV: 'production' }; let called = false; const handler = createAuthContinuityHandler({ authenticate: async () => { called = true; } }); const res = reply(); await handler(req(), res); process.env = saved;
    assert.equal(res.result.status, 503); assert.equal(called, false);
  });
  const failed = tests.filter(item => item.status === 'FAIL'); process.stdout.write(JSON.stringify({ phase: 'auth_continuity_handler_local', result: failed.length ? 'FAIL' : 'PASS', passed: tests.length - failed.length, total: tests.length, failures: failed, network_calls: 0, gemini_calls: 0, commercial_actions: 0 }) + '\n'); process.exitCode = failed.length ? 1 : 0;
})();
