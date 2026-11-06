'use strict';

// Ejecuta como máximo una petición al Preview autorizado. El archivo de
// intento se crea antes de despachar la petición y bloquea toda repetición.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const fixtures = require('../tests/fixtures/owner-understanding-semantic-v1.json');

const PREVIEW = 'https://misfinanzas-backend-gfioh0970-omar-dfc4.vercel.app';
const DEPLOYMENT_ID = 'dpl_ZQ8HWhm1qcr7H7itfPox9ZVCYAz5';
const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const PROJECT_REF = 'uevilhbstnmmdlgyshlv';
const ENDPOINT = '/api/assistant/reference-candidates';
const ATTEMPT = path.join(__dirname, 'gemini-http400-single-probe-attempt.json');
const EVIDENCE = path.join(__dirname, 'gemini-http400-single-probe-evidence.json');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function safeCode(value) {
  return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null;
}

function safeOperationId(value) {
  const operationId = String(value || '').trim();
  return /^op1-[a-z0-9_.-]{1,48}-[a-f0-9]{64}$/i.test(operationId) ? operationId : null;
}

async function signIn(email, password, key) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error('isolated_authentication_failed');
  return body.access_token;
}

function previewCallOnce(token, body) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const args = [
      '--yes', 'vercel@latest', 'curl', ENDPOINT,
      '--deployment', PREVIEW, '--',
      '--request', 'POST',
      '--header', 'Content-Type: application/json',
      '--header', `Authorization: Bearer ${token}`,
      '--data', JSON.stringify(body),
      '--write-out', '\n__HTTP__:%{http_code}'
    ];
    const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    const command = process.platform === 'win32' && existsSync(bundled) ? process.execPath : 'npx';
    const commandArgs = command === process.execPath ? [bundled, ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd: path.join(__dirname, '..', 'PREVIEW_REFERENCIAS_AISLADO'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    child.stdout.on('data', item => { stdout += item; });
    child.stderr.on('data', () => {});
    child.once('error', reject);
    child.once('close', code => {
      const marker = stdout.indexOf('\n__HTTP__:');
      const raw = (marker >= 0 ? stdout.slice(0, marker) : stdout).trim();
      const statusMatch = stdout.match(/__HTTP__:(\d{3})/);
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (_) { return reject(new Error('preview_response_invalid')); }
      const status = Number(statusMatch?.[1]) || 0;
      if (code !== 0 && !status) return reject(new Error('preview_request_failed'));
      resolve({ status, body: parsed, roundTripMs: Math.round(performance.now() - started) });
    });
  });
}

async function main() {
  if (existsSync(ATTEMPT)) throw new Error('single_probe_already_dispatched');

  const publishableKey = required('YARBI_PROBE_PUBLISHABLE_KEY');
  const email = required('YARBI_PROBE_OWNER_EMAIL');
  const password = required('YARBI_PROBE_OWNER_PASSWORD');
  if (!publishableKey.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');

  const fixture = fixtures.cases.find(item => item.id === 'F3G-SERVICE');
  if (!fixture || typeof fixture.utterance !== 'string' || !fixture.utterance.trim()) {
    throw new Error('f3g_service_fixture_missing');
  }

  const token = await signIn(email, password, publishableKey);
  const payload = { utterance: fixture.utterance, timezone: 'America/Lima' };
  if ('understanding' in payload) throw new Error('probe_would_use_fast_local');

  const attempt = {
    phase: 'gemini_http400_single_probe',
    state: 'preview_request_dispatched',
    deployment_id: DEPLOYMENT_ID,
    preview: PREVIEW,
    isolated_project_ref: PROJECT_REF,
    fixture_id: fixture.id,
    expected_route: 'NEEDS_LANGUAGE_MODEL',
    automatic_retries: 0,
    dispatched_at: new Date().toISOString()
  };
  await writeFile(ATTEMPT, JSON.stringify(attempt, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });

  let response;
  try {
    response = await previewCallOnce(token, payload);
  } catch (error) {
    const evidence = {
      ...attempt,
      result: 'TRANSPORT_FAILURE_AFTER_DISPATCH',
      transport_error: safeCode(error?.message) || 'preview_request_failed',
      generated_at: new Date().toISOString(),
      secrets_persisted: false,
      production_used: false
    };
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
    throw error;
  }

  const body = response.body && typeof response.body === 'object' ? response.body : {};
  const operationId = safeOperationId(body.operation_id);
  const evidence = {
    phase: 'gemini_http400_single_probe',
    result: 'REQUEST_COMPLETED',
    deployment_id: DEPLOYMENT_ID,
    preview: PREVIEW,
    isolated_project_ref: PROJECT_REF,
    fixture_id: fixture.id,
    request_count: 1,
    automatic_retries: 0,
    expected_route: 'NEEDS_LANGUAGE_MODEL',
    public_http_status: response.status,
    public_ok: body.ok === true,
    public_error: safeCode(body.error),
    understanding_error: safeCode(body.understanding_error),
    operation_id: operationId,
    execute_false: body.execute === false,
    route: safeCode(body.route),
    gemini_called: body.metrics?.gemini_called === true,
    gemini_ms: Number.isFinite(Number(body.metrics?.gemini_ms)) ? Number(body.metrics.gemini_ms) : null,
    server_total_ms: Number.isFinite(Number(body.metrics?.total_ms)) ? Number(body.metrics.total_ms) : null,
    round_trip_ms: response.roundTripMs,
    response_json_valid: true,
    response_contract_safe: body.execute === false && Boolean(operationId),
    credentials_persisted: false,
    utterance_persisted: false,
    provider_body_persisted: false,
    commercial_actions_executed: false,
    production_used: false,
    generated_at: new Date().toISOString()
  };
  await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({
    phase: evidence.phase,
    result: evidence.result,
    evidence: path.basename(EVIDENCE),
    public_http_status: evidence.public_http_status,
    understanding_error: evidence.understanding_error,
    execute_false: evidence.execute_false,
    operation_id_available: Boolean(evidence.operation_id)
  }) + '\n');
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ phase: 'gemini_http400_single_probe', result: 'FAIL', error: safeCode(error?.message) || 'probe_failed' }) + '\n');
  process.exitCode = 1;
}).finally(() => {
  for (const name of ['YARBI_PROBE_PUBLISHABLE_KEY', 'YARBI_PROBE_OWNER_EMAIL', 'YARBI_PROBE_OWNER_PASSWORD']) delete process.env[name];
});

