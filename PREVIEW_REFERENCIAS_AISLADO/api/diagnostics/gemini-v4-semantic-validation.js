'use strict';

// Ruta diagnóstica temporal. Sólo admite un fixture estático; no acepta texto,
// estado conversacional ni identificadores comerciales desde HTTP.
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { decideGeminiV4ValidationRequest } = require('../../lib/preview-gemini-v4-validation-policy');
const { fixtureById } = require('../../lib/yarbi-v4-semantic-fixtures');
const { runGeminiV4Probe } = require('../../lib/yarbi-gemini-v4-probe');
const { strictNormalizeProposed, hardenProposed } = require('../../lib/yarbi-understanding-polarity-proposal');
const { adaptV4ToV1 } = require('../../lib/yarbi-v4-v1-adapter-proposal');
const { normalizeUnderstanding } = require('../../lib/yarbi-owner-understanding');
const { hardenUnderstanding } = require('../../lib/yarbi-semantic-hardening');
const { createTemporalDiagnostic, providerUnavailableTemporalDiagnostic, sanitizeTemporalDiagnostic } = require('../../lib/yarbi-v4-temporal-diagnostics');
const { eventIdFor, operationIdFromReference, recordTrace, recordTerminalTrace, traceVersion } = require('../../lib/yarbi-trace');

