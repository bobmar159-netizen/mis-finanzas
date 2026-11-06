'use strict';

const assert = require('node:assert/strict');
const { operationIdFromReference } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-trace');
const { CASES } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures');
const { createGeminiV4PostCorrectionsValidationHandler } = require('../PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-post-corrections-validation');

const TRACE_SECRET = 'h'.repeat(40);
const OWNER_ID = '123e4567-e89b-42d3-a456-426614174000';
const ENV = {
  VERCEL_ENV: 'preview',
  YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT: 'true',
  YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
  SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co',
  SUPABASE_SECRET_KEY: 's'.repeat(40),
  YARBI_TRACE_HMAC_KEY: TRACE_SECRET,
  YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID: OWNER_ID,
  YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING: 'true',
  GEMINI_API_KEY: 'not-called'
};

function request() {
  return { method: 'POST', url: '/api/diagnostics/gemini-v4-post-corrections-validation', headers: { authorization: 'Bearer header.payload.signature' }, body: { ledger_preflight: true } };
}
function reply() {
  const result = {};
  return { result, status(value) { result.status = value; return this; }, json(value) { result.body = value; return result; } };
}
function operationId(fixtureId) {
  return operationIdFromReference('gemini_v4_post_corrections_validation', fixtureId, TRACE_SECRET);
}
function completedRows(fixtureId) {
  const target_id = operationId(fixtureId);
  return [
    { target_id, request_payload: { operation_type: 'gemini_v4_post_corrections_validation', stage: 'operation_started' }, result_payload: { stage: 'operation_started', outcome: 'started', counts: { request_count: 0 } } },
    { target_id, request_payload: { operation_type: 'gemini_v4_post_corrections_validation', stage: 'gemini_v4_post_corrections_completed' }, result_payload: { stage: 'gemini_v4_post_corrections_completed', outcome: 'completed', counts: { request_count: 1 } } },
    { target_id, request_payload: { operation_type: 'gemini_v4_post_corrections_validation', stage: 'operation_closed' }, result_payload: { stage: 'operation_closed', outcome: 'completed', counts: { request_count: 1 } } }
  ];
}
function mockFetch(rows, calls) {
  return async (url, options) => {
    calls.push({ url: String(url), method: options?.method || 'GET' });
    return { ok: true, json: async () => rows };
  };
}
async function handlerWith(rows, calls, probes) {
  return createGeminiV4PostCorrectionsValidationHandler({
    authenticate: async () => ({ ok: true, user: { id: OWNER_ID } }),
    runProbe: async () => { probes.count += 1; return { accepted: false }; },
    fetchImpl: mockFetch(rows, calls)
  });
}

const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.message }); }
}

(async () => {
  const saved = process.env;
  process.env = { ...ENV };
  try {
    await test('ledger confirma F3PC-01 a F3PC-03 consumidos una vez y F3PC-04 a F3PC-16 pendientes', async () => {
      const calls = []; const probes = { count: 0 };
      const handler = await handlerWith(['F3PC-01', 'F3PC-02', 'F3PC-03'].flatMap(completedRows), calls, probes);
      const res = reply(); await handler(request(), res);
      assert.equal(res.result.status, 200);
      assert.equal(res.result.body.route_mode, 'ledger_preflight');
      assert.equal(res.result.body.ledger.code, null);
      assert.equal(res.result.body.ledger.fixtures.find(item => item.fixture_id === 'F3PC-04').event_count, 0);
      assert.equal(res.result.body.ledger.fixtures.filter(item => /^F3PC-(0[5-9]|1[0-6])$/.test(item.fixture_id)).every(item => item.event_count === 0), true);
      assert.equal(calls.length, 1);
      assert.equal(probes.count, 0);
    });
    await test('ledger detiene el lote si un fixture pendiente tiene eventos previos', async () => {
      const calls = []; const probes = { count: 0 };
      const handler = await handlerWith(['F3PC-01', 'F3PC-02', 'F3PC-03', 'F3PC-05'].flatMap(completedRows), calls, probes);
      const res = reply(); await handler(request(), res);
      assert.equal(res.result.status, 409);
      assert.equal(res.result.body.ledger.code, 'ledger_preflight_state_mismatch');
      assert.equal(probes.count, 0);
    });
    await test('la lectura del ledger no ejecuta Gemini ni crea una traza', async () => {
      const calls = []; const probes = { count: 0 };
      const handler = await handlerWith(['F3PC-01', 'F3PC-02', 'F3PC-03'].flatMap(completedRows), calls, probes);
      const res = reply(); await handler(request(), res);
      assert.equal(res.result.body.gemini_invoked, false);
      assert.equal(res.result.body.trace_invoked, false);
      assert.equal(res.result.body.fixture_consumed, false);
      assert.equal(probes.count, 0);
    });
  } finally {
    process.env = saved;
  }
  const failed = results.filter(item => item.status === 'FAIL');
  process.stdout.write(JSON.stringify({ phase: 'gemini_v4_pending_ledger_preflight_local', result: failed.length ? 'FAIL' : 'PASS', passed: results.length - failed.length, total: results.length, failures: failed, network_calls: 0, gemini_calls: 0, commercial_actions: 0 }) + '\n');
  process.exitCode = failed.length ? 1 : 0;
})();
