'use strict';

// Runner manual, de una sola ejecución. No imprime ni persiste contraseñas,
// JWT ni claves. Las recibe temporalmente desde el wrapper PowerShell y solo
// guarda evidencia sanitaria de fixtures F3S.
const { spawn } = require('node:child_process');
const { writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');

const PREVIEW = 'https://misfinanzas-backend-2y04kg0c0-omar-dfc4.vercel.app';
const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const ENDPOINT = '/api/assistant/reference-candidates';
const OUT = path.join(__dirname, 'owner-references-preview-e2e-evidence.json');

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function percentile(values, fraction) { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0; }
function stats(samples, valueFor = item => item.round_trip_ms) { const values = samples.map(valueFor).map(Number).filter(Number.isFinite); return { n: values.length, min_ms: Math.min(...values), p50_ms: percentile(values, .5), p95_ms: percentile(values, .95), max_ms: Math.max(...values) }; }
function profile(samples) { const metric = name => stats(samples, item => item.metrics?.[name]); return { server_processing_ms: metric('total_ms'), auth_ms: metric('auth_ms'), scope_ms: metric('scope_ms'), candidate_query_ms: metric('candidate_query_ms'), enrichment_ms: metric('enrichment_ms'), resolver_ms: metric('resolver_ms'), trace_ms: metric('trace_ms'), other_overhead_ms: metric('other_overhead_ms'), cli_test_overhead_ms: stats(samples, item => Number(item.round_trip_ms || 0) - Number(item.metrics?.total_ms || 0)) }; }
function safeResult(result) { return { status: result.status, status_source: result.status_source, ok: result.body?.ok === true, error: result.body?.error || null, execute: result.body?.execute === false ? false : result.body?.execute === true ? true : null, is_read_only: result.body?.execute === false, operation_id_present: /^op1-/.test(String(result.body?.operation_id || '')), candidate_outcome: result.body?.candidate_outcome || null, candidate_count: Number(result.body?.candidates?.length || 0), candidate_ids: (result.body?.candidates || []).map(row => Number(row.contact_id)).filter(Number.isSafeInteger), metrics: result.body?.metrics || null, round_trip_ms: result.round_trip_ms }; }

// `vercel curl` puede omitir --write-out en Windows. Solo si el cuerpo JSON
// coincide exactamente con el contrato de esta Function, recuperamos su
// estado documentado; no se inventan estados para respuestas desconocidas.
function contractStatus(body) {
  if (body?.ok === true) return 200;
  const code = String(body?.error || '');
  if (code === 'owner_reference_preview_method_not_allowed') return 405;
  if (code === 'owner_reference_preview_unauthorized') return 401;
  if (code === 'owner_reference_unauthorized') return 401;
  if (code === 'owner_scope_client_input_forbidden') return 400;
  if (code === 'owner_reference_preview_not_configured' || code === 'trace_hmac_key_missing') return 503;
  if (code) return 502;
  return 0;
}

async function signIn(email, password, publishableKey) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error('isolated_authentication_failed');
  return body.access_token;
}

function vercelCurl(token, body) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const args = ['--yes', 'vercel@latest', 'curl', ENDPOINT, '--deployment', PREVIEW, '--', '--request', 'POST', '--header', 'Content-Type: application/json', '--header', `Authorization: Bearer ${token}`, '--data', JSON.stringify(body), '--write-out', '\n__HTTP__:%{http_code}'];
    // En Windows invocamos el CLI JavaScript que usa npx.cmd, mediante el
    // mismo node actual. Así se preservan encabezados con espacios sin pasar
    // JWT ni JSON por un shell.
    const bundledNpxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    const command = process.platform === 'win32' && existsSync(bundledNpxCli) ? process.execPath : 'npx';
    const commandArgs = command === process.execPath ? [bundledNpxCli, ...args] : args;
    const child = spawn(command, commandArgs, { cwd: path.join(__dirname, '..', 'PREVIEW_REFERENCIAS_AISLADO'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      const markerIndex = stdout.indexOf('\n__HTTP__:');
      const raw = (markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout).trim();
      const codes = [...stdout.matchAll(/__HTTP__:(\d{3})/g)].map(match => Number(match[1]));
      const explicitStatus = codes.find(value => value > 0) || 0;
      let parsed; try { parsed = JSON.parse(raw); } catch (_) { return reject(new Error('preview_response_invalid')); }
      const status = explicitStatus || contractStatus(parsed);
      if (code !== 0 && !status) return reject(new Error('preview_request_failed'));
      resolve({ status, status_source: explicitStatus ? 'curl_write_out' : 'response_contract_fallback', body: parsed, round_trip_ms: Math.round(performance.now() - started), stderr: stderr.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]') });
    });
  });
}

