'use strict';

const assert = require('node:assert/strict');
const { createGeminiV4TemporalValidationHandler } = require('../PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-temporal-validation');

const env = {
  VERCEL_ENV: 'preview', YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT: 'true',
  YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv', SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co',
  SUPABASE_SECRET_KEY: 's'.repeat(40), YARBI_TRACE_HMAC_KEY: 'h'.repeat(40),
  YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID: '123e4567-e89b-42d3-a456-426614174000',
  YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING: 'true', GEMINI_API_KEY: 'diagnostic-test-key'
};
function request(body, overrides = {}) { return { method: 'POST', url: '/api/diagnostics/gemini-v4-temporal-validation', headers: { authorization: 'Bearer synthetic.jwt.value' }, body, ...overrides }; }
function reply() { const result = { status: null, body: null }; return { result, status(value) { result.status = value; return this; }, json(value) { result.body = value; return result; } }; }
function auth() { return async () => ({ ok: true, user: { id: env.YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID } }); }
function base(mentions, control = { correction: 'none', continuation: 'none', cancel_scope: 'none' }, ambiguity = false, missing_information = []) { return { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact', mentions, control, confidence: 0.9, ambiguity, missing_information }; }
function mention(kind, value, polarity = 'affirmed', attributes) { return { kind, value, polarity, certainty: 'confirmed', claimed_source: 'utterance', ...(attributes ? { attributes } : {}) }; }
function probe(raw) { return async () => ({ accepted: true, provider_http_status: 200, provider_ms: 7, model: 'gemini-3.5-flash-lite', schema_sha256: 'a'.repeat(64), schema_bytes: 1995, raw }); }
const tests = [];
function test(name, fn) { tests.push(Promise.resolve().then(fn).then(() => ({ name, status: 'PASS' })).catch(error => ({ name, status: 'FAIL', error: error.message }))); }

test('rechaza producción sin autenticar ni invocar Gemini', async () => {
  const saved = process.env; process.env = { ...env, VERCEL_ENV: 'production' }; let called = false;
  const handler = createGeminiV4TemporalValidationHandler({ authenticate: async () => { called = true; }, runProbe: async () => { called = true; } }); const res = reply();
  await handler(request({ fixture_id: 'F3TV-01' }), res); process.env = saved;
  assert.equal(res.result.status, 503); assert.equal(called, false);
});
test('auth_only valida owner sin Gemini ni fixture', async () => {
  const saved = process.env; process.env = { ...env }; let called = false;
  const handler = createGeminiV4TemporalValidationHandler({ authenticate: auth(), runProbe: async () => { called = true; } }); const res = reply();
  await handler(request({ auth_only: true }), res); process.env = saved;
  assert.equal(res.result.status, 200); assert.equal(res.result.body.gemini_invoked, false); assert.equal(called, false);
});
test('no acepta texto o estado enviados por HTTP', async () => {
  const saved = process.env; process.env = { ...env }; let called = false;
  const handler = createGeminiV4TemporalValidationHandler({ runProbe: async () => { called = true; } }); const res = reply();
  await handler(request({ fixture_id: 'F3TV-01', utterance: 'externo' }), res); process.env = saved;
  assert.equal(res.result.status, 400); assert.equal(called, false);
});
test('caso claro conserva siete etapas sanitizadas', async () => {
  const saved = process.env; process.env = { ...env }; let context = null;
  const raw = base([mention('proper_name', 'ENTIDAD_TEST_A'), mention('temporal_reference', 'ayer', 'affirmed', { days: 1, day_part: 'afternoon' })]);
  const handler = createGeminiV4TemporalValidationHandler({ authenticate: auth(), startTrace: async () => ({ ok: true }), terminalTrace: async () => ({ ok: true }), runProbe: async value => { context = value.context; return (await probe(raw)()); } }); const res = reply();
  await handler(request({ fixture_id: 'F3TV-01' }), res); process.env = saved;
  assert.equal(res.result.status, 200); assert.equal(context.reference_time, '2026-11-05T12:00:00-05:00'); assert.equal(res.result.body.temporal_diagnostic.stages.length, 7); assert.equal(JSON.stringify(res.result.body).includes('ENTIDAD_TEST_A'), false);
});
test('corrección temporal conserva la seguridad aunque el hardener abstenga por franja compartida', async () => {
  const saved = process.env; process.env = { ...env };
  const raw = base([mention('proper_name', 'ENTIDAD_TEST_B'), mention('temporal_reference', 'ayer', 'negated', { days: 1, day_part: 'afternoon' }), mention('temporal_reference', 'hoy', 'affirmed', { days: 0, day_part: 'night' })], { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' });
  const handler = createGeminiV4TemporalValidationHandler({ authenticate: auth(), startTrace: async () => ({ ok: true }), terminalTrace: async () => ({ ok: true }), runProbe: probe(raw) }); const res = reply();
  await handler(request({ fixture_id: 'F3TV-02' }), res); process.env = saved;
  assert.equal(res.result.status, 422); assert.equal(res.result.body.pipeline.semantic.assertions.no_forbidden_positive, true); assert.equal(res.result.body.pipeline.semantic.assertions.correction_expected, true); assert.equal(res.result.body.temporal_diagnostic.stages[2].decision, 'abstained');
});
test('ambigüedad temporal se abstiene sin llamar a comercio', async () => {
  const saved = process.env; process.env = { ...env };
  const raw = base([mention('proper_name', 'ENTIDAD_TEST_C'), mention('temporal_reference', 'otro día')], { correction: 'none', continuation: 'none', cancel_scope: 'none' }, true, ['temporal_reference']);
  const handler = createGeminiV4TemporalValidationHandler({ authenticate: auth(), startTrace: async () => ({ ok: true }), terminalTrace: async () => ({ ok: true }), runProbe: probe(raw) }); const res = reply();
  await handler(request({ fixture_id: 'F3TV-03' }), res); process.env = saved;
  assert.equal(res.result.status, 200); assert.equal(res.result.body.pipeline.semantic.safe_outcome, 'abstained'); assert.equal(res.result.body.commercial_actions_executed, false);
});

Promise.all(tests).then(results => { const failed = results.filter(item => item.status === 'FAIL'); process.stdout.write(JSON.stringify({ phase: 'gemini_v4_temporal_handler_local', result: failed.length ? 'FAIL' : 'PASS', passed: results.length - failed.length, total: results.length, failures: failed, network_calls: 0, gemini_calls: 0, commercial_actions: 0 }) + '\n'); process.exitCode = failed.length ? 1 : 0; });
