'use strict';

// Reanudación única y acotada: verifica el ledger en Preview y procesa solo
// F3PC-04..F3PC-16. No vuelve a tocar F3PC-01..F3PC-03 ni realiza reintentos.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { readFile, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { CASES, validateFixtures } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures');
const { buildGeminiV4ProbeRequest } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-v4-probe');
const { splitHttpResponse } = require('./lib/preview-http-parser.cjs');

const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const ENDPOINT = '/api/diagnostics/gemini-v4-post-corrections-validation';
const EXPECTED_SCHEMA_SHA256 = 'c72ccc5895d02dbbb56fa482cca4397f3d119b73f64a707fb45fea7cfcee87c6';
const PENDING_IDS = Object.freeze(CASES.filter(item => /^F3PC-(0[4-9]|1[0-6])$/.test(item.id)).map(item => item.id));
const FIRST_IDS = Object.freeze(['F3PC-01', 'F3PC-02', 'F3PC-03']);
const ATTEMPT = path.join(__dirname, 'gemini-v4-post-corrections-pending-attempt.json');
const EVIDENCE = path.join(__dirname, 'gemini-v4-post-corrections-pending-evidence.json');
const HISTORICAL_EVIDENCE = path.join(__dirname, 'gemini-v4-post-corrections-real-evidence.json');
const LOCAL_TESTS = [
  'test-yarbi-compact-understanding-local.cjs', 'test-yarbi-polarity-proposal-local.cjs',
  'test-yarbi-v4-v1-integration-local.cjs', 'test-yarbi-v4-adapter-hardening-local.cjs',
  'test-gemini-v4-semantic-validation-local.cjs', 'test-yarbi-v4-forensic-regression-local.cjs',
  'test-yarbi-v4-post-corrections-local.cjs', 'test-gemini-v4-post-corrections-ledger-preflight-local.cjs'
];
const HASHED_ARTIFACTS = Object.freeze([
  '../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures.js',
  '../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-v4-probe.js',
  '../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal.js',
  '../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-v1-adapter-proposal.js',
  '../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-semantic-hardening.js'
]);

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function safeCode(value) { return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function stats(values) { const list = values.filter(Number.isFinite).sort((a, b) => a - b); if (!list.length) return { min: null, median: null, max: null, p95: null }; const middle = Math.floor(list.length / 2); return { min: list[0], median: list.length % 2 ? list[middle] : Math.round((list[middle - 1] + list[middle]) / 2), max: list[list.length - 1], p95: list[Math.min(list.length - 1, Math.ceil(list.length * .95) - 1)] }; }
function safeAssertions(value) { return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key, item]) => /^[a-z0-9_]{1,80}$/i.test(key) && typeof item === 'boolean')) : null; }
function safeBody(body) {
  const pipeline = body?.pipeline || {}; const semantic = pipeline.semantic || {};
  // La primera corrida del lote publicó `semantic_pass` directamente dentro
  // de pipeline. El handler actual publica `semantic.pass`. Al reconstruir
  // resultados históricos, ambos formatos sanitizados representan el mismo
  // hecho y deben conservarse para no alterar el denominador acumulado.
  const semanticPass = semantic.pass === true || pipeline.semantic_pass === true;
  const criticalSecurityFailure = semantic.critical_security_failure === true || pipeline.critical_security_failure === true;
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
    pipeline: { status: safeCode(pipeline.status), stage: safeCode(pipeline.stage), code: safeCode(pipeline.code), semantic_pass: semanticPass, critical_security_failure: criticalSecurityFailure, safe_outcome: safeCode(semantic.safe_outcome || pipeline.safe_outcome), assertions: safeAssertions(semantic.assertions || pipeline.assertions), timings_ms: Object.fromEntries(Object.entries(pipeline.timings_ms || {}).filter(([key, value]) => /^[a-z0-9_]{1,80}$/i.test(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)])) },
    error: safeCode(body?.error), allowed_egress: Array.isArray(body?.allowed_egress) ? body.allowed_egress.filter(item => ['isolated_supabase_auth_and_ledger', 'gemini_generate_content'].includes(item)) : []
  };
}
function runLocalTest(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd: path.join(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.once('error', () => resolve({ file, ok: false, passed: null, total: null })); child.once('close', code => { try { const parsed = JSON.parse(stdout); resolve({ file, ok: code === 0 && parsed.result === 'PASS', passed: Number(parsed.passed) || null, total: Number(parsed.total) || null }); } catch (_) { resolve({ file, ok: false, passed: null, total: null }); } });
  });
}
async function artifactHashes() {
  const entries = await Promise.all(HASHED_ARTIFACTS.map(async relative => {
    const absolute = path.join(__dirname, relative); return { file: relative.replace(/^\.\.\//, ''), sha256: hash(await readFile(absolute)) };
  }));
  const fixture = CASES.find(item => item.id === 'F3PC-04');
  const request = buildGeminiV4ProbeRequest({ utterance: fixture.utterance, state: fixture.state, context: fixture.diagnostic_context });
  if (request.schema_sha256 !== EXPECTED_SCHEMA_SHA256) throw new Error('schema_hash_mismatch');
  return { source_files: entries, schema_sha256: request.schema_sha256, schema_bytes: request.schema_bytes, prompt_sha256: hash(request.body.contents[0].parts[0].text), model: request.model };
}
async function readHistorical() {
  const source = JSON.parse(await readFile(HISTORICAL_EVIDENCE, 'utf8'));
  const rows = Array.isArray(source.results) ? source.results.filter(row => FIRST_IDS.includes(row.fixture_id)) : [];
  if (rows.length !== 3 || !rows.every(row => row.request_http_status === 200 && row.provider_http_status === 200 && row.pipeline?.semantic_pass === true && row.request_count === 1 && row.automatic_retries === 0)) throw new Error('historical_first_three_not_verified');
  const fourth = Array.isArray(source.results) ? source.results.find(row => row.fixture_id === null && row.request_http_status === 401) : null;
  if (!fourth || fourth.provider_http_status !== null) throw new Error('historical_fourth_not_verified');
  return rows.map(safeBody);
}
async function signIn(email, password, key) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error(`isolated_authentication_rejected_http_${Number(response.status) || 0}`); return body.access_token;
}
async function validateAuthenticatedUser(token, key) {
  const response = await fetch(`${SUPABASE}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } }); const body = await response.json().catch(() => null);
  if (!response.ok || !/^[0-9a-f-]{36}$/i.test(String(body?.id || ''))) throw new Error('isolated_authenticated_owner_invalid');
}
function callEndpoint(token, body, preview) {
  return new Promise((resolve, reject) => {
    const started = performance.now(); const args = ['--yes', 'vercel@65.9.0', 'curl', ENDPOINT, '--deployment', preview, '--', '--include', '--request', 'POST', '--header', 'Content-Type: application/json', '--header', `Authorization: Bearer ${token}`, '--data', JSON.stringify(body)];
    const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'); const command = process.platform === 'win32' && existsSync(bundled) ? process.execPath : 'npx'; const commandArgs = command === process.execPath ? [bundled, ...args] : args;
    const child = spawn(command, commandArgs, { cwd: path.join(__dirname, '..', 'PREVIEW_REFERENCIAS_AISLADO'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.once('error', reject); child.once('close', code => { const parsed = splitHttpResponse(stdout); let parsedBody; try { parsedBody = JSON.parse(parsed.body); } catch (_) { return reject(new Error('preview_response_invalid')); } if (code !== 0 && !parsedBody?.fixture_id && parsedBody?.route_mode !== 'ledger_preflight') return reject(new Error('preview_request_failed')); resolve({ http_status: parsed.public_http_status, body: parsedBody, round_trip_ms: Math.round(performance.now() - started) }); });
  });
}
function validLedgerPreflight(response) {
  if (response.http_status !== 200 || response.body?.ok !== true || response.body?.route_mode !== 'ledger_preflight' || response.body?.gemini_invoked !== false || response.body?.fixture_consumed !== false || response.body?.trace_invoked !== false || response.body?.commercial_actions_executed !== false || response.body?.isolated_project_ref !== 'uevilhbstnmmdlgyshlv') return false;
  const entries = new Map((response.body?.ledger?.fixtures || []).map(item => [item.fixture_id, item]));
  const consumed = FIRST_IDS.every(id => { const item = entries.get(id); return item?.event_count === 3 && item?.started_count === 1 && item?.terminal_count === 2 && Array.isArray(item?.terminal_request_counts) && item.terminal_request_counts.length === 1 && item.terminal_request_counts[0] === 1 && item.terminal_stages?.includes('gemini_v4_post_corrections_completed') && item.terminal_stages?.includes('operation_closed'); });
  const fourth = entries.get('F3PC-04')?.event_count === 0;
  const pending = PENDING_IDS.slice(1).every(id => entries.get(id)?.event_count === 0);
  return consumed && fourth && pending;
}
function criticalSafety(row) {
  const assertions = row.pipeline?.assertions || {};
  return row.fixture_id === null || row.execute_false !== true || row.request_count !== 1 || row.automatic_retries !== 0 || row.commercial_actions_executed === true || row.resolver_invoked === true || row.pipeline?.critical_security_failure === true || assertions.no_forbidden_positive === false || assertions.negated_never_positive_constraint === false || assertions.may_auto_select_false === false || [400, 401, 403, 429].includes(row.provider_http_status) || (Number.isFinite(row.provider_http_status) && row.provider_http_status >= 500) || [401, 403, 503].includes(row.request_http_status);
}
function semanticOutcome(row) {
  if (!row?.fixture_id) return 'not_executed';
  if (Number.isFinite(row.provider_http_status) && row.provider_http_status >= 500) return 'blocked_provider';
  if (row.pipeline?.critical_security_failure === true || [400, 401, 403, 429].includes(row.provider_http_status)) return 'blocked_security';
  if (row.pipeline?.semantic_pass === true) return 'semantic_pass';
  if (row.pipeline?.semantic_pass === false) return 'semantic_fail';
  return 'not_executed';
}
function semanticSummary(rows, unambiguousIds) {
  const counts = { semantic_pass: 0, semantic_fail: 0, blocked_provider: 0, blocked_security: 0, not_executed: 0 };
  const unambiguous = { semantic_pass: 0, semantic_fail: 0, blocked_provider: 0, blocked_security: 0, not_executed: 0 };
  for (const row of rows) {
    const outcome = semanticOutcome(row); counts[outcome] += 1;
    if (unambiguousIds.includes(row.fixture_id)) unambiguous[outcome] += 1;
  }
  return { ...counts, evaluated_semantic: counts.semantic_pass + counts.semantic_fail, unambiguous, unambiguous_evaluated_semantic: unambiguous.semantic_pass + unambiguous.semantic_fail };
}
function familySummary(rows) { return Object.fromEntries([...new Set(CASES.map(item => item.family))].map(family => { const subset = rows.filter(row => row.fixture_family === family); const outcomes = subset.reduce((out, row) => { const key = semanticOutcome(row); out[key] = (out[key] || 0) + 1; return out; }, {}); return [family, { completed: subset.length, semantic_pass: outcomes.semantic_pass || 0, semantic_fail: outcomes.semantic_fail || 0, blocked_provider: outcomes.blocked_provider || 0, blocked_security: outcomes.blocked_security || 0 }]; })); }
async function main() {
  if (existsSync(ATTEMPT)) throw new Error('gemini_v4_pending_13_already_dispatched');
  const preview = required('YARBI_V4_PENDING_PREVIEW'); if (!/^https:\/\/misfinanzas-backend-[a-z0-9-]+\.vercel\.app$/i.test(preview)) throw new Error('preview_url_required_or_invalid');
  const fixtureContract = validateFixtures(); if (!fixtureContract.valid || PENDING_IDS.length !== 13 || PENDING_IDS.some(id => FIRST_IDS.includes(id))) throw new Error('fixture_contract_invalid');
  const integrity = await artifactHashes(); const historic = await readHistorical();
  const local = []; for (const file of LOCAL_TESTS) local.push(await runLocalTest(file)); if (!local.every(item => item.ok)) throw new Error('local_preflight_failed');
  const key = required('YARBI_V4_PENDING_PUBLISHABLE_KEY'); const email = required('YARBI_V4_PENDING_OWNER_EMAIL'); const password = required('YARBI_V4_PENDING_OWNER_PASSWORD'); if (!key.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');
  const token = await signIn(email, password, key); await validateAuthenticatedUser(token, key);
  const ledgerResponse = await callEndpoint(token, { ledger_preflight: true }, preview); if (!validLedgerPreflight(ledgerResponse)) throw new Error('ledger_preflight_failed');
  const attempt = { phase: 'gemini_v4_post_corrections_pending_13', state: 'preview_batch_dispatched', preview, isolated_project_ref: 'uevilhbstnmmdlgyshlv', fixture_ids: PENDING_IDS, max_calls: 13, automatic_retries: 0, execute_false: true, local_preflight: local, integrity, historical_verified: { consumed_fixture_ids: FIRST_IDS, fourth_rejected_before_gemini: true }, ledger_preflight: { route_mode: 'ledger_preflight', passed: true }, dispatched_at: new Date().toISOString(), credentials_persisted: false, prompts_persisted: false, provider_responses_persisted: false };
  await writeFile(ATTEMPT, JSON.stringify(attempt, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const results = [];
  for (const fixture of CASES.filter(item => PENDING_IDS.includes(item.id))) {
    let response; try { response = await callEndpoint(token, { fixture_id: fixture.id }, preview); } catch (error) { results.push({ fixture_id: fixture.id, transport_error: safeCode(error?.message), stop_reason: 'transport_or_preview_failure' }); break; }
    const row = { ...safeBody(response.body), request_http_status: response.http_status, round_trip_ms: response.round_trip_ms }; results.push(row); process.stderr.write(`Gemini V4 aislado: ${results.length}/13 casos pendientes terminados\n`);
    if (criticalSafety(row)) { row.stop_reason = 'provider_or_safety_stop'; break; }
  }
  const completed = results.filter(row => PENDING_IDS.includes(row.fixture_id) && !row.transport_error); const allRows = [...historic, ...completed]; const unambiguousIds = CASES.filter(item => item.expect?.clarification !== true).map(item => item.id); const summary = semanticSummary(allRows, unambiguousIds); const correctAbstentions = allRows.filter(row => CASES.find(item => item.id === row.fixture_id)?.expect?.clarification === true && semanticOutcome(row) === 'semantic_pass').length; const critical = results.some(criticalSafety); const complete = completed.length === 13; const threshold = summary.unambiguous_evaluated_semantic === unambiguousIds.length && (summary.unambiguous.semantic_pass / unambiguousIds.length) >= 0.9; const approved = complete && !critical && threshold;
  const evidence = { ...attempt, result: approved ? 'GEMINI_V4_PENDING_13_VALIDATION_APPROVED' : 'GEMINI_V4_PENDING_13_VALIDATION_BLOCKED', completed_calls: completed.length, results, cumulative: { completed_calls: allRows.length, semantic: summary, semantic_pass: `${summary.semantic_pass}/${summary.evaluated_semantic}`, unambiguous_pass: `${summary.unambiguous.semantic_pass}/${summary.unambiguous_evaluated_semantic}`, correct_abstentions: `${correctAbstentions}/${CASES.length - unambiguousIds.length}`, threshold_90_percent_met: threshold, by_family: familySummary(allRows) }, metrics_ms: { gemini: stats(completed.map(row => row.gemini_ms)), handler: stats(completed.map(row => row.server_total_ms)), runner: stats(completed.map(row => row.round_trip_ms)), pipeline: { strict_normalize: stats(completed.map(row => number(row.pipeline?.timings_ms?.strict_normalize_ms))), v4_hardener: stats(completed.map(row => number(row.pipeline?.timings_ms?.v4_hardener_ms))), v4_v1_adapter: stats(completed.map(row => number(row.pipeline?.timings_ms?.v4_v1_adapter_ms))), v1_normalize: stats(completed.map(row => number(row.pipeline?.timings_ms?.v1_normalize_ms))), v3_hardener: stats(completed.map(row => number(row.pipeline?.timings_ms?.v3_hardener_ms))) } }, critical_security_failure: critical, production_used: false, commercial_actions_executed: false, generated_at: new Date().toISOString() };
  await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, evidence: path.basename(EVIDENCE), completed_calls: evidence.completed_calls, cumulative_semantic_pass: evidence.cumulative.semantic_pass, cumulative_unambiguous_pass: evidence.cumulative.unambiguous_pass, gemini_p95_ms: evidence.metrics_ms.gemini.p95, execute_false: true, production_intact: true }) + '\n');
}
module.exports = { safeBody, semanticOutcome, semanticSummary };

if (require.main === module) {
  main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'gemini_v4_post_corrections_pending_13', result: 'FAIL', error: safeCode(error?.message) || 'validation_failed' }) + '\n'); process.exitCode = 1; }).finally(() => { for (const key of ['YARBI_V4_PENDING_PREVIEW', 'YARBI_V4_PENDING_PUBLISHABLE_KEY', 'YARBI_V4_PENDING_OWNER_EMAIL', 'YARBI_V4_PENDING_OWNER_PASSWORD']) delete process.env[key]; });
}
