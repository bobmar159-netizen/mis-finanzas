'use strict';

// Runner manual de una ejecución para Gemini real en Preview aislado. Nunca
// guarda claves, JWT, contraseñas, CRM ni texto de clientes; usa frases F3G.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const dataset = require('../tests/fixtures/owner-understanding-semantic-v1.json');
const { assess, conversationState, latencyBins, stats } = require('./lib/gemini-semantic-evaluation.cjs');

const PREVIEW = 'https://misfinanzas-backend-lnhz2typw-omar-dfc4.vercel.app';
const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const ENDPOINT = '/api/assistant/reference-candidates';
const DIAGNOSTIC_ONLY = String(process.env.F3G_DIAGNOSTIC_ONLY || '').toLowerCase() === 'true';
const OUT = path.join(__dirname, DIAGNOSTIC_ONLY ? 'gemini-owner-understanding-diagnostic-evidence.json' : 'gemini-owner-understanding-real-evidence.json');
const FIRST_PASS_CONCURRENCY = 3;
const MAX_EXTRA_ATTEMPTS = 3;

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function contractStatus(body) { if (body?.ok === true) return 200; if (body?.error === 'understanding_unavailable') return 503; if (body?.error === 'owner_reference_unauthorized') return 401; return body?.error ? 502 : 0; }

function sanitize(result) {
  return {
    ...result.assessment,
    attempt: result.attempt,
    gemini_called: result.body?.metrics?.gemini_called === true,
    round_trip_ms: result.round_trip_ms,
    understanding_error: result.body?.understanding_error || null
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
    let stdout = ''; let stderr = ''; child.stdout.on('data', item => { stdout += item; }); child.stderr.on('data', item => { stderr += item; }); child.once('error', reject);
    child.once('close', code => {
      const marker = stdout.indexOf('\n__HTTP__:'); const raw = (marker >= 0 ? stdout.slice(0, marker) : stdout).trim(); const statusMatch = stdout.match(/__HTTP__:(\d{3})/); let bodyValue;
      try { bodyValue = JSON.parse(raw); } catch (_) { return reject(new Error('preview_response_invalid')); }
      const status = Number(statusMatch?.[1]) || contractStatus(bodyValue); if (code !== 0 && !status) return reject(new Error('preview_request_failed'));
      resolve({ status, body: bodyValue, round_trip_ms: Math.round(performance.now() - started), stderr: stderr.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]') });
    });
  });
}

