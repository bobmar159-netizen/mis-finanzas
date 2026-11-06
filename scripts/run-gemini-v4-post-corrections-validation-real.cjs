'use strict';

// Runner manual y de una sola ejecución. Llama exclusivamente la ruta V4
// diagnóstica del Preview aislado, una vez por fixture, sin reintentos.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { CASES, validateFixtures } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures');
const { splitHttpResponse } = require('./lib/preview-http-parser.cjs');

const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const ENDPOINT = '/api/diagnostics/gemini-v4-post-corrections-validation';
const ATTEMPT = path.join(__dirname, 'gemini-v4-post-corrections-real-attempt.json');
const EVIDENCE = path.join(__dirname, 'gemini-v4-post-corrections-real-evidence.json');
const LOCAL_TESTS = [
  'test-yarbi-compact-understanding-local.cjs', 'test-yarbi-polarity-proposal-local.cjs',
  'test-yarbi-v4-v1-integration-local.cjs', 'test-yarbi-v4-adapter-hardening-local.cjs',
  'test-gemini-v4-semantic-validation-local.cjs',
  'test-yarbi-v4-forensic-regression-local.cjs', 'test-yarbi-v4-post-corrections-local.cjs'
];

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function safeCode(value) { return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function stats(values) { const list = values.filter(Number.isFinite).sort((a, b) => a - b); if (!list.length) return { min: null, median: null, max: null, p95: null }; const mid = Math.floor(list.length / 2); return { min: list[0], median: list.length % 2 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2), max: list[list.length - 1], p95: list[Math.min(list.length - 1, Math.ceil(list.length * .95) - 1)] }; }
function safeAssertions(value) { return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key, item]) => /^[a-z0-9_]{1,80}$/i.test(key) && typeof item === 'boolean')) : null; }
function safeBody(body) {
  const pipeline = body?.pipeline || {}; const semantic = pipeline.semantic || {};
  return {
    fixture_id: /^F3PC-\d{2}$/.test(String(body?.fixture_id || '')) ? body.fixture_id : null,
    fixture_family: /^[a-z_]{3,40}$/i.test(String(body?.fixture_family || '')) ? body.fixture_family : null,
    request_http_status: number(body?.request_http_status), provider_http_status: Number.isInteger(Number(body?.provider_http_status)) ? Number(body.provider_http_status) : null,
    model: /^[a-z0-9._-]{1,120}$/i.test(String(body?.model || '')) ? body.model : null,
    schema_sha256: /^[a-f0-9]{64}$/i.test(String(body?.schema_sha256 || '')) ? String(body.schema_sha256).toLowerCase() : null,
    schema_bytes: number(body?.schema_bytes), execute_false: body?.execute === false,
    commercial_actions_executed: body?.commercial_actions_executed === true, resolver_invoked: body?.resolver_invoked === true,
    automatic_retries: Number.isInteger(Number(body?.automatic_retries)) ? Number(body.automatic_retries) : null,
    request_count: Number.isInteger(Number(body?.request_count)) ? Number(body.request_count) : null,
    gemini_ms: number(body?.gemini_ms), server_total_ms: number(body?.server_total_ms), trace_closed: body?.trace_closed === true,
    pipeline: { status: safeCode(pipeline.status), stage: safeCode(pipeline.stage), code: safeCode(pipeline.code), semantic_pass: semantic.pass === true, critical_security_failure: semantic.critical_security_failure === true, safe_outcome: safeCode(semantic.safe_outcome), assertions: safeAssertions(semantic.assertions), timings_ms: Object.fromEntries(Object.entries(pipeline.timings_ms || {}).filter(([key, value]) => /^[a-z0-9_]{1,80}$/i.test(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)])) },
    error: safeCode(body?.error), allowed_egress: Array.isArray(body?.allowed_egress) ? body.allowed_egress.filter(item => ['isolated_supabase_auth_and_ledger', 'gemini_generate_content'].includes(item)) : []
  };
}
function runLocalTest(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd: path.join(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.once('error', () => resolve({ file, ok: false, passed: null, total: null })); child.once('close', code => { try { const parsed = JSON.parse(stdout); resolve({ file, ok: code === 0 && parsed.result === 'PASS', passed: Number(parsed.passed) || null, total: Number(parsed.total) || null }); } catch (_) { resolve({ file, ok: false, passed: null, total: null }); } });
  });
}
async function signIn(email, password, key) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error(`isolated_authentication_rejected_http_${Number(response.status) || 0}`); return body.access_token;
}
async function validateAuthenticatedUser(token, key) {
  const response = await fetch(`${SUPABASE}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } }); const body = await response.json().catch(() => null);
  if (!response.ok || !/^[0-9a-f-]{36}$/i.test(String(body?.id || ''))) throw new Error('isolated_authenticated_owner_invalid');
}
function callOne(token, fixtureId, preview) {
  return new Promise((resolve, reject) => {
    const started = performance.now(); const args = ['--yes', 'vercel@65.9.0', 'curl', ENDPOINT, '--deployment', preview, '--', '--include', '--request', 'POST', '--header', 'Content-Type: application/json', '--header', `Authorization: Bearer ${token}`, '--data', JSON.stringify({ fixture_id: fixtureId })];
    const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'); const command = process.platform === 'win32' && existsSync(bundled) ? process.execPath : 'npx'; const commandArgs = command === process.execPath ? [bundled, ...args] : args;
    const child = spawn(command, commandArgs, { cwd: path.join(__dirname, '..', 'PREVIEW_REFERENCIAS_AISLADO'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.once('error', reject); child.once('close', code => { const parsed = splitHttpResponse(stdout); let body; try { body = JSON.parse(parsed.body); } catch (_) { return reject(new Error('preview_response_invalid')); } if (code !== 0 && !body?.fixture_id) return reject(new Error('preview_request_failed')); resolve({ http_status: parsed.public_http_status, body, round_trip_ms: Math.round(performance.now() - started) }); });
  });
}
function mustStop(row) {
  const provider = row.provider_http_status; const publicStatus = row.request_http_status;
  return row.fixture_id === null || row.execute_false !== true || row.request_count !== 1 || row.automatic_retries !== 0 || row.commercial_actions_executed === true || row.resolver_invoked === true || row.pipeline.critical_security_failure === true || [400, 403, 429].includes(provider) || (Number.isFinite(provider) && provider >= 500) || [401, 403, 503].includes(publicStatus);
}
async function main() {
  if (existsSync(ATTEMPT)) throw new Error('gemini_v4_post_corrections_already_dispatched');
  const preview = required('YARBI_V4_POST_CORRECTIONS_PREVIEW'); if (!/^https:\/\/misfinanzas-backend-[a-z0-9-]+\.vercel\.app$/i.test(preview)) throw new Error('preview_url_required_or_invalid');
  const fixtures = validateFixtures(); if (!fixtures.valid || CASES.length !== 16) throw new Error('fixture_contract_invalid');
  const local = []; for (const file of LOCAL_TESTS) local.push(await runLocalTest(file)); const totalLocal = local.reduce((sum, item) => sum + (item.total || 0), 0); if (!local.every(item => item.ok) || totalLocal !== 87) throw new Error('local_preflight_failed');
  const key = required('YARBI_V4_POST_CORRECTIONS_PUBLISHABLE_KEY'); const email = required('YARBI_V4_POST_CORRECTIONS_OWNER_EMAIL'); const password = required('YARBI_V4_POST_CORRECTIONS_OWNER_PASSWORD'); if (!key.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');
  const token = await signIn(email, password, key); await validateAuthenticatedUser(token, key);
  const attempt = { phase: 'gemini_v4_post_corrections_validation', state: 'preview_batch_dispatched', preview, isolated_project_ref: 'uevilhbstnmmdlgyshlv', fixture_count: 16, max_calls: 16, automatic_retries: 0, execute_false: true, local_preflight: local, local_preflight_total: totalLocal, dispatched_at: new Date().toISOString(), credentials_persisted: false, prompts_persisted: false, provider_responses_persisted: false };
  await writeFile(ATTEMPT, JSON.stringify(attempt, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const results = [];
  for (const fixture of CASES) {
    let response; try { response = await callOne(token, fixture.id, preview); } catch (error) { results.push({ fixture_id: fixture.id, transport_error: safeCode(error?.message), stop_reason: 'transport_or_preview_failure' }); break; }
    const row = { ...safeBody(response.body), request_http_status: response.http_status, round_trip_ms: response.round_trip_ms }; results.push(row); process.stderr.write(`Gemini V4 aislado: ${results.length}/16 casos terminados\n`);
    if (mustStop(row)) { row.stop_reason = 'provider_or_safety_stop'; break; }
  }
  const completed = results.filter(row => /^F3PC-\d{2}$/.test(String(row.fixture_id || '')) && !row.transport_error); const unambiguous = CASES.filter(item => item.expect?.clarification !== true); const unambiguousRows = completed.filter(row => CASES.find(item => item.id === row.fixture_id)?.expect?.clarification !== true); const semanticPass = completed.filter(row => row.pipeline.semantic_pass).length; const unambiguousPass = unambiguousRows.filter(row => row.pipeline.semantic_pass).length; const correctAbstentions = completed.filter(row => CASES.find(item => item.id === row.fixture_id)?.expect?.clarification === true && row.pipeline.semantic_pass).length; const critical = results.some(row => mustStop(row)); const completedAll = completed.length === CASES.length; const threshold = unambiguousRows.length === unambiguous.length && unambiguousPass / unambiguous.length >= 0.9; const readiness = completedAll && !critical && threshold;
  const evidence = { ...attempt, result: readiness ? 'GEMINI_V4_POST_CORRECTIONS_VALIDATION_APPROVED' : 'GEMINI_V4_POST_CORRECTIONS_VALIDATION_BLOCKED', completed_calls: completed.length, results, by_family: Object.fromEntries([...new Set(CASES.map(item => item.family))].map(family => { const rows = completed.filter(row => row.fixture_family === family); return [family, { completed: rows.length, semantic_pass: rows.filter(row => row.pipeline.semantic_pass).length }]; })), metrics_ms: { gemini: stats(completed.map(row => row.gemini_ms)), handler: stats(completed.map(row => row.server_total_ms)), runner: stats(completed.map(row => row.round_trip_ms)), pipeline: { strict_normalize: stats(completed.map(row => number(row.pipeline?.timings_ms?.strict_normalize_ms))), v4_hardener: stats(completed.map(row => number(row.pipeline?.timings_ms?.v4_hardener_ms))), v4_v1_adapter: stats(completed.map(row => number(row.pipeline?.timings_ms?.v4_v1_adapter_ms))), v1_normalize: stats(completed.map(row => number(row.pipeline?.timings_ms?.v1_normalize_ms))), v3_hardener: stats(completed.map(row => number(row.pipeline?.timings_ms?.v3_hardener_ms))) } }, semantic: { total: `${semanticPass}/${completed.length}`, unambiguous: `${unambiguousPass}/${unambiguous.length}`, correct_abstentions: `${correctAbstentions}/${CASES.length - unambiguous.length}`, threshold_90_percent_met: threshold }, critical_security_failure: critical, production_used: false, commercial_actions_executed: false, generated_at: new Date().toISOString() };
  await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, evidence: path.basename(EVIDENCE), completed_calls: evidence.completed_calls, semantic_total: evidence.semantic.total, unambiguous: evidence.semantic.unambiguous, correct_abstentions: evidence.semantic.correct_abstentions, gemini_p95_ms: evidence.metrics_ms.gemini.p95, execute_false: true, production_intact: true }) + '\n');
}
main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'gemini_v4_post_corrections_validation', result: 'FAIL', error: safeCode(error?.message) || 'validation_failed' }) + '\n'); process.exitCode = 1; }).finally(() => { for (const key of ['YARBI_V4_POST_CORRECTIONS_PREVIEW', 'YARBI_V4_POST_CORRECTIONS_PUBLISHABLE_KEY', 'YARBI_V4_POST_CORRECTIONS_OWNER_EMAIL', 'YARBI_V4_POST_CORRECTIONS_OWNER_PASSWORD']) delete process.env[key]; });
