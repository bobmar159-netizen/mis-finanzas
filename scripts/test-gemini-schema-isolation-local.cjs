'use strict';

const assert = require('node:assert/strict');
const { buildGeminiGenerateContentRequest, runGeminiSchemaIsolationProbe } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-owner-understanding');
const { configuration, decideGeminiSchemaExperimentRequest } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/preview-gemini-schema-experiment-policy');
const { splitHttpResponse } = require('./lib/preview-http-parser.cjs');
const { createGeminiSchemaIsolationHandler } = require('../PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-schema-isolation');

function diffPaths(left, right, path = '') {
  const entries = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  const result = [];
  for (const key of entries) {
    const next = path ? `${path}.${key}` : key;
    if (!(key in (left || {})) || !(key in (right || {}))) { result.push(next); continue; }
    const a = left[key]; const b = right[key];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) result.push(...diffPaths(a, b, next));
    else if (JSON.stringify(a) !== JSON.stringify(b)) result.push(next);
  }
  return result;
}

async function main() {
  const request = { utterance: 'El del punto adicional.' };
  const baseline = buildGeminiGenerateContentRequest(request, { model: 'gemini-3.5-flash-lite', includeResponseJsonSchema: true });
  const experiment = buildGeminiGenerateContentRequest(request, { model: 'gemini-3.5-flash-lite', includeResponseJsonSchema: false });
  assert.deepEqual(diffPaths(baseline.body, experiment.body), ['generationConfig.responseJsonSchema']);
  assert.equal(baseline.url, experiment.url);
  assert.equal(baseline.model, experiment.model);
  assert.equal(baseline.body.generationConfig.temperature, 0);
  assert.equal(experiment.body.generationConfig.responseMimeType, 'application/json');
  assert.equal('responseJsonSchema' in experiment.body.generationConfig, false);

  let observed;
  const synthetic400 = await runGeminiSchemaIsolationProbe({
    apiKey: 'test-key-not-real',
    model: 'gemini-3.5-flash-lite',
    request,
    fetchImpl: async (url, options) => {
      observed = { url, body: JSON.parse(options.body) };
      return { ok: false, status: 400, json: async () => ({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'INVALID_ARGUMENT' } }) };
    }
  });
  assert.equal(observed.body.generationConfig.responseJsonSchema, undefined);
  assert.equal(synthetic400.accepted, false);
  assert.equal(synthetic400.provider_http_status, 400);
  assert.equal(synthetic400.provider_diagnostic.category, 'PROVIDER_INVALID_ARGUMENT_UNKNOWN');
  assert.equal(synthetic400.response_json_schema_sent, false);

  const env = {
    VERCEL_ENV: 'preview', YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT: 'true',
    YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
    SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co', SUPABASE_SECRET_KEY: 'x'.repeat(32),
    YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID: '11111111-1111-4111-8111-111111111111',
    YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING: 'true', GEMINI_API_KEY: 'test-key-not-real'
  };
  assert.equal(configuration(env).valid, true);
  assert.equal(decideGeminiSchemaExperimentRequest({ method: 'POST', url: '/api/diagnostics/gemini-schema-isolation', headers: { authorization: 'Bearer test' } }, env).allow, true);
  assert.equal(configuration({ ...env, VERCEL_ENV: 'production' }).valid, false);
  assert.equal(decideGeminiSchemaExperimentRequest({ method: 'POST', url: '/api/diagnostics/gemini-schema-isolation', headers: {} }, env).status, 401);

  const parsed = splitHttpResponse('HTTP/2 503 Service Unavailable\r\ncontent-type: application/json\r\n\r\n{"ok":false}');
  assert.equal(parsed.public_http_status, 503);
  assert.equal(parsed.body, '{"ok":false}');
  const plain = splitHttpResponse('{"ok":false}');
  assert.equal(plain.public_http_status, null);
  assert.equal(plain.body, '{"ok":false}');

  const savedEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let capturedStatus = null; let capturedBody = null; let probeCalls = 0;
  const response = { status(code) { capturedStatus = code; return this; }, json(body) { capturedBody = body; return body; } };
  const handler = createGeminiSchemaIsolationHandler({
    authenticate: async () => ({ ok: true, user: { id: '11111111-1111-4111-8111-111111111111' } }),
    runProbe: async input => { probeCalls += 1; assert.deepEqual(input.request, { utterance: 'El del punto adicional.' }); return { accepted: false, provider_http_status: 400, provider_diagnostic: { category: 'PROVIDER_INVALID_ARGUMENT_UNKNOWN' }, provider_ms: 12, response_json_valid: false, response_json_schema_sent: false, baseline_schema_sha256: 'a'.repeat(64), model: 'gemini-3.5-flash-lite', error_code: 'owner_understanding_provider_rejected' }; }
  });
  await handler({ method: 'POST', url: '/api/diagnostics/gemini-schema-isolation', headers: { authorization: 'Bearer test' }, body: { fixture_id: 'F3G-SERVICE' } }, response);
  assert.equal(capturedStatus, 503);
  assert.equal(probeCalls, 1);
  assert.equal(capturedBody.execute, false);
  assert.equal(capturedBody.response_json_schema_sent, false);
  const forbiddenResponse = { status(code) { capturedStatus = code; return this; }, json(body) { capturedBody = body; return body; } };
  await handler({ method: 'POST', url: '/api/diagnostics/gemini-schema-isolation', headers: { authorization: 'Bearer test' }, body: { fixture_id: 'F3G-SERVICE', utterance: 'ignored' } }, forbiddenResponse);
  assert.equal(capturedStatus, 400);
  assert.equal(probeCalls, 1);
  const noAuthHandler = createGeminiSchemaIsolationHandler({
    authenticate: async () => ({ ok: false, status: 401, code: 'owner_reference_unauthorized' }),
    runProbe: async () => { throw new Error('probe must not run'); }
  });
  await noAuthHandler({ method: 'POST', url: '/api/diagnostics/gemini-schema-isolation', headers: { authorization: 'Bearer invalid' }, body: { fixture_id: 'F3G-SERVICE' } }, forbiddenResponse);
  assert.equal(capturedStatus, 401);
  assert.equal(capturedBody.error, 'owner_reference_unauthorized');
  const otherOwnerHandler = createGeminiSchemaIsolationHandler({
    authenticate: async () => ({ ok: true, user: { id: '22222222-2222-4222-8222-222222222222' } }),
    runProbe: async () => { throw new Error('probe must not run'); }
  });
  await otherOwnerHandler({ method: 'POST', url: '/api/diagnostics/gemini-schema-isolation', headers: { authorization: 'Bearer test' }, body: { fixture_id: 'F3G-SERVICE' } }, forbiddenResponse);
  assert.equal(capturedStatus, 403);
  assert.equal(capturedBody.error, 'gemini_schema_experiment_owner_forbidden');
  await handler({ method: 'POST', url: '/api/diagnostics/gemini-schema-isolation', headers: { authorization: 'Bearer test' }, body: { fixture_id: 'F3G-SERVICE', owner_id: '11111111-1111-4111-8111-111111111111' } }, forbiddenResponse);
  assert.equal(capturedStatus, 400);
  assert.equal(probeCalls, 1);
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }

  process.stdout.write(JSON.stringify({ phase: 'gemini_schema_isolation_local', result: 'PASS', tests: 35, network_calls: 0, only_structural_difference: 'generationConfig.responseJsonSchema' }) + '\n');
}

main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'gemini_schema_isolation_local', result: 'FAIL', error: String(error?.message || 'unknown').slice(0, 120) }) + '\n'); process.exitCode = 1; });
