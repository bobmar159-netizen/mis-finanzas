'use strict';

// Runner de una sola ejecución: tres fixtures internos, sin reintentos y sin
// aceptar texto comercial. La evidencia resultante se limita a telemetría y
// diagnóstico estructural sanitizado.
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { CASES, validateFixtures } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-temporal-preview-fixtures');
const { sanitizeTemporalDiagnostic } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-temporal-diagnostics');
const { summarize: summarizeF3TV } = require('./lib/yarbi-f3tv-result-classification.cjs');
const { splitHttpResponse } = require('./lib/preview-http-parser.cjs');

const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const ENDPOINT = '/api/diagnostics/gemini-v4-temporal-validation';
const ATTEMPT = path.join(__dirname, 'gemini-v4-temporal-validation-attempt.json');
const EVIDENCE = path.join(__dirname, 'gemini-v4-temporal-validation-evidence.json');
const MANIFEST = path.join(__dirname, '..', 'YARBI_GEMINI_V4_INSTRUMENTACION_TEMPORAL_SANITIZADA.sha256');
const LOCAL_TESTS = [
  'test-yarbi-compact-understanding-local.cjs', 'test-yarbi-polarity-proposal-local.cjs',
  'test-yarbi-v4-v1-integration-local.cjs', 'test-yarbi-v4-adapter-hardening-local.cjs',
  'test-gemini-v4-semantic-validation-local.cjs', 'test-yarbi-v4-forensic-regression-local.cjs',
  'test-yarbi-v4-post-corrections-local.cjs', 'test-gemini-v4-post-corrections-ledger-preflight-local.cjs',
  'test-yarbi-v4-temporal-forensics-local.cjs', 'test-yarbi-v4-temporal-instrumentation-local.cjs'
];

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function safeCode(value) { return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function stats(values) { const list = values.filter(Number.isFinite).sort((a, b) => a - b); if (!list.length) return { min: null, median: null, max: null }; const middle = Math.floor(list.length / 2); return { min: list[0], median: list.length % 2 ? list[middle] : Math.round((list[middle - 1] + list[middle]) / 2), max: list[list.length - 1] }; }
function hash(file) { return createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase(); }
function verifyManifest() {
  const lines = readFileSync(MANIFEST, 'utf8').split(/\r?\n/).filter(Boolean); if (lines.length < 7) throw new Error('instrumentation_manifest_invalid');
  for (const line of lines) { const match = /^([A-F0-9]{64})\s\s(.+)$/.exec(line); if (!match) throw new Error('instrumentation_manifest_invalid'); if (hash(path.join(__dirname, '..', match[2])) !== match[1]) throw new Error('instrumentation_manifest_mismatch'); }
}
function safeAssertions(value) { return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key, item]) => /^[a-z0-9_]{1,80}$/i.test(key) && typeof item === 'boolean')) : null; }
function safeTimings(value) { return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([key, item]) => /^[a-z0-9_]{1,80}$/i.test(key) && Number.isFinite(Number(item))).map(([key, item]) => [key, Number(item)])); }
function safeBody(body) {
  const pipeline = body?.pipeline || {}; const semantic = pipeline.semantic || {};
  return {
    fixture_id: /^F3TV-0[1-3]$/.test(String(body?.fixture_id || '')) ? body.fixture_id : null,
    fixture_family: /^[a-z_]{3,40}$/i.test(String(body?.fixture_family || '')) ? body.fixture_family : null,
    provider_http_status: Number.isInteger(Number(body?.provider_http_status)) ? Number(body.provider_http_status) : null,
    model: /^[a-z0-9._-]{1,120}$/i.test(String(body?.model || '')) ? body.model : null,
    schema_sha256: /^[a-f0-9]{64}$/i.test(String(body?.schema_sha256 || '')) ? String(body.schema_sha256).toLowerCase() : null,
    schema_bytes: number(body?.schema_bytes), execute_false: body?.execute === false, commercial_actions_executed: body?.commercial_actions_executed === true,
    resolver_invoked: body?.resolver_invoked === true, automatic_retries: Number.isInteger(Number(body?.automatic_retries)) ? Number(body.automatic_retries) : null,
    request_count: Number.isInteger(Number(body?.request_count)) ? Number(body.request_count) : null, gemini_ms: number(body?.gemini_ms), server_total_ms: number(body?.server_total_ms),
    trace_closed: body?.trace_closed === true, temporal_diagnostic: sanitizeTemporalDiagnostic(body?.temporal_diagnostic),
    pipeline: { status: safeCode(pipeline.status), stage: safeCode(pipeline.stage), code: safeCode(pipeline.code), timings_ms: safeTimings(pipeline.timings_ms), semantic: { pass: semantic.pass === true, critical_security_failure: semantic.critical_security_failure === true, safe_outcome: safeCode(semantic.safe_outcome), assertions: safeAssertions(semantic.assertions) } },
    error: safeCode(body?.error), allowed_egress: Array.isArray(body?.allowed_egress) ? body.allowed_egress.filter(item => ['isolated_supabase_auth_and_ledger', 'gemini_generate_content'].includes(item)) : []
  };
}
function runLocalTest(file) {
  return new Promise(resolve => { const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd: path.join(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.once('error', () => resolve({ file, ok: false })); child.once('close', code => { try { const result = JSON.parse(stdout); resolve({ file, ok: code === 0 && result.result === 'PASS', passed: Number(result.passed) || 0, total: Number(result.total) || 0 }); } catch (_) { resolve({ file, ok: false }); } }); });
}
async function signIn(email, password, key) { const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const body = await response.json().catch(() => ({})); if (!response.ok || !body?.access_token) throw new Error(`isolated_authentication_rejected_http_${Number(response.status) || 0}`); return body.access_token; }
async function validateAuthenticatedUser(token, key) { const response = await fetch(`${SUPABASE}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } }); const body = await response.json().catch(() => null); if (!response.ok || !/^[0-9a-f-]{36}$/i.test(String(body?.id || ''))) throw new Error('isolated_authenticated_owner_invalid'); }
function callPreview(token, payload, preview) {
  return new Promise((resolve, reject) => {
    const started = performance.now(); const args = ['--yes', 'vercel@65.9.0', 'curl', ENDPOINT, '--deployment', preview, '--', '--include', '--request', 'POST', '--header', 'Content-Type: application/json', '--header', `Authorization: Bearer ${token}`, '--data', JSON.stringify(payload)];
    // En Windows un .cmd no es ejecutable directo mediante spawn sin shell.
    // Ejecutar el npx-cli.js con el mismo binario Node evita shell=true y no
    // serializa el Bearer en un comando de consola.
    const npxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (!existsSync(npxCli)) return reject(new Error('vercel_cli_launcher_missing'));
    const child = spawn(process.execPath, [npxCli, ...args], { cwd: path.join(__dirname, '..', 'PREVIEW_REFERENCIAS_AISLADO'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.once('error', error => reject(error)); child.once('close', code => { const parsed = splitHttpResponse(stdout); let body; try { body = JSON.parse(parsed.body); } catch (_) { return reject(new Error('preview_response_invalid')); } if (code !== 0 && !body?.ok && !body?.fixture_id) return reject(new Error('preview_request_failed')); resolve({ http_status: parsed.public_http_status, body, round_trip_ms: Math.round(performance.now() - started) }); });
  });
}
function criticalStop(row) { return row.fixture_id === null || row.execute_false !== true || row.request_count !== 1 || row.automatic_retries !== 0 || row.commercial_actions_executed === true || row.resolver_invoked === true || row.pipeline.semantic.critical_security_failure === true || [400, 403, 429].includes(row.provider_http_status) || (Number.isFinite(row.provider_http_status) && row.provider_http_status >= 500) || [401, 403, 503].includes(row.request_http_status); }
async function main() {
  if (existsSync(ATTEMPT)) throw new Error('gemini_v4_temporal_already_dispatched'); verifyManifest();
  const fixtures = validateFixtures(); if (!fixtures.valid) throw new Error('temporal_fixture_contract_invalid');
  const local = []; for (const file of LOCAL_TESTS) local.push(await runLocalTest(file)); const total = local.reduce((sum, item) => sum + item.total, 0); if (!local.every(item => item.ok) || total !== 105) throw new Error('local_preflight_failed');
  const preview = required('YARBI_V4_TEMPORAL_PREVIEW'); if (!/^https:\/\/misfinanzas-backend-[a-z0-9-]+\.vercel\.app$/i.test(preview)) throw new Error('preview_url_required_or_invalid');
  const key = required('YARBI_V4_TEMPORAL_PUBLISHABLE_KEY'); const email = required('YARBI_V4_TEMPORAL_OWNER_EMAIL'); const password = required('YARBI_V4_TEMPORAL_OWNER_PASSWORD'); if (!key.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');
  const token = await signIn(email, password, key); await validateAuthenticatedUser(token, key);
  const authCheck = await callPreview(token, { auth_only: true }, preview); if (authCheck.http_status !== 200 || authCheck.body?.ok !== true || authCheck.body?.gemini_invoked !== false || authCheck.body?.owner_matches !== true) throw new Error('preview_owner_authorization_failed');
  const attempt = { phase: 'gemini_v4_temporal_validation', state: 'preview_dispatched', preview, isolated_project_ref: 'uevilhbstnmmdlgyshlv', fixture_count: 3, max_calls: 3, automatic_retries: 0, execute_false: true, local_preflight_total: total, local_preflight: local, auth_only_passed: true, credentials_persisted: false, prompts_persisted: false, provider_responses_persisted: false, dispatched_at: new Date().toISOString() };
  await writeFile(ATTEMPT, JSON.stringify(attempt, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const results = [];
  for (const fixture of CASES) { let response; try { response = await callPreview(token, { fixture_id: fixture.id }, preview); } catch (error) { results.push({ fixture_id: fixture.id, transport_error: safeCode(error?.message), stop_reason: 'transport_or_preview_failure' }); break; } const row = { ...safeBody(response.body), request_http_status: response.http_status, round_trip_ms: response.round_trip_ms }; results.push(row); process.stderr.write(`Gemini temporal aislado: ${results.length}/3 casos terminados\n`); if (criticalStop(row)) { row.stop_reason = 'provider_or_safety_stop'; break; } }
  const completed = results.filter(row => /^F3TV-0[1-3]$/.test(String(row.fixture_id || '')) && !row.transport_error); const clear = completed.find(row => row.fixture_id === 'F3TV-01'); const correction = completed.find(row => row.fixture_id === 'F3TV-02'); const ambiguous = completed.find(row => row.fixture_id === 'F3TV-03'); const classification = summarizeF3TV(results);
  const contract = { clear_temporal: clear?.pipeline?.semantic?.pass === true, correction_no_negated_positive: correction?.pipeline?.semantic?.assertions?.no_forbidden_positive === true, correction_explicit: correction?.pipeline?.semantic?.assertions?.correction_expected === true, ambiguous_safe_abstention: ambiguous?.pipeline?.semantic?.safe_outcome === 'abstained', all_traces_closed: completed.length === 3 && completed.every(row => row.trace_closed === true), no_external_commercial_action: completed.every(row => row.commercial_actions_executed === false && row.resolver_invoked === false) };
  const ready = completed.length === 3 && !results.some(criticalStop) && Object.values(contract).every(Boolean);
  const evidence = { ...attempt, result: ready ? 'YARBI_V4_TEMPORAL_PREVIEW_3_PASS' : 'YARBI_V4_TEMPORAL_PREVIEW_BLOCKED', completed_calls: completed.length, results, classification, contract, metrics_ms: { gemini: stats(completed.map(row => row.gemini_ms)), handler: stats(completed.map(row => row.server_total_ms)), pipeline: stats(completed.map(row => number(row.pipeline?.timings_ms?.v4_hardener_ms) + number(row.pipeline?.timings_ms?.v4_v1_adapter_ms) + number(row.pipeline?.timings_ms?.v1_normalize_ms) + number(row.pipeline?.timings_ms?.v3_hardener_ms))), instrumentation: stats(completed.map(row => number(row.pipeline?.timings_ms?.temporal_instrumentation_ms))), runner: stats(completed.map(row => row.round_trip_ms)) }, semantic: { passed: classification.semantic.pass_ratio }, production_used: false, commercial_actions_executed: false, generated_at: new Date().toISOString() };
  await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, evidence: path.basename(EVIDENCE), completed_calls: evidence.completed_calls, semantic_pass: evidence.semantic.passed, gemini_median_ms: evidence.metrics_ms.gemini.median, execute_false: true, production_intact: true }) + '\n');
}
main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'gemini_v4_temporal_validation', result: 'FAIL', error: safeCode(error?.message) || 'validation_failed' }) + '\n'); process.exitCode = 1; }).finally(() => { for (const key of ['YARBI_V4_TEMPORAL_PREVIEW', 'YARBI_V4_TEMPORAL_PUBLISHABLE_KEY', 'YARBI_V4_TEMPORAL_OWNER_EMAIL', 'YARBI_V4_TEMPORAL_OWNER_PASSWORD']) delete process.env[key]; });
