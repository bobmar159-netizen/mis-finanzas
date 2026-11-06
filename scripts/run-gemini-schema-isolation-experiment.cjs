'use strict';

// Una única petición real a la ruta temporal Preview. El archivo de intento se
// crea antes del despacho; cualquier ejecución posterior queda bloqueada.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { splitHttpResponse } = require('./lib/preview-http-parser.cjs');

const PREVIEW = 'https://misfinanzas-backend-hbn29m0zt-omar-dfc4.vercel.app';
const DEPLOYMENT_ID = 'dpl_3DYubXPHpzYWhZDZm3hJsGfg9BjZ';
const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const PROJECT_REF = 'uevilhbstnmmdlgyshlv';
const ENDPOINT = '/api/diagnostics/gemini-schema-isolation';
const ATTEMPT = path.join(__dirname, 'gemini-schema-isolation-experiment-attempt.json');
const EVIDENCE = path.join(__dirname, 'gemini-schema-isolation-experiment-evidence.json');

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function safeCode(value) { return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null; }
function safeDiagnostic(value) {
  const source = value && typeof value === 'object' ? value : {};
  const allowedSignals = ['invalid_argument','mentions_schema','mentions_complexity','mentions_model','mentions_generation_config','mentions_unknown_field'];
  return {
    provider: String(source.provider || '').toLowerCase() === 'gemini' ? 'gemini' : 'unknown',
    http_status: Number.isInteger(Number(source.http_status)) ? Number(source.http_status) : null,
    provider_status: safeCode(source.provider_status), category: safeCode(source.category),
    signals: Object.fromEntries(allowedSignals.map(key => [key, source.signals?.[key] === true])),
    schema_sha256: /^[a-f0-9]{64}$/i.test(String(source.schema_sha256 || '')) ? String(source.schema_sha256).toLowerCase() : null,
    model: /^[a-z0-9._-]{1,120}$/i.test(String(source.model || '')) ? String(source.model) : null
  };
}

async function signIn(email, password, key) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error('isolated_authentication_failed');
  return body.access_token;
}

function previewCallOnce(token) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const args = ['--yes', 'vercel@65.9.0', 'curl', ENDPOINT, '--deployment', PREVIEW, '--', '--include', '--request', 'POST', '--header', 'Content-Type: application/json', '--header', `Authorization: Bearer ${token}`, '--data', JSON.stringify({ fixture_id: 'F3G-SERVICE' })];
    const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    const command = process.platform === 'win32' && existsSync(bundled) ? process.execPath : 'npx';
    const commandArgs = command === process.execPath ? [bundled, ...args] : args;
    const child = spawn(command, commandArgs, { cwd: path.join(__dirname, '..', 'PREVIEW_REFERENCIAS_AISLADO'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', item => { stdout += item; });
    child.stderr.on('data', () => {});
    child.once('error', reject);
    child.once('close', code => {
      const parsed = splitHttpResponse(stdout);
      let body;
      try { body = JSON.parse(parsed.body); } catch (_) { return reject(new Error('preview_response_invalid')); }
      if (code !== 0 && !body?.schema) return reject(new Error('preview_request_failed'));
      resolve({ public_http_status: parsed.public_http_status, headers_present: parsed.headers_present, body, round_trip_ms: Math.round(performance.now() - started) });
    });
  });
}

async function main() {
  if (existsSync(ATTEMPT)) throw new Error('schema_experiment_already_dispatched');
  const publishableKey = required('YARBI_SCHEMA_PROBE_PUBLISHABLE_KEY');
  const email = required('YARBI_SCHEMA_PROBE_OWNER_EMAIL');
  const password = required('YARBI_SCHEMA_PROBE_OWNER_PASSWORD');
  if (!publishableKey.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');
  const token = await signIn(email, password, publishableKey);
  const attempt = {
    phase: 'gemini_schema_isolation_experiment', state: 'preview_request_dispatched', deployment_id: DEPLOYMENT_ID,
    preview: PREVIEW, isolated_project_ref: PROJECT_REF, fixture_id: 'F3G-SERVICE',
    omitted_property: 'generationConfig.responseJsonSchema', automatic_retries: 0, dispatched_at: new Date().toISOString()
  };
  await writeFile(ATTEMPT, JSON.stringify(attempt, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  let response;
  try { response = await previewCallOnce(token); }
  catch (error) {
    const evidence = { ...attempt, result: 'TRANSPORT_FAILURE_AFTER_DISPATCH', transport_error: safeCode(error?.message), credentials_persisted: false, provider_body_persisted: false, production_used: false, generated_at: new Date().toISOString() };
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
    throw error;
  }
  const body = response.body && typeof response.body === 'object' ? response.body : {};
  const evidence = {
    ...attempt,
    result: 'REQUEST_COMPLETED', request_count: 1,
    public_http_status: response.public_http_status, public_http_status_observed: response.headers_present,
    public_ok: body.ok === true, public_error: safeCode(body.error), route: safeCode(body.route), execute_false: body.execute === false,
    response_json_schema_sent: body.response_json_schema_sent === true,
    baseline_schema_sha256: /^[a-f0-9]{64}$/i.test(String(body.baseline_schema_sha256 || '')) ? String(body.baseline_schema_sha256).toLowerCase() : null,
    model: /^[a-z0-9._-]{1,120}$/i.test(String(body.model || '')) ? String(body.model) : null,
    provider_http_status: Number.isInteger(Number(body.provider_http_status)) ? Number(body.provider_http_status) : null,
    provider_diagnostic: body.provider_diagnostic ? safeDiagnostic(body.provider_diagnostic) : null,
    provider_ms: Number.isFinite(Number(body.provider_ms)) ? Number(body.provider_ms) : null,
    response_json_valid: body.response_json_valid === true, commercial_actions_executed: body.commercial_actions_executed === true,
    round_trip_ms: response.round_trip_ms, credentials_persisted: false, provider_body_persisted: false, utterance_persisted: false, production_used: false, generated_at: new Date().toISOString()
  };
  await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, evidence: path.basename(EVIDENCE), public_http_status: evidence.public_http_status, provider_http_status: evidence.provider_http_status, category: evidence.provider_diagnostic?.category || null, response_json_schema_sent: evidence.response_json_schema_sent, execute_false: evidence.execute_false }) + '\n');
}

main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'gemini_schema_isolation_experiment', result: 'FAIL', error: safeCode(error?.message) || 'experiment_failed' }) + '\n'); process.exitCode = 1; }).finally(() => {
  for (const name of ['YARBI_SCHEMA_PROBE_PUBLISHABLE_KEY','YARBI_SCHEMA_PROBE_OWNER_EMAIL','YARBI_SCHEMA_PROBE_OWNER_PASSWORD']) delete process.env[name];
});