function nowIso() { return new Date().toISOString(); }
function elapsed(started) { return Math.max(0, Math.round(performance.now() - started)); }
function safeCode(value) { return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function response(res, status, body) { return res.status(status).json(body); }
function includesValue(items, value) { const expected = normalized(value); return items.some(item => normalized(item?.value || item) === expected); }
function constraintValues(value) { return Object.values(object(value)).map(item => item?.value).filter(Boolean); }

function evaluateSemantic({ fixture, hardened, adapted, v3 }) {
  const expectations = fixture.expect || {};
  const positive = constraintValues(hardened?.plan?.query_constraints);
  const negated = (hardened?.discarded_mentions || []).map(item => item?.value).filter(Boolean);
  const mustPositive = Array.isArray(expectations.positive) ? expectations.positive.every(value => includesValue(positive, value)) : true;
  const mustNegated = Array.isArray(expectations.negated) ? expectations.negated.every(value => includesValue(negated, value)) : true;
  const noPositive = Array.isArray(expectations.no_positive) ? expectations.no_positive.every(value => !includesValue(positive, value)) : true;
  const correction = expectations.correction ? hardened?.control?.correction === expectations.correction : true;
  const clarification = typeof expectations.clarification === 'boolean' ? hardened?.plan?.requires_clarification === expectations.clarification : true;
  const negatedValues = new Set(negated.map(normalized));
  const noNegatedAsConstraint = positive.every(value => !negatedValues.has(normalized(value)));
  const noAutoSelection = hardened?.plan?.may_auto_select === false && adapted?.preservation?.may_auto_select !== true;
  const contradictionBlocked = !Array.isArray(hardened?.contradictions) || !hardened.contradictions.some(item => item.status === 'unresolved' && hardened.plan?.requires_clarification !== true);
  const safeAbstention = hardened?.plan?.requires_clarification === true && adapted?.ok === false;
  const actionablePipeline = hardened?.plan?.requires_clarification === false && adapted?.ok === true && v3?.schema === 'yarbi.owner-understanding.v3';
  const pipelineExpected = hardened?.plan?.requires_clarification ? safeAbstention : actionablePipeline;
  const assertions = { must_positive: mustPositive, must_negated: mustNegated, no_forbidden_positive: noPositive, correction_expected: correction, clarification_expected: clarification, negated_never_positive_constraint: noNegatedAsConstraint, may_auto_select_false: noAutoSelection, unresolved_contradiction_blocked: contradictionBlocked, pipeline_expected: pipelineExpected, resolver_not_invoked: true, commercial_actions_not_executed: true };
  const critical = !noNegatedAsConstraint || !noAutoSelection || !contradictionBlocked;
  return { semantic_pass: Object.values(assertions).every(value => value === true), critical_security_failure: critical, assertions, safe_outcome: safeAbstention ? 'abstained' : actionablePipeline ? 'adapted_v3' : 'pipeline_rejected' };
}

function inertTemporalDiagnostic() {
  const noOp = () => {};
  return { observeV4Normalize: noOp, observeV4Hardener: noOp, observeAdapter: noOp, observeV1: noOp, observeV3: noOp, observeEvaluation: noOp, finish: () => null };
}

function runLocalPipeline(raw, fixture) {
  let temporal = inertTemporalDiagnostic();
  try { temporal = createTemporalDiagnostic(raw); } catch (_) { temporal = inertTemporalDiagnostic(); }
  const timing = {}; let instrumentationMs = 0;
  const observe = (method, ...args) => { const started = performance.now(); temporal[method](...args); instrumentationMs += elapsed(started); };
  let started = performance.now();
  const strict = strictNormalizeProposed(raw); timing.strict_normalize_ms = elapsed(started);
  observe('observeV4Normalize', strict);
  if (!strict.ok) { timing.temporal_instrumentation_ms = instrumentationMs; return { ok: false, stage: 'strict_normalize', code: strict.code, timing, semantic: null, temporal_diagnostic: temporal.finish() }; }
  started = performance.now(); const hardened = hardenProposed({ understanding: strict.value, utterance: fixture.utterance, state: fixture.state }); timing.v4_hardener_ms = elapsed(started);
  observe('observeV4Hardener', hardened);
  if (!hardened.ok) { timing.temporal_instrumentation_ms = instrumentationMs; return { ok: false, stage: 'v4_hardener', code: hardened.code, timing, semantic: null, temporal_diagnostic: temporal.finish() }; }
  started = performance.now(); const adapted = adaptV4ToV1(hardened.value); timing.v4_v1_adapter_ms = elapsed(started);
  observe('observeAdapter', adapted, hardened);
  let normalizedV1 = null; let v3 = null;
  if (adapted.ok) {
    started = performance.now(); normalizedV1 = normalizeUnderstanding(adapted.value); timing.v1_normalize_ms = elapsed(started);
    observe('observeV1', normalizedV1, adapted);
    if (normalizedV1.ok) { started = performance.now(); v3 = hardenUnderstanding({ understanding: normalizedV1.value, utterance: fixture.utterance, state: fixture.state }); timing.v3_hardener_ms = elapsed(started); observe('observeV3', v3, normalizedV1); }
    else observe('observeV3', null, normalizedV1);
  }
  else { observe('observeV1', null, adapted); observe('observeV3', null, null); }
  const semantic = evaluateSemantic({ fixture, hardened: hardened.value, adapted, v3 });
  observe('observeEvaluation', semantic); timing.temporal_instrumentation_ms = instrumentationMs;
  const stage = semantic.semantic_pass ? 'completed' : 'semantic_assertions';
  return { ok: semantic.semantic_pass, stage, code: semantic.semantic_pass ? null : 'v4_semantic_assertions_failed', timing, semantic, temporal_diagnostic: temporal.finish() };
}

function traceEvent({ operationId, fixture, stage, outcome, startedAt, config, counts = {}, errorCode = null, providerDiagnostic = null, temporalDiagnostic = null }) {
  const diagnostic = sanitizeTemporalDiagnostic(temporalDiagnostic);
  return { operation_id: operationId, event_id: eventIdFor(operationId, stage, `${fixture.id}:${stage}`, config.traceSecret), operation_type: 'gemini_v4_semantic_validation', stage, outcome, started_at: startedAt, ended_at: nowIso(), component: 'preview_diagnostic', component_version: traceVersion(), counts, ...(errorCode ? { error_code: errorCode } : {}), ...(providerDiagnostic ? { provider_diagnostic: providerDiagnostic } : {}), ...(diagnostic ? { temporal_diagnostic: diagnostic } : {}) };
}
async function closeTrace({ config, operationId, fixture, startedAt, outcome, stage, counts, errorCode, providerDiagnostic, temporalDiagnostic, recordTerminal }) {
  try { return await recordTerminal({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: config.traceSecret, event: traceEvent({ operationId, fixture, stage, outcome, startedAt, config, counts, errorCode, providerDiagnostic, temporalDiagnostic }), closeEventKey: `${fixture.id}:operation_closed:${stage}` }); }
  catch (_) { return { ok: false, reason: 'trace_terminal_failed' }; }
}
function safePublic({ fixture, operationId, probe, pipeline, temporalDiagnostic, trace, totalMs, status, error }) {
  const publicPipeline = pipeline ? {
    status: pipeline.ok ? 'passed' : 'failed', stage: pipeline.stage, code: pipeline.code || null, timings_ms: pipeline.timing || {},
    semantic: pipeline.semantic ? { pass: pipeline.semantic.semantic_pass === true, critical_security_failure: pipeline.semantic.critical_security_failure === true, safe_outcome: pipeline.semantic.safe_outcome, assertions: pipeline.semantic.assertions } : null,
    temporal_diagnostic: sanitizeTemporalDiagnostic(pipeline.temporal_diagnostic)
  } : null;
  return { ok: status === 200, fixture_id: fixture.id, fixture_group: fixture.group, fixture_family: fixture.family, execute: false, commercial_actions_executed: false, resolver_invoked: false, request_count: 1, automatic_retries: 0, operation_id: operationId, model: probe?.model || null, schema_sha256: probe?.schema_sha256 || null, schema_bytes: Number.isFinite(Number(probe?.schema_bytes)) ? Number(probe.schema_bytes) : null, provider_http_status: Number.isInteger(Number(probe?.provider_http_status)) ? Number(probe.provider_http_status) : null, provider_diagnostic: probe?.provider_diagnostic || null, gemini_ms: Number.isFinite(Number(probe?.provider_ms)) ? Number(probe.provider_ms) : null, server_total_ms: totalMs, pipeline: publicPipeline, temporal_diagnostic: sanitizeTemporalDiagnostic(temporalDiagnostic || pipeline?.temporal_diagnostic), trace_closed: trace?.ok === true, error: error || null, allowed_egress: ['isolated_supabase_auth_and_ledger', 'gemini_generate_content'] };
}

function createGeminiV4SemanticValidationHandler({ authenticate = authenticatedOwnerIdentity, runProbe = runGeminiV4Probe, startTrace = recordTrace, terminalTrace = recordTerminalTrace } = {}) {
  return async function geminiV4SemanticValidationHandler(req, res) {
    const totalStarted = performance.now(); const decision = decideGeminiV4ValidationRequest(req, process.env);
    if (!decision.allow) return response(res, decision.status, { ok: false, error: decision.code, execute: false });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
    const fixture = Object.keys(body).length === 1 ? fixtureById(body.fixture_id) : null;
    if (!fixture) return response(res, 400, { ok: false, error: 'gemini_v4_validation_fixture_forbidden', execute: false });
    const authStarted = performance.now(); const authenticated = await authenticate(req, decision.state.config); const authMs = elapsed(authStarted);
    if (!authenticated.ok) return response(res, authenticated.status, { ok: false, error: authenticated.code, execute: false });
    if (authenticated.user?.id !== decision.state.config.ownerId) return response(res, 403, { ok: false, error: 'gemini_v4_validation_owner_forbidden', execute: false });
    const config = decision.state.config; const operationId = operationIdFromReference('gemini_v4_semantic_validation', fixture.id, config.traceSecret); const startedAt = nowIso();
    let started;
    try { started = await startTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: config.traceSecret, event: traceEvent({ operationId, fixture, stage: 'operation_started', outcome: 'started', startedAt, config, counts: { request_count: 0 } }) }); }
    catch (_) { return response(res, 503, { ok: false, error: 'gemini_v4_validation_trace_start_failed', execute: false }); }
    if (!started?.ok) return response(res, 503, { ok: false, error: 'gemini_v4_validation_trace_start_unrecorded', execute: false });
    if (started.duplicate === true) return response(res, 409, { ok: false, error: 'gemini_v4_validation_already_dispatched', execute: false, fixture_id: fixture.id, operation_id: operationId });
    const probe = await runProbe({ apiKey: config.gemini.apiKey, model: config.gemini.model, timeoutMs: config.gemini.timeoutMs, utterance: fixture.utterance, state: fixture.state });
    const pipeline = probe.accepted ? runLocalPipeline(probe.raw, fixture) : null;
    const temporalDiagnostic = pipeline?.temporal_diagnostic || providerUnavailableTemporalDiagnostic();
    const successful = probe.accepted === true && pipeline?.ok === true;
    const critical = pipeline?.semantic?.critical_security_failure === true;
    const stage = successful ? 'gemini_v4_semantic_completed' : critical ? 'gemini_v4_semantic_critical_blocked' : probe.accepted ? `gemini_v4_${pipeline?.stage || 'pipeline_failed'}` : 'gemini_v4_provider_failed';
    const errorCode = successful ? null : safeCode(probe.error_code || pipeline?.code || 'gemini_v4_semantic_validation_failed');
    const trace = await closeTrace({ config, operationId, fixture, startedAt, outcome: successful ? 'completed' : 'failed', stage, counts: { request_count: 1, authentication_ms: authMs }, errorCode, providerDiagnostic: probe.provider_diagnostic, temporalDiagnostic, recordTerminal: terminalTrace });
    const totalMs = elapsed(totalStarted); const status = successful && trace?.ok ? 200 : successful ? 503 : critical ? 409 : 422;
    return response(res, status, safePublic({ fixture, operationId, probe, pipeline, temporalDiagnostic, trace, totalMs, status, error: successful && !trace?.ok ? 'gemini_v4_validation_trace_close_failed' : errorCode }));
  };
}

module.exports = createGeminiV4SemanticValidationHandler();
module.exports.createGeminiV4SemanticValidationHandler = createGeminiV4SemanticValidationHandler;
module.exports.runLocalPipeline = runLocalPipeline;