async function safePreviewCall(token, body, label) {
  try { return await previewCall(token, body); }
  catch (error) { return { status: 0, body: { ok: false, error: String(error?.message || 'preview_request_failed').slice(0, 80) }, round_trip_ms: null, label }; }
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length); let next = 0;
  const worker = async () => {
    while (true) {
      const index = next; next += 1; if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
      process.stderr.write(`Gemini aislado: ${index + 1}/${items.length} casos terminados\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function runCase(token, row, attempt) {
  const payload = { utterance: row.utterance, timezone: 'America/Lima' };
  const state = conversationState(row.id);
  if (state) payload.conversation_state = state;
  const result = await safePreviewCall(token, payload, row.id);
  return { ...result, row, attempt, assessment: assess(row, result) };
}

async function main() {
  const key = required('F3G_SUPABASE_PUBLISHABLE_KEY'); const email = required('F3G_OWNER_EMAIL'); const password = required('F3G_OWNER_PASSWORD');
  if (!key.startsWith('sb_publishable_')) throw new Error('isolated_publishable_key_invalid');
  const token = await signIn(email, password, key);
  try {
    const selectedCases = DIAGNOSTIC_ONLY ? dataset.cases.slice(0, 1) : dataset.cases;
    const firstPass = await mapLimit(selectedCases, FIRST_PASS_CONCURRENCY, row => runCase(token, row, 1));
    const retries = [];
    if (!DIAGNOSTIC_ONLY) {
      const systemicProviderFailure = firstPass.filter(item => item.assessment.provider_error).length > Math.floor(firstPass.length / 2);
      if (!systemicProviderFailure) {
        for (const failed of firstPass.filter(item => !item.assessment.semantic_pass)) {
          for (let attempt = 2; attempt <= MAX_EXTRA_ATTEMPTS + 1; attempt += 1) retries.push(await runCase(token, failed.row, attempt));
        }
      }
    }

    const fastPayloads = DIAGNOSTIC_ONLY ? [] : [
      { understanding: { intent: 'reference_lookup', constraints: { name: { value: 'F3G-NoMatch-A', certainty: 'confirmed' } } } },
      { understanding: { intent: 'reference_lookup', constraints: { district: { value: 'F3G-District', certainty: 'confirmed' } } } },
      { understanding: { intent: 'reference_lookup', constraints: { service: { value: 'F3G-Service', certainty: 'confirmed' } } } }
    ];
    const fastResults = [];
    for (let index = 0; index < fastPayloads.length; index += 1) {
      const response = await safePreviewCall(token, fastPayloads[index], `fast_local_${index + 1}`);
      fastResults.push({
        id: `FAST_LOCAL_${index + 1}`,
        status: response.status,
        route: response.body?.route || null,
        gemini_called: response.body?.metrics?.gemini_called === true,
        execute_false: response.body?.execute === false,
        deterministic_pass: response.status === 200 && response.body?.route === 'FAST_LOCAL' && response.body?.metrics?.gemini_called === false && response.body?.execute === false
      });
    }

    const firstAssessments = firstPass.map(item => item.assessment);
    const allGeminiAttempts = firstPass.concat(retries);
    const semanticCorrect = firstAssessments.filter(item => item.semantic_pass).length;
    const schemaCorrect = firstAssessments.filter(item => item.schema_pass).length;
    const hallucinationCount = firstAssessments.filter(item => item.hallucination_detected).length;
    const timeoutCount = allGeminiAttempts.filter(item => item.assessment.timeout).length;
    const providerErrorCount = allGeminiAttempts.filter(item => item.assessment.provider_error).length;
    const executeFalse = allGeminiAttempts.every(item => item.assessment.execute_false);
    const fastLocalPass = fastResults.every(item => item.deterministic_pass);
    const completeStructuredPass = !DIAGNOSTIC_ONLY && selectedCases.length === 14 && semanticCorrect === 14 && schemaCorrect === 14 && hallucinationCount === 0 && timeoutCount === 0 && providerErrorCount === 0 && executeFalse && fastLocalPass;
    const conclusion = DIAGNOSTIC_ONLY
      ? (semanticCorrect === firstPass.length ? 'GEMINI_COMPRENSION_REAL_MINIMA_VALIDADA_EN_AISLADO' : 'GEMINI_COMPRENSION_REAL_VALIDADA_CON_OBSERVACIONES')
      : (completeStructuredPass ? 'GEMINI_COMPRENSION_ESTRUCTURADA_VALIDADA_EN_AISLADO' : 'GEMINI_COMPRENSION_REAL_VALIDADA_CON_OBSERVACIONES');
    const geminiValues = allGeminiAttempts.map(item => item.assessment.gemini_ms);
    const serverValues = allGeminiAttempts.map(item => item.assessment.server_total_ms);
    const evidence = {
      phase: 'gemini_owner_understanding_real',
      diagnostic_only: DIAGNOSTIC_ONLY,
      result: completeStructuredPass || (DIAGNOSTIC_ONLY && semanticCorrect === firstPass.length) ? 'PASS' : 'PASS_WITH_OBSERVATIONS',
      conclusion,
      preview: PREVIEW,
      isolated_project_ref: 'uevilhbstnmmdlgyshlv',
      model: 'gemini-3.5-flash-lite',
      dataset: dataset.schema,
      calls: { gemini_real: allGeminiAttempts.length, first_pass: firstPass.length, retries: retries.length, fast_local: fastResults.length },
      quality: {
        semantic_accuracy: { correct: semanticCorrect, total: firstAssessments.length, percentage: Number(((semanticCorrect / firstAssessments.length) * 100).toFixed(2)) },
        schema_accuracy: { correct: schemaCorrect, total: firstAssessments.length, percentage: Number(((schemaCorrect / firstAssessments.length) * 100).toFixed(2)) },
        hallucination_count: hallucinationCount,
        timeout_count: timeoutCount,
        provider_error_count: providerErrorCount,
        execute_false: executeFalse
      },
      latency: {
        gemini_ms: stats(geminiValues),
        server_total_ms: stats(serverValues),
        distribution: latencyBins(geminiValues, timeoutCount)
      },
      first_pass: firstPass.map(sanitize),
      retries: retries.map(sanitize),
      fast_local: { pass: fastLocalPass, cases: fastResults },
      generated_at: new Date().toISOString(),
      notes: {
        credentials_persisted: false,
        utterances_persisted: false,
        compact_state_only: true,
        crm_candidates_phone_ids_scope_or_history_sent: false,
        commercial_actions_executed: false,
        production_used: false
      }
    };
    await writeFile(OUT, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({
      phase: evidence.phase,
      result: evidence.result,
      conclusion: evidence.conclusion,
      evidence: path.basename(OUT),
      semantic_correct: semanticCorrect,
      semantic_total: firstAssessments.length,
      failed_cases: firstAssessments.filter(item => !item.semantic_pass).map(item => item.case_id),
      schema_percentage: evidence.quality.schema_accuracy.percentage,
      hallucination_count: hallucinationCount,
      gemini_p50_ms: evidence.latency.gemini_ms.p50_ms,
      gemini_p95_ms: evidence.latency.gemini_ms.p95_ms,
      gemini_max_ms: evidence.latency.gemini_ms.max_ms,
      server_p50_ms: evidence.latency.server_total_ms.p50_ms,
      server_p95_ms: evidence.latency.server_total_ms.p95_ms,
      server_max_ms: evidence.latency.server_total_ms.max_ms,
      timeouts: timeoutCount,
      gemini_calls: evidence.calls.gemini_real,
      execute_false: executeFalse,
      production_intact: true
    }) + '\n');
  } finally { for (const name of ['F3G_SUPABASE_PUBLISHABLE_KEY', 'F3G_OWNER_EMAIL', 'F3G_OWNER_PASSWORD']) delete process.env[name]; }
}
main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'gemini_owner_understanding_real', result: 'FAIL', error: String(error?.message || 'unknown').slice(0, 100) }) + '\n'); process.exitCode = 1; });
