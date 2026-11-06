'use strict';

// Sonda de una sola ejecución, temporal y aislada. No se importa desde rutas
// comerciales y no recibe frase, estado ni identificadores desde el cliente.
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { decideGeminiV4ProbeRequest } = require('../../lib/preview-gemini-v4-probe-policy');
const { runGeminiV4Probe } = require('../../lib/yarbi-gemini-v4-probe');
const { strictNormalizeProposed, hardenProposed } = require('../../lib/yarbi-understanding-polarity-proposal');
const { adaptV4ToV1 } = require('../../lib/yarbi-v4-v1-adapter-proposal');
const { normalizeUnderstanding } = require('../../lib/yarbi-owner-understanding');
const { hardenUnderstanding } = require('../../lib/yarbi-semantic-hardening');
const { eventIdFor, operationIdFromReference, recordTrace, recordTerminalTrace, traceVersion } = require('../../lib/yarbi-trace');

const FIXTURE_ID = 'F3V4-CORRECTION';
const FIXTURE_UTTERANCE = 'No era Carlos, era Carla';
const FIXTURE_STATE = Object.freeze({ active_constraints: { name: { value: 'Carlos' } } });

function nowIso() { return new Date().toISOString(); }
function safeCode(value) { return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function elapsed(started) { return Math.max(0, Math.round(performance.now() - started)); }

function response(res, status, body) { return res.status(status).json(body); }

function runLocalPipeline(raw) {
  const timing = {};
  let started = performance.now();
  const strict = strictNormalizeProposed(raw);
  timing.strict_normalize_ms = elapsed(started);
  if (!strict.ok) return { ok: false, stage: 'strict_normalize', code: strict.code, timing };
  started = performance.now();
  const hardenedV4 = hardenProposed({ understanding: strict.value, utterance: FIXTURE_UTTERANCE, state: FIXTURE_STATE });
  timing.v4_hardener_ms = elapsed(started);
  if (!hardenedV4.ok) return { ok: false, stage: 'v4_hardener', code: hardenedV4.code, timing };
  started = performance.now();
  const adapted = adaptV4ToV1(hardenedV4.value);
  timing.v4_v1_adapter_ms = elapsed(started);
  if (!adapted.ok) return { ok: false, stage: 'v4_v1_adapter', code: adapted.code, timing };
  started = performance.now();
  const normalizedV1 = normalizeUnderstanding(adapted.value);
  timing.v1_normalize_ms = elapsed(started);
  if (!normalizedV1.ok) return { ok: false, stage: 'v1_normalize', code: normalizedV1.code, timing };
  started = performance.now();
  const hardenedV3 = hardenUnderstanding({ understanding: normalizedV1.value, utterance: FIXTURE_UTTERANCE, state: FIXTURE_STATE });
  timing.v3_hardener_ms = elapsed(started);
  const assertions = {
    discarded_name_never_positive: !Object.values(adapted.value.constraints || {}).some(item => normalized(item?.value) === 'carlos'),
    replacement_name_positive: normalized(adapted.value.constraints?.name?.value) === 'carla' && normalized(hardenedV3.constraints?.name?.value) === 'carla',
    correction_replace_previous: hardenedV4.value.control?.correction === 'replace_previous',
    may_auto_select_false: hardenedV4.value.plan?.may_auto_select === false && adapted.preservation?.may_auto_select === false,
    no_sql_exclusions: Array.isArray(hardenedV4.value.plan?.excluded_constraints) && hardenedV4.value.plan.excluded_constraints.length === 0,
    verified_provenance: hardenedV4.value.mentions?.every(item => item.provenance?.verified === true)
  };
  const assertionsPass = Object.values(assertions).every(Boolean);
  return { ok: assertionsPass, stage: assertionsPass ? 'completed' : 'semantic_assertions', code: assertionsPass ? null : 'v4_semantic_assertions_failed', timing, assertions };
}

function event({ operationId, stage, outcome, startedAt, config, counts = {}, errorCode = null, providerDiagnostic = null }) {
  const secret = config.traceSecret;
  return {
    operation_id: operationId,
    event_id: eventIdFor(operationId, stage, `${FIXTURE_ID}:${stage}`, secret),
    operation_type: 'gemini_v4_diagnostic_probe',
    stage,
    outcome,
    started_at: startedAt,
    ended_at: nowIso(),
    component: 'preview_diagnostic',
    component_version: traceVersion(),
    counts,
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(providerDiagnostic ? { provider_diagnostic: providerDiagnostic } : {})
  };
}

async function persistTerminal({ config, operationId, startedAt, outcome, stage, counts, errorCode, providerDiagnostic, recordTerminal }) {
  try {
    return await recordTerminal({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
      traceSecret: config.traceSecret,
      event: event({ operationId, stage, outcome, startedAt, config, counts, errorCode, providerDiagnostic }),
      closeEventKey: `${FIXTURE_ID}:operation_closed:${stage}`
    });
  } catch (_) { return { ok: false, reason: 'trace_terminal_failed' }; }
}

function publicResult({ ok, status, operationId, probe, pipeline, trace, totalMs, error = null }) {
  return {
    ok,
    fixture_id: FIXTURE_ID,
    route: 'GEMINI_V4_FIRST_PROBE',
    execute: false,
    commercial_actions_executed: false,
    operation_id: operationId,
    request_count: 1,
    automatic_retries: 0,
    model: probe?.model || null,
    schema_sha256: probe?.schema_sha256 || null,
    schema_bytes: Number.isFinite(Number(probe?.schema_bytes)) ? Number(probe.schema_bytes) : null,
    public_http_status: status,
    provider_http_status: probe?.provider_http_status || null,
    provider_diagnostic: probe?.provider_diagnostic || null,
    gemini_ms: Number.isFinite(Number(probe?.provider_ms)) ? Number(probe.provider_ms) : null,
    server_total_ms: totalMs,
    pipeline: pipeline ? { status: pipeline.ok ? 'passed' : 'failed', stage: pipeline.stage, code: pipeline.code || null, timings_ms: pipeline.timing || {}, assertions: pipeline.assertions || null } : null,
    trace_closed: trace?.ok === true,
    error: error || null,
    allowed_egress: ['isolated_supabase_auth_and_ledger', 'gemini_generate_content']
  };
}

function createGeminiV4FirstProbeHandler({ authenticate = authenticatedOwnerIdentity, runProbe = runGeminiV4Probe, startTrace = recordTrace, terminalTrace = recordTerminalTrace } = {}) {
  return async function geminiV4FirstProbeHandler(req, res) {
    const decision = decideGeminiV4ProbeRequest(req, process.env);
    if (!decision.allow) return response(res, decision.status, { ok: false, error: decision.code, execute: false });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
    if (Object.keys(body).length !== 1 || body.fixture_id !== FIXTURE_ID) return response(res, 400, { ok: false, error: 'gemini_v4_probe_fixture_forbidden', execute: false });
    const authenticated = await authenticate(req, decision.state.config);
    if (!authenticated.ok) return response(res, authenticated.status, { ok: false, error: authenticated.code, execute: false });
    if (authenticated.user?.id !== decision.state.config.ownerId) return response(res, 403, { ok: false, error: 'gemini_v4_probe_owner_forbidden', execute: false });

    const config = decision.state.config;
    // ID determinista para que el ledger funcione también como compuerta de
    // una sola ejecución: una segunda petición encuentra el mismo evento.
    const operationId = operationIdFromReference('gemini_v4_probe', FIXTURE_ID, config.traceSecret);
    const startedAt = nowIso(); const totalStarted = performance.now();
    let started;
    try {
      started = await startTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: config.traceSecret, event: event({ operationId, stage: 'operation_started', outcome: 'started', startedAt, config, counts: { request_count: 0 } }) });
    } catch (_) { return response(res, 503, { ok: false, error: 'gemini_v4_probe_trace_start_failed', execute: false }); }
    if (!started?.ok) return response(res, 503, { ok: false, error: 'gemini_v4_probe_trace_start_unrecorded', execute: false });
    // Un evento inicial duplicado detiene la petición antes de Gemini.
    if (started.duplicate === true) return response(res, 409, { ok: false, error: 'gemini_v4_probe_already_dispatched', execute: false, operation_id: operationId });
    const probe = await runProbe({ apiKey: config.gemini.apiKey, model: config.gemini.model, timeoutMs: config.gemini.timeoutMs, utterance: FIXTURE_UTTERANCE, state: FIXTURE_STATE });
    let pipeline = null;
    if (probe.accepted) pipeline = runLocalPipeline(probe.raw);
    const successful = probe.accepted === true && pipeline?.ok === true;
    const stage = successful ? 'gemini_v4_pipeline_completed' : (probe.accepted ? `gemini_v4_${pipeline?.stage || 'pipeline_failed'}` : 'gemini_v4_provider_failed');
    const errorCode = successful ? null : safeCode(probe.error_code || pipeline?.code || 'gemini_v4_probe_failed');
    const trace = await persistTerminal({ config, operationId, startedAt, outcome: successful ? 'completed' : 'failed', stage, counts: { request_count: 1, strict_normalize: pipeline?.stage !== 'strict_normalize' ? 1 : 0, v4_hardener: ['v4_v1_adapter', 'v1_normalize', 'completed', 'semantic_assertions'].includes(pipeline?.stage) ? 1 : 0, v4_v1_adapter: ['v1_normalize', 'completed', 'semantic_assertions'].includes(pipeline?.stage) ? 1 : 0 }, errorCode, providerDiagnostic: probe.provider_diagnostic, recordTerminal: terminalTrace });
    const totalMs = elapsed(totalStarted);
    const status = successful && trace?.ok ? 200 : successful ? 503 : 422;
    return response(res, status, publicResult({ ok: successful && trace?.ok, status, operationId, probe, pipeline, trace, totalMs, error: successful && !trace?.ok ? 'gemini_v4_probe_trace_close_failed' : errorCode }));
  };
}

module.exports = createGeminiV4FirstProbeHandler();
module.exports.createGeminiV4FirstProbeHandler = createGeminiV4FirstProbeHandler;
module.exports.FIXTURE_ID = FIXTURE_ID;
