'use strict';

// Diagnóstico previo al contrato de menciones. Solo ejecuta F3G-SERVICE tres
// veces contra Preview aislado y persiste rasgos abstractos; nunca la frase ni
// el nombre que pudiera proponer el proveedor.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const dataset = require('../tests/fixtures/owner-understanding-semantic-v1.json');
const { canonicalService } = require('../lib/yarbi-semantic-hardening');

const PREVIEW = String(process.env.F3G_PREVIEW_URL || 'https://misfinanzas-backend-e0zstcbjq-omar-dfc4.vercel.app').replace(/\/$/, '');
const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const ENDPOINT = '/api/assistant/reference-candidates';
const OUT = path.join(__dirname, 'f3g-service-diagnostic-evidence.json');

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function text(value, limit = 160) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function normalized(value) { return text(value, 300).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function phrasePresent(haystack, needle) { const right = normalized(needle); return Boolean(right && ` ${normalized(haystack)} `.includes(` ${right} `)); }
function bucket(length) { return length === 0 ? '0' : length <= 8 ? '1_8' : length <= 20 ? '9_20' : length <= 50 ? '21_50' : '51_plus'; }
function tokenCount(value) { return normalized(value).split(' ').filter(Boolean).length; }
function contractStatus(body) { if (body?.ok === true) return 200; if (body?.error === 'understanding_unavailable') return 503; if (body?.error === 'owner_reference_unauthorized') return 401; return body?.error ? 502 : 0; }

async function signIn(email, password, key) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error('isolated_authentication_failed');
  return body.access_token;
}
function previewCall(token, body) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const args = ['--yes', 'vercel@latest', 'curl', ENDPOINT, '--deployment', PREVIEW, '--', '--request', 'POST', '--header', 'Content-Type: application/json', '--header', `Authorization: Bearer ${token}`, '--data', JSON.stringify(body), '--write-out', '\n__HTTP__:%{http_code}'];
    const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    const command = process.platform === 'win32' && existsSync(bundled) ? process.execPath : 'npx';
    const commandArgs = command === process.execPath ? [bundled, ...args] : args;
    const child = spawn(command, commandArgs, { cwd: path.join(__dirname, '..', 'PREVIEW_REFERENCIAS_AISLADO'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; child.stdout.on('data', item => { stdout += item; }); child.once('error', reject);
    child.once('close', code => {
      const marker = stdout.indexOf('\n__HTTP__:'); const raw = (marker >= 0 ? stdout.slice(0, marker) : stdout).trim(); const statusMatch = stdout.match(/__HTTP__:(\d{3})/); let bodyValue;
      try { bodyValue = JSON.parse(raw); } catch (_) { return reject(new Error('preview_response_invalid')); }
      const status = Number(statusMatch?.[1]) || contractStatus(bodyValue); if (code !== 0 && !status) return reject(new Error('preview_request_failed'));
      resolve({ status, body: bodyValue, round_trip_ms: Math.round(performance.now() - started) });
    });
  });
}
function abstractNameDiagnostic(answer, expectedService) {
  const reference = answer && typeof answer.target_reference === 'object' ? answer.target_reference : {};
  const candidate = text(reference.name, 120);
  const expectedAlias = expectedService === 'punto_adicional' ? 'punto adicional' : expectedService;
  const exactAlias = canonicalService(candidate) === expectedService;
  const containsAlias = phrasePresent(candidate, expectedAlias);
  const generic = /^(el|la|ese|esa)\b/.test(normalized(candidate));
  const category = !candidate ? 'other' : exactAlias ? 'exact_service_alias' : containsAlias ? 'service_alias_wrapped_in_phrase' : generic ? 'generic_reference_phrase' : /^[\p{Lu}][\p{L}'-]*(\s+[\p{Lu}][\p{L}'-]*)*$/u.test(candidate) ? 'proper_name_like' : 'other';
  return {
    normalized_length_bucket: bucket(normalized(candidate).length),
    token_count: tokenCount(candidate),
    contains_exact_service_alias: containsAlias,
    equals_exact_service_alias: exactAlias,
    wraps_service_alias: containsAlias && !exactAlias,
    evidence_source: ['utterance', 'conversation_state', 'unknown'].includes(text(reference.source, 32)) ? text(reference.source, 32) : 'unknown',
    evidence_type_detected: containsAlias ? 'service_reference' : generic ? 'generic_reference' : candidate ? 'unknown' : 'absent',
    overlap_with_service_evidence: containsAlias,
    came_from_conversation_state: text(reference.source, 32) === 'conversation_state',
    category
  };
}

async function main() {
  const key = required('F3G_SUPABASE_PUBLISHABLE_KEY'); const email = required('F3G_OWNER_EMAIL'); const password = required('F3G_OWNER_PASSWORD');
  if (!key.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');
  const row = dataset.cases.find(item => item.id === 'F3G-SERVICE'); if (!row) throw new Error('f3g_service_fixture_missing');
  const token = await signIn(email, password, key);
  try {
    const results = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let response;
      try { response = await previewCall(token, { utterance: row.utterance, timezone: 'America/Lima' }); }
      catch (error) { response = { status: 0, body: { ok: false, error: text(error?.message, 80) }, round_trip_ms: null }; }
      const answer = response.body?.understanding || null;
      results.push({ attempt, status: response.status, execute_false: response.body?.execute === false, schema: text(answer?.schema, 80) || null, gemini_ms: Number.isFinite(Number(response.body?.metrics?.gemini_ms)) ? Number(response.body.metrics.gemini_ms) : null, server_total_ms: Number.isFinite(Number(response.body?.metrics?.total_ms)) ? Number(response.body.metrics.total_ms) : null, provider_error: response.status === 200 ? null : text(response.body?.error, 80) || 'request_failed', name_diagnostic: abstractNameDiagnostic(answer, row.service) });
    }
    const evidence = { phase: 'f3g_service_diagnostic', preview: PREVIEW, isolated_project_ref: 'uevilhbstnmmdlgyshlv', model: 'gemini-3.5-flash-lite', calls: 3, case_id: row.id, results, generated_at: new Date().toISOString(), notes: { credentials_persisted: false, utterance_persisted: false, proposed_name_persisted: false, production_used: false, commercial_actions_executed: false } };
    await writeFile(OUT, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({ phase: evidence.phase, result: results.every(item => item.status === 200 && item.execute_false) ? 'PASS' : 'FAIL', evidence: path.basename(OUT), calls: 3, proposed_names_persisted: false }) + '\n');
  } finally { for (const name of ['F3G_SUPABASE_PUBLISHABLE_KEY', 'F3G_OWNER_EMAIL', 'F3G_OWNER_PASSWORD']) delete process.env[name]; }
}
main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'f3g_service_diagnostic', result: 'FAIL', error: text(error?.message, 100) }) + '\n'); process.exitCode = 1; });