async function execute(label, token, body) { return { label, ...safeResult(await vercelCurl(token, body)) }; }
function assert(condition, code) { if (!condition) throw new Error(code); }

async function main() {
  const publishableKey = required('F3REF_SUPABASE_PUBLISHABLE_KEY');
  const emailA = required('F3REF_OWNER_A_EMAIL'); const passwordA = required('F3REF_OWNER_A_PASSWORD');
  const emailB = required('F3REF_OWNER_B_EMAIL'); const passwordB = required('F3REF_OWNER_B_PASSWORD');
  const noScopeEmail = String(process.env.F3REF_NO_SCOPE_EMAIL || '').trim(); const noScopePassword = String(process.env.F3REF_NO_SCOPE_PASSWORD || '');
  if (!publishableKey.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');
  const tokenA = await signIn(emailA, passwordA, publishableKey); const tokenB = await signIn(emailB, passwordB, publishableKey);
  const cases = [];
  try {
    const sameName = { understanding: { constraints: { name: { value: 'YARBI-OWNER-SCOPE-DUPLICADO', certainty: 'confirmed' } } } };
    const phoneA = { understanding: { constraints: { phone: '900000001' } } };
    const comas = { understanding: { constraints: { district: { value: 'Comas', certainty: 'confirmed' } } } };
    const service = { understanding: { constraints: { service: { value: 'reparacion', certainty: 'confirmed' } } } };
    const morning = { timezone: 'America/Lima', understanding: { temporal_clues: [{ days: 0, day_part: 'morning', certainty: 'confirmed' }] } };
    const night = { timezone: 'America/Lima', understanding: { temporal_clues: [{ days: 1, day_part: 'night', certainty: 'confirmed' }] } };
    const unknown = { understanding: { constraints: { name: { value: 'F3S-NO-EXISTE', certainty: 'confirmed' } } } };
    const ownerAGate = await execute('A_owner_a_same_name', tokenA, sameName);
    cases.push(ownerAGate);
    // Una falla de la primera ruta positiva debe ser visible y reproducible
    // sin obligar al dueño a esperar la batería completa de latencia.
    if (!(ownerAGate.status === 200 && ownerAGate.candidate_count >= 1 && ownerAGate.execute === false)) {
      const evidence = { phase: 'owner_references_preview_e2e', result: 'FAIL', stage: 'owner_a_gate', preview: PREVIEW, allowed_hosts: [new URL(PREVIEW).hostname, new URL(SUPABASE).hostname], request: ownerAGate, generated_at: new Date().toISOString(), notes: { tokens_persisted: false, passwords_persisted: false } };
      await writeFile(OUT, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
      process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, stage: evidence.stage, evidence: path.basename(OUT), status: ownerAGate.status, error: ownerAGate.error, candidate_outcome: ownerAGate.candidate_outcome, candidate_count: ownerAGate.candidate_count }) + '\n');
      return;
    }
    cases.push(await execute('B_owner_b_same_name', tokenB, sameName));
    cases.push(await execute('C_owner_b_phone_of_a', tokenB, phoneA));
    cases.push(await execute('E_owner_a_district_comas', tokenA, comas));
    cases.push(await execute('F_owner_a_service', tokenA, service));
    cases.push(await execute('G_owner_a_morning', tokenA, morning));
    cases.push(await execute('H_owner_a_last_night', tokenA, night));
    cases.push(await execute('I_owner_a_unknown', tokenA, unknown));
    cases.push(await execute('J_owner_id_injected', tokenA, { ...sameName, owner_id: '00000000-0000-4000-8000-0000000000b2' }));
    cases.push(await execute('J_scope_injected', tokenA, { ...sameName, contact_ids: [999], owner_scope: { contact_ids: [999] } }));
    const invalid = await execute('C_invalid_jwt', 'invalid-jwt', sameName); cases.push(invalid);
    if (noScopeEmail && noScopePassword) {
      const noScopeToken = await signIn(noScopeEmail, noScopePassword, publishableKey);
      cases.push(await execute('K_valid_no_scope', noScopeToken, sameName));
    }
    // Las lecturas de latencia no tienen efectos y se lanzan en paralelo para
    // no dejar la consola aparentemente bloqueada varios minutos en Windows.
    const latency = await Promise.all(Array.from({ length: 20 }, (_, index) => execute(`latency_phone_${index + 1}`, tokenA, phoneA)));
    const byLabel = Object.fromEntries(cases.map(item => [item.label, item]));
    assert(byLabel.A_owner_a_same_name.status === 200 && byLabel.A_owner_a_same_name.candidate_count >= 1, 'owner_a_missing');
    assert(byLabel.B_owner_b_same_name.status === 200 && byLabel.B_owner_b_same_name.candidate_count >= 1, 'owner_b_missing');
    assert(JSON.stringify(byLabel.A_owner_a_same_name.candidate_ids) !== JSON.stringify(byLabel.B_owner_b_same_name.candidate_ids), 'owners_crossed');
    assert(byLabel.C_owner_b_phone_of_a.status === 200 && byLabel.C_owner_b_phone_of_a.candidate_count === 0, 'phone_crossed');
    assert(byLabel.I_owner_a_unknown.status === 200 && byLabel.I_owner_a_unknown.candidate_count === 0, 'unknown_invented');
    assert(byLabel.J_owner_id_injected.status === 400 && byLabel.J_scope_injected.status === 400, 'client_scope_accepted');
    assert(byLabel.C_invalid_jwt.status === 401, 'invalid_jwt_not_rejected');
    assert([...cases, ...latency].filter(item => item.status === 200).every(item => item.execute === false), 'execute_not_false');
    const evidence = { phase: 'owner_references_preview_e2e', result: 'PASS', preview: PREVIEW, allowed_hosts: [new URL(PREVIEW).hostname, new URL(SUPABASE).hostname], requests: cases, latency_phone_exact: stats(latency), performance_baseline: profile(latency), execute_contract: { successful_responses_execute_false: true }, generated_at: new Date().toISOString(), notes: { tokens_persisted: false, passwords_persisted: false, server_trace_reconstruction: 'requires separate service-role metadata read; not performed by this runner' } };
    await writeFile(OUT, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({ phase: 'owner_references_preview_e2e', result: evidence.result, evidence: path.basename(OUT), latency_phone_p95_ms: evidence.latency_phone_exact.p95_ms }) + '\n');
  } catch (error) {
    const evidence = { phase: 'owner_references_preview_e2e', result: 'FAIL', stage: 'core_assertion_or_request', preview: PREVIEW, allowed_hosts: [new URL(PREVIEW).hostname, new URL(SUPABASE).hostname], error: String(error?.message || 'unknown').slice(0, 100), requests: cases, generated_at: new Date().toISOString(), notes: { tokens_persisted: false, passwords_persisted: false } };
    await writeFile(OUT, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, stage: evidence.stage, evidence: path.basename(OUT), error: evidence.error }) + '\n');
    process.exitCode = 1;
  } finally {
    for (const key of ['F3REF_SUPABASE_PUBLISHABLE_KEY','F3REF_OWNER_A_EMAIL','F3REF_OWNER_A_PASSWORD','F3REF_OWNER_B_EMAIL','F3REF_OWNER_B_PASSWORD','F3REF_NO_SCOPE_EMAIL','F3REF_NO_SCOPE_PASSWORD']) delete process.env[key];
  }
}

main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'owner_references_preview_e2e', result: 'FAIL', error: String(error?.message || 'unknown').replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 100) }) + '\n'); process.exitCode = 1; });
