'use strict';

// Runner manual de una ejecución. Nunca persiste credenciales, JWT, prompt ni
// respuesta cruda de Gemini. Un archivo de intento evita una segunda llamada.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { splitHttpResponse } = require('./lib/preview-http-parser.cjs');

const PREVIEW = 'https://misfinanzas-backend-j1u30ej9t-omar-dfc4.vercel.app';
const DEPLOYMENT_ID = 'dpl_HicTemA7jmtFUvNxM8iwLLMjwLWq';
const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const ENDPOINT = '/api/diagnostics/gemini-v4-first-probe';
const ATTEMPT = path.join(__dirname, 'gemini-v4-first-probe-attempt.json');
const EVIDENCE = path.join(__dirname, 'gemini-v4-first-probe-evidence.json');
const FIXTURE_ID = 'F3V4-CORRECTION';

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function safeCode(value) { return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null; }
function safeProviderDiagnostic(value) {
  const source = value && typeof value === 'object' ? value : {};
  const signals = ['invalid_argument','mentions_schema','mentions_complexity','mentions_model','mentions_generation_config','mentions_unknown_field'];
  return { provider: String(source.provider || '').toLowerCase() === 'gemini' ? 'gemini' : 'unknown', http_status: Number.isInteger(Number(source.http_status)) ? Number(source.http_status) : null, provider_status: safeCode(source.provider_status), category: safeCode(source.category), signals: Object.fromEntries(signals.map(key => [key, source.signals?.[key] === true])), schema_sha256: /^[a-f0-9]{64}$/i.test(String(source.schema_sha256 || '')) ? String(source.schema_sha256).toLowerCase() : null, model: /^[a-z0-9._-]{1,120}$/i.test(String(source.model || '')) ? String(source.model) : null };
}
async function signIn(email, password, key) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error(`isolated_authentication_rejected_http_${Number(response.status) || 0}`);
  return body.access_token;
}
function callOnce(token) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const args = ['--yes','vercel@65.9.0','curl',ENDPOINT,'--deployment',PREVIEW,'--','--include','--request','POST','--header','Content-Type: application/json','--header',`Authorization: Bearer ${token}`,'--data',JSON.stringify({ fixture_id: FIXTURE_ID })];
    const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    const command = process.platform === 'win32' && existsSync(bundled) ? process.execPath : 'npx';
    const commandArgs = command === process.execPath ? [bundled, ...args] : args;
    const child = spawn(command, commandArgs, { cwd: path.join(__dirname, '..', 'PREVIEW_REFERENCIAS_AISLADO'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', () => {});
    child.once('error', reject);
    child.once('close', code => {
      const parsed = splitHttpResponse(stdout); let body;
      try { body = JSON.parse(parsed.body); } catch (_) { return reject(new Error('preview_response_invalid')); }
      if (code !== 0 && !Object.hasOwn(body, 'fixture_id')) return reject(new Error('preview_request_failed'));
      resolve({ public_http_status: parsed.public_http_status, headers_present: parsed.headers_present, body, round_trip_ms: Math.round(performance.now() - started) });
    });
  });
}
async function main() {
  if (existsSync(ATTEMPT)) throw new Error('gemini_v4_probe_already_dispatched');
  const key = required('YARBI_V4_PROBE_PUBLISHABLE_KEY');
  const email = required('YARBI_V4_PROBE_OWNER_EMAIL');
  const password = required('YARBI_V4_PROBE_OWNER_PASSWORD');
  if (!key.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');
  const token = await signIn(email, password, key);
  const attempt = { phase: 'gemini_v4_first_probe', state: 'preview_request_dispatched', deployment_id: DEPLOYMENT_ID, preview: PREVIEW, isolated_project_ref: 'uevilhbstnmmdlgyshlv', fixture_id: FIXTURE_ID, model: 'gemini-3.5-flash-lite', automatic_retries: 0, execute_false: true, dispatched_at: new Date().toISOString(), credentials_persisted: false };
  await writeFile(ATTEMPT, JSON.stringify(attempt, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  let response;
  try { response = await callOnce(token); }
  catch (error) {
    await writeFile(EVIDENCE, JSON.stringify({ ...attempt, result: 'TRANSPORT_FAILURE_AFTER_DISPATCH', transport_error: safeCode(error?.message), provider_body_persisted: false, utterance_persisted: false, production_used: false, generated_at: new Date().toISOString() }, null, 2), { encoding: 'utf8', mode: 0o600 });
    throw error;
  }
  const body = response.body && typeof response.body === 'object' ? response.body : {};
  const evidence = {
    ...attempt,
    result: 'REQUEST_COMPLETED', request_count: Number(body.request_count) || 0, public_http_status: response.public_http_status, public_http_status_observed: response.headers_present,
    public_ok: body.ok === true, public_error: safeCode(body.error), route: safeCode(body.route), operation_id: /^[a-z0-9_-]{12,160}$/i.test(String(body.operation_id || '')) ? String(body.operation_id) : null,
    execute_false: body.execute === false, commercial_actions_executed: body.commercial_actions_executed === true,
    model: /^[a-z0-9._-]{1,120}$/i.test(String(body.model || '')) ? String(body.model) : null, schema_sha256: /^[a-f0-9]{64}$/i.test(String(body.schema_sha256 || '')) ? String(body.schema_sha256).toLowerCase() : null,
    schema_bytes: Number.isFinite(Number(body.schema_bytes)) ? Number(body.schema_bytes) : null, provider_http_status: Number.isInteger(Number(body.provider_http_status)) ? Number(body.provider_http_status) : null,
    provider_diagnostic: body.provider_diagnostic ? safeProviderDiagnostic(body.provider_diagnostic) : null, gemini_ms: Number.isFinite(Number(body.gemini_ms)) ? Number(body.gemini_ms) : null,
    server_total_ms: Number.isFinite(Number(body.server_total_ms)) ? Number(body.server_total_ms) : null, pipeline: body.pipeline && typeof body.pipeline === 'object' ? { status: safeCode(body.pipeline.status), stage: safeCode(body.pipeline.stage), code: safeCode(body.pipeline.code), timings_ms: body.pipeline.timings_ms && typeof body.pipeline.timings_ms === 'object' ? Object.fromEntries(Object.entries(body.pipeline.timings_ms).filter(([key, value]) => /^[a-z0-9_]{1,64}$/i.test(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)])) : {}, assertions: body.pipeline.assertions && typeof body.pipeline.assertions === 'object' ? Object.fromEntries(Object.entries(body.pipeline.assertions).filter(([key, value]) => /^[a-z0-9_]{1,64}$/i.test(key) && typeof value === 'boolean')) : null } : null,
    trace_closed: body.trace_closed === true, allowed_egress: Array.isArray(body.allowed_egress) ? body.allowed_egress.filter(item => ['isolated_supabase_auth_and_ledger','gemini_generate_content'].includes(item)) : [],
    round_trip_ms: response.round_trip_ms, provider_body_persisted: false, utterance_persisted: false, credentials_persisted: false, production_used: false, generated_at: new Date().toISOString()
  };
  await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.public_ok && evidence.pipeline?.status === 'passed' && evidence.trace_closed ? 'GEMINI_V4_PRIMERA_SONDA_EXITOSA' : 'REQUEST_COMPLETED_WITH_OBSERVATIONS', evidence: path.basename(EVIDENCE), public_http_status: evidence.public_http_status, provider_http_status: evidence.provider_http_status, schema_sha256: evidence.schema_sha256, operation_id_available: Boolean(evidence.operation_id), execute_false: evidence.execute_false }) + '\n');
}
main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'gemini_v4_first_probe', result: 'FAIL', error: safeCode(error?.message) || 'probe_failed' }) + '\n'); process.exitCode = 1; }).finally(() => { for (const name of ['YARBI_V4_PROBE_PUBLISHABLE_KEY','YARBI_V4_PROBE_OWNER_EMAIL','YARBI_V4_PROBE_OWNER_PASSWORD']) delete process.env[name]; });
