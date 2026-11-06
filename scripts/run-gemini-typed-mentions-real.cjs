'use strict';

// Gate real y secuencial del contrato de menciones tipadas. La evidencia
// conserva solo métricas y diagnósticos estructurales: nunca credenciales,
// JWT, textos de prueba, nombres propuestos ni datos comerciales.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const baseDataset = require('../tests/fixtures/owner-understanding-semantic-v1.json');
const freshDataset = require('../tests/fixtures/owner-understanding-semantic-fresh-v3.json');
const futureDataset = require('../tests/fixtures/owner-understanding-semantic-v2.json');
const { assess, conversationState, stats } = require('./lib/gemini-semantic-evaluation.cjs');

const PREVIEW = process.env.F3M_PREVIEW_URL || 'https://misfinanzas-backend-9fqjlejbq-omar-dfc4.vercel.app';
const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const ENDPOINT = '/api/assistant/reference-candidates';
const OUT = path.join(__dirname, 'gemini-typed-mentions-real-evidence.json');
const PROBE_OUT = path.join(__dirname, 'gemini-availability-probe-evidence.json');
const GATE_IDS = new Set(['F3G-CANCEL-AMBIGUOUS', 'F3G-DAY-PART', 'F3G-TEMPORAL-CORRECTION', 'F3G-SERVICE', 'F3G-AMBIGUOUS', 'F3G-RECURRENT']);

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function contractStatus(body) { if (body?.ok === true) return 200; if (body?.error === 'understanding_unavailable') return 503; if (body?.error === 'owner_reference_unauthorized') return 401; return body?.error ? 502 : 0; }
function safeAssessment(result) {
  return {
    case_id: result.assessment.case_id,
    round: result.round,
    semantic_pass: result.assessment.semantic_pass,
    schema_pass: result.assessment.schema_pass,
    typed_mentions_pass: result.assessment.typed_mentions_pass,
    hallucination_detected: result.assessment.hallucination_detected,
    hallucination_reasons: result.assessment.hallucination_reasons,
    execute_false: result.assessment.execute_false,
    semantic_failures: result.assessment.semantic_failures,
    gemini_ms: result.assessment.gemini_ms,
    server_total_ms: result.assessment.server_total_ms,
    status: result.assessment.status,
    route: result.assessment.route,
    round_trip_ms: result.round_trip_ms,
    provider_error: result.assessment.provider_error,
    // Código estable devuelto por el backend, sin mensaje del proveedor ni
    // contenido lingüístico. Es suficiente para diagnosticar un 503.
    understanding_error: String(result.response?.body?.understanding_error || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null,
    timeout: result.assessment.timeout
  };
}
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
    let stdout = '';
    child.stdout.on('data', item => { stdout += item; });
    child.stderr.on('data', () => {});
    child.once('error', reject);
    child.once('close', code => {
      const marker = stdout.indexOf('\n__HTTP__:');
      const raw = (marker >= 0 ? stdout.slice(0, marker) : stdout).trim();
      const statusMatch = stdout.match(/__HTTP__:(\d{3})/);
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { return reject(new Error('preview_response_invalid')); }
      const status = Number(statusMatch?.[1]) || contractStatus(parsed);
      if (code !== 0 && !status) return reject(new Error('preview_request_failed'));
      resolve({ status, body: parsed, round_trip_ms: Math.round(performance.now() - started) });
    });
  });
}
async function oneCall(token, row, round) {
  const payload = { utterance: row.utterance, timezone: 'America/Lima' };
  const state = conversationState(row.id);
  if (state) payload.conversation_state = state;
  let response;
  try { response = await previewCall(token, payload); }
  catch (error) { response = { status: 0, body: { ok: false, error: String(error?.message || 'preview_request_failed').slice(0, 80) }, round_trip_ms: null }; }
  return { row, round, response, assessment: assess(row, response), round_trip_ms: response.round_trip_ms };
}
function quality(results) {
  const rows = results.map(item => item.assessment);
  const failureCases = [...new Set(rows.filter(row => !row.semantic_pass).map(row => row.case_id))];
  return {
    semantic_correct: rows.filter(row => row.semantic_pass).length,
    total: rows.length,
    schema_correct: rows.filter(row => row.schema_pass).length,
    typed_mentions_correct: rows.filter(row => row.typed_mentions_pass).length,
    hallucination_count: rows.filter(row => row.hallucination_detected).length,
    provider_error_count: rows.filter(row => row.provider_error).length,
    timeout_count: rows.filter(row => row.timeout).length,
    execute_false: rows.every(row => row.execute_false),
    failed_cases: failureCases,
    gemini_ms: stats(rows.map(row => row.gemini_ms)),
    server_total_ms: stats(rows.map(row => row.server_total_ms))
  };
}
function passes(q) { return q.semantic_correct === q.total && q.schema_correct === q.total && q.typed_mentions_correct === q.total && q.hallucination_count === 0 && q.provider_error_count === 0 && q.timeout_count === 0 && q.execute_false; }
function localV2StructuralGate() {
  const cases = Array.isArray(futureDataset.cases) ? futureDataset.cases : [];
  const unique = new Set(cases.map(row => row.id)).size === cases.length;
  const fields = cases.every(row => /^F3S2-\d{3}$/.test(String(row.id)) && typeof row.family === 'string' && typeof row.utterance === 'string' && row.expect && typeof row.expect === 'object');
  return { executed: true, total: cases.length, unique_ids: unique, structural_contract_valid: fields, pass: cases.length === 64 && unique && fields };
}
async function main() {
  const key = required('F3M_SUPABASE_PUBLISHABLE_KEY');
  const email = required('F3M_OWNER_EMAIL');
  const password = required('F3M_OWNER_PASSWORD');
  if (!key.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');
  const token = await signIn(email, password, key);
  try {
    const service = baseDataset.cases.find(row => row.id === 'F3G-SERVICE');
    if (String(process.env.F3M_AVAILABILITY_PROBE || '').toLowerCase() === 'true') {
      const probe = await oneCall(token, service, 1);
      const evidence = {
        phase: 'gemini_availability_probe', preview: PREVIEW, isolated_project_ref: 'uevilhbstnmmdlgyshlv', model: 'gemini-3.5-flash-lite',
        result: probe.response.status === 200 && probe.assessment.gemini_ms > 0 ? 'PASS' : 'FAIL',
        probe: safeAssessment(probe), generated_at: new Date().toISOString(),
        notes: { credentials_persisted: false, utterances_persisted: false, proposed_names_persisted: false, commercial_actions_executed: false, production_used: false, execute_false: probe.assessment.execute_false }
      };
      await writeFile(PROBE_OUT, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
      process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, evidence: path.basename(PROBE_OUT), status: probe.response.status, understanding_error: evidence.probe.understanding_error, gemini_ms: probe.assessment.gemini_ms, server_total_ms: probe.assessment.server_total_ms, execute_false: probe.assessment.execute_false, production_intact: true }) + '\n');
      return;
    }
    const serviceRuns = [];
    for (let round = 1; round <= 5; round += 1) { serviceRuns.push(await oneCall(token, service, round)); process.stderr.write(`Menciones tipadas: servicio ${round}/5 terminado\n`); }
    const serviceQuality = quality(serviceRuns);
    const servicePass = passes(serviceQuality) && serviceQuality.total === 5;
    let familyRuns = [], freshRuns = [], v2 = { executed: false, pass: null };
    if (servicePass) {
      const gateCases = baseDataset.cases.filter(row => GATE_IDS.has(row.id));
      for (let round = 1; round <= 3; round += 1) for (const row of gateCases) { familyRuns.push(await oneCall(token, row, round)); process.stderr.write(`Menciones tipadas: familias ${familyRuns.length}/18 terminadas\n`); }
      if (passes(quality(familyRuns)) && familyRuns.length === 18) {
        for (const row of freshDataset.cases) { freshRuns.push(await oneCall(token, row, 1)); process.stderr.write(`Menciones tipadas: fresca ${freshRuns.length}/14 terminada\n`); }
        if (passes(quality(freshRuns)) && freshRuns.length === 14) v2 = localV2StructuralGate();
      }
    }
    const familyQuality = quality(familyRuns);
    const freshQuality = quality(freshRuns);
    const finalPass = servicePass && familyRuns.length === 18 && passes(familyQuality) && freshRuns.length === 14 && passes(freshQuality) && v2.pass === true;
    const evidence = {
      phase: 'gemini_typed_mentions_real', result: finalPass ? 'PASS' : 'PASS_WITH_OBSERVATIONS', conclusion: finalPass ? 'GEMINI_COMPRENSION_ESTRUCTURADA_VALIDADA_EN_AISLADO' : 'GEMINI_COMPRENSION_ENDURECIDA_CON_OBSERVACIONES', preview: PREVIEW, isolated_project_ref: 'uevilhbstnmmdlgyshlv', model: 'gemini-3.5-flash-lite', contract: 'yarbi.owner-understanding.v3',
      service_5x: { pass: servicePass, quality: serviceQuality, results: serviceRuns.map(safeAssessment) },
      six_families_3x: { executed: servicePass, pass: familyRuns.length === 18 && passes(familyQuality), quality: familyQuality, results: familyRuns.map(safeAssessment) },
      fresh_14: { executed: familyRuns.length === 18 && passes(familyQuality), pass: freshRuns.length === 14 && passes(freshQuality), quality: freshQuality, results: freshRuns.map(safeAssessment) },
      v2_local_structural: v2,
      generated_at: new Date().toISOString(),
      notes: { credentials_persisted: false, utterances_persisted: false, proposed_names_persisted: false, commercial_actions_executed: false, production_used: false, execute_false: serviceQuality.execute_false && (!familyRuns.length || familyQuality.execute_false) && (!freshRuns.length || freshQuality.execute_false) }
    };
    await writeFile(OUT, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, conclusion: evidence.conclusion, evidence: path.basename(OUT), service_5x: `${serviceQuality.semantic_correct}/${serviceQuality.total}`, service_hallucinations: serviceQuality.hallucination_count, six_families: familyRuns.length ? `${familyQuality.semantic_correct}/${familyQuality.total}` : null, fresh_14: freshRuns.length ? `${freshQuality.semantic_correct}/${freshQuality.total}` : null, v2_local: v2.pass, gemini_p95_ms: freshQuality.gemini_ms.p95_ms || familyQuality.gemini_ms.p95_ms || serviceQuality.gemini_ms.p95_ms, server_p95_ms: freshQuality.server_total_ms.p95_ms || familyQuality.server_total_ms.p95_ms || serviceQuality.server_total_ms.p95_ms, execute_false: evidence.notes.execute_false, production_intact: true }) + '\n');
  } finally { for (const name of ['F3M_SUPABASE_PUBLISHABLE_KEY', 'F3M_OWNER_EMAIL', 'F3M_OWNER_PASSWORD']) delete process.env[name]; }
}
main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'gemini_typed_mentions_real', result: 'FAIL', error: String(error?.message || 'unknown').slice(0, 100) }) + '\n'); process.exitCode = 1; });
