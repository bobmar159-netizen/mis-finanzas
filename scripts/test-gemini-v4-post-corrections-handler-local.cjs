'use strict';

const assert = require('node:assert/strict');
const { createGeminiV4PostCorrectionsValidationHandler } = require('../PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-post-corrections-validation');

const isolatedEnv = {
  VERCEL_ENV: 'preview',
  YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT: 'true',
  YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
  SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co',
  SUPABASE_SECRET_KEY: 's'.repeat(40),
  YARBI_TRACE_HMAC_KEY: 'h'.repeat(40),
  YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID: '123e4567-e89b-42d3-a456-426614174000',
  YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING: 'true',
  GEMINI_API_KEY: 'diagnostic-test-key'
};

function request(body, overrides = {}) {
  return { method: 'POST', url: '/api/diagnostics/gemini-v4-post-corrections-validation', headers: { authorization: 'Bearer synthetic-jwt' }, body, ...overrides };
}
function reply() {
  const result = { status: null, body: null };
  return { result, status(value) { result.status = value; return this; }, json(value) { result.body = value; return result; } };
}
function mockProbe() {
  return async () => ({ accepted: true, provider_http_status: 200, provider_ms: 9, model: 'gemini-3.5-flash-lite', schema_sha256: 'a'.repeat(64), schema_bytes: 1995, raw: { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'correction', target_type: 'contact', mentions: [{ kind: 'proper_name', value: 'ENTIDAD_B', polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance' }, { kind: 'proper_name', value: 'ENTIDAD_A', polarity: 'negated', certainty: 'confirmed', claimed_source: 'utterance' }], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' }, confidence: 0.9, ambiguity: false, missing_information: [] } });
}
function auth() { return async () => ({ ok: true, user: { id: isolatedEnv.YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID } }); }
function traceStart(result = { ok: true }) { return async () => result; }
function traceEnd(result = { ok: true }) { return async () => result; }
const tests = [];
function test(name, fn) { tests.push(Promise.resolve().then(fn).then(() => ({ name, status: 'PASS' })).catch(error => ({ name, status: 'FAIL', error: error.message }))); }

test('rechaza production antes de autenticar o invocar Gemini', async () => {
  const saved = process.env; process.env = { ...isolatedEnv, VERCEL_ENV: 'production' };
  let called = false; const handler = createGeminiV4PostCorrectionsValidationHandler({ authenticate: async () => { called = true; }, runProbe: async () => { called = true; } }); const res = reply();
  await handler(request({ fixture_id: 'F3PC-01' }), res); process.env = saved;
  assert.equal(res.result.status, 503); assert.equal(called, false);
});
test('rechaza payload distinto de un fixture permitido sin ejecutar proveedor', async () => {
  const saved = process.env; process.env = { ...isolatedEnv }; let called = false;
  const handler = createGeminiV4PostCorrectionsValidationHandler({ runProbe: async () => { called = true; } }); const res = reply();
  await handler(request({ fixture_id: 'F3PC-01', utterance: 'externo' }), res); process.env = saved;
  assert.equal(res.result.status, 400); assert.equal(called, false);
});
test('requiere owner autenticado del entorno aislado', async () => {
  const saved = process.env; process.env = { ...isolatedEnv }; let called = false;
  const handler = createGeminiV4PostCorrectionsValidationHandler({ authenticate: async () => ({ ok: true, user: { id: '123e4567-e89b-42d3-a456-426614174001' } }), runProbe: async () => { called = true; } }); const res = reply();
  await handler(request({ fixture_id: 'F3PC-01' }), res); process.env = saved;
  assert.equal(res.result.status, 403); assert.equal(called, false);
});
test('rechaza la re-ejecución antes de llegar al proveedor', async () => {
  const saved = process.env; process.env = { ...isolatedEnv }; let called = false;
  const handler = createGeminiV4PostCorrectionsValidationHandler({ authenticate: auth(), startTrace: traceStart({ ok: true, duplicate: true }), runProbe: async () => { called = true; } }); const res = reply();
  await handler(request({ fixture_id: 'F3PC-01' }), res); process.env = saved;
  assert.equal(res.result.status, 409); assert.equal(called, false);
});
test('propaga contexto temporal permitido y publica solamente telemetría sanitizada', async () => {
  const saved = process.env; process.env = { ...isolatedEnv }; let captured = null;
  const valid = { accepted: true, provider_http_status: 200, provider_ms: 8, model: 'gemini-3.5-flash-lite', schema_sha256: 'b'.repeat(64), schema_bytes: 1995, raw: { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'correction', target_type: 'contact', mentions: [{ kind: 'proper_name', value: 'ENTIDAD_B', polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance' }, { kind: 'proper_name', value: 'ENTIDAD_A', polarity: 'negated', certainty: 'confirmed', claimed_source: 'utterance' }, { kind: 'service_reference', value: 'SERVICIO_A', polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance' }, { kind: 'temporal_reference', value: 'ayer', polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance', attributes: { days: 1 } }], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' }, confidence: 0.9, ambiguity: false, missing_information: [] } };
  const handler = createGeminiV4PostCorrectionsValidationHandler({ authenticate: auth(), startTrace: traceStart(), terminalTrace: traceEnd(), runProbe: async value => { captured = value; return valid; } }); const res = reply();
  await handler(request({ fixture_id: 'F3PC-01' }), res); process.env = saved;
  assert.equal(captured.context.reference_time, '2026-11-04T12:00:00-05:00'); assert.equal(res.result.status, 200); assert.equal(res.result.body.execute, false); assert.equal(res.result.body.commercial_actions_executed, false); assert.equal(JSON.stringify(res.result.body).includes('synthetic-jwt'), false); assert.equal(JSON.stringify(res.result.body).includes('diagnostic-test-key'), false);
});

Promise.all(tests).then(results => { const failed = results.filter(item => item.status === 'FAIL'); process.stdout.write(JSON.stringify({ phase: 'gemini_v4_post_corrections_handler_local', result: failed.length ? 'FAIL' : 'PASS', passed: results.length - failed.length, total: results.length, failures: failed, network_calls: 0, commercial_actions: 0 }) + '\n'); process.exitCode = failed.length ? 1 : 0; });
