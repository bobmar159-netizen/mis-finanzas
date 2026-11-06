'use strict';

const assert = require('node:assert/strict');
const { proposedJsonSchema } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal');
const { buildGeminiV4ProbeRequest, runGeminiV4Probe } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-v4-probe');
const { createGeminiV4FirstProbeHandler, FIXTURE_ID } = require('../PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-first-probe');

const saved = Object.fromEntries(['VERCEL_ENV','YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT','YARBI_PREVIEW_SUPABASE_PROJECT_REF','SUPABASE_URL','SUPABASE_SECRET_KEY','YARBI_TRACE_HMAC_KEY','YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID','YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING','GEMINI_API_KEY'].map(key => [key, process.env[key]]));
Object.assign(process.env, {
  VERCEL_ENV: 'preview', YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT: 'true', YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
  SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co', SUPABASE_SECRET_KEY: 's'.repeat(40), YARBI_TRACE_HMAC_KEY: 't'.repeat(40),
  YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID: '11111111-1111-4111-8111-111111111111', YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING: 'true', GEMINI_API_KEY: 'test-not-real'
});
const results = [];
function test(name, fn) { return Promise.resolve().then(fn).then(() => results.push({ name, status: 'PASS' })).catch(error => results.push({ name, status: 'FAIL', error: error.message })); }
function response() { return { statusCode: 0, body: null, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } }; }
function raw() { return { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'correction', target_type: 'contact', mentions: [
  { kind: 'proper_name', value: 'Carlos', polarity: 'negated', certainty: 'confirmed', claimed_source: 'utterance' },
  { kind: 'proper_name', value: 'Carla', polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance' }
], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' }, confidence: 0.9, ambiguity: false, missing_information: [] }; }
const auth = async () => ({ ok: true, user: { id: '11111111-1111-4111-8111-111111111111' } });

(async () => {
  await test('schema v4 completo conserva contrato y tamaño compacto', () => {
    const schema = proposedJsonSchema(); const request = buildGeminiV4ProbeRequest({ utterance: 'No era Carlos, era Carla', state: { active_constraints: { name: { value: 'Carlos' } } } });
    assert.equal(request.body.generationConfig.responseMimeType, 'application/json'); assert.deepEqual(request.body.generationConfig.responseJsonSchema, schema);
    assert.ok(request.schema_bytes > 1000 && request.schema_bytes < 3000); assert.match(request.schema_sha256, /^[a-f0-9]{64}$/);
  });
  await test('proveedor v4 simulado envía JSON Schema completo sin red externa', async () => {
    let calls = 0;
    const result = await runGeminiV4Probe({ apiKey: 'fake-key', utterance: 'No era Carlos, era Carla', state: { active_constraints: { name: { value: 'Carlos' } } }, fetchImpl: async (url, init) => { calls += 1; assert.match(url, /generativelanguage\.googleapis\.com/); assert.equal(init.method, 'POST'); assert.equal(init.body.includes('responseJsonSchema'), true); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(raw()) }] } }] }) }; } });
    assert.equal(calls, 1); assert.equal(result.accepted, true);
  });
  await test('handler procesa Gemini v4 a v1/v3 sin consultar candidatos', async () => {
    let calls = 0; const started = []; const terminal = [];
    const handler = createGeminiV4FirstProbeHandler({ authenticate: auth, runProbe: async () => { calls += 1; return { accepted: true, provider_http_status: 200, provider_ms: 12, schema_sha256: 'a'.repeat(64), schema_bytes: 1995, model: 'gemini-3.5-flash-lite', raw: raw() }; }, startTrace: async value => { started.push(value); return { ok: true, duplicate: false }; }, terminalTrace: async value => { terminal.push(value); return { ok: true }; } });
    const res = response(); await handler({ method: 'POST', url: '/api/diagnostics/gemini-v4-first-probe', headers: { authorization: 'Bearer synthetic' }, body: { fixture_id: FIXTURE_ID } }, res);
    assert.equal(res.statusCode, 200); assert.equal(calls, 1); assert.equal(started.length, 1); assert.equal(terminal.length, 1); assert.equal(res.body.execute, false); assert.equal(res.body.commercial_actions_executed, false); assert.equal(res.body.pipeline.status, 'passed'); assert.equal(res.body.pipeline.assertions.discarded_name_never_positive, true); assert.equal(res.body.pipeline.assertions.replacement_name_positive, true); assert.equal(res.body.pipeline.assertions.may_auto_select_false, true);
  });
  await test('segundo dispatch se bloquea antes de Gemini', async () => {
    let calls = 0; const handler = createGeminiV4FirstProbeHandler({ authenticate: auth, runProbe: async () => { calls += 1; return { accepted: true }; }, startTrace: async () => ({ ok: true, duplicate: true }), terminalTrace: async () => ({ ok: true }) });
    const res = response(); await handler({ method: 'POST', url: '/api/diagnostics/gemini-v4-first-probe', headers: { authorization: 'Bearer synthetic' }, body: { fixture_id: FIXTURE_ID } }, res);
    assert.equal(res.statusCode, 409); assert.equal(calls, 0);
  });
  await test('configuración que apunta a producción es rechazada antes de autenticar', async () => {
    const before = process.env.YARBI_PREVIEW_SUPABASE_PROJECT_REF; process.env.YARBI_PREVIEW_SUPABASE_PROJECT_REF = 'haifktjvyhbsazmiyqps';
    let authCalls = 0; const handler = createGeminiV4FirstProbeHandler({ authenticate: async () => { authCalls += 1; return auth(); } }); const res = response();
    await handler({ method: 'POST', url: '/api/diagnostics/gemini-v4-first-probe', headers: { authorization: 'Bearer synthetic' }, body: { fixture_id: FIXTURE_ID } }, res);
    process.env.YARBI_PREVIEW_SUPABASE_PROJECT_REF = before; assert.equal(res.statusCode, 503); assert.equal(authCalls, 0); assert.equal(res.body.error, 'gemini_v4_probe_project_is_production');
  });
  const failures = results.filter(item => item.status === 'FAIL');
  process.stdout.write(JSON.stringify({ phase: 'gemini_v4_first_probe_local', result: failures.length ? 'FAIL' : 'PASS', total: results.length, passed: results.length - failures.length, failures, network_calls: 0, commercial_actions: 0 }, null, 2) + '\n');
  process.exitCode = failures.length ? 1 : 0;
})().finally(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
