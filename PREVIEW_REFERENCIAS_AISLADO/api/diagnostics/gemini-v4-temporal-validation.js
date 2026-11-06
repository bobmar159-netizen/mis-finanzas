'use strict';

// Validación temporal aislada: sólo tres fixtures internos. Esta ruta no
// acepta frases, estado, IDs comerciales ni acciones desde HTTP.
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { decideGeminiV4TemporalRequest } = require('../../lib/preview-gemini-v4-temporal-policy');
const { fixtureById } = require('../../lib/yarbi-v4-temporal-preview-fixtures');
const { runGeminiV4Probe } = require('../../lib/yarbi-gemini-v4-probe');
const { runLocalPipeline } = require('./gemini-v4-semantic-validation');
const { providerUnavailableTemporalDiagnostic, sanitizeTemporalDiagnostic } = require('../../lib/yarbi-v4-temporal-diagnostics');
const { eventIdFor, operationIdFromReference, recordTrace, recordTerminalTrace, traceVersion } = require('../../lib/yarbi-trace');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function response(res, status, body) { return res.status(status).json(body); }
function nowIso() { return new Date().toISOString(); }
function elapsed(started) { return Math.max(0, Math.round(performance.now() - started)); }
function safeCode(value) { return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null; }
function authorizationInfo(request) {
  const raw = String(request?.headers?.authorization || request?.headers?.Authorization || '').trim();
  const match = /^Bearer\s+([^\s]+)$/i.exec(raw);
  return { present: raw.length > 0, format_valid: Boolean(match && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(match[1])) };
}
function authPublic({ authorization, authenticated, ownerMatches, totalMs }) {
  const category = !authorization.present ? 'header_missing' : !authenticated?.ok ? 'supabase_auth_rejected' : ownerMatches ? 'authorized' : 'owner_mismatch';
  return { ok: category === 'authorized', route_mode: 'temporal_auth_only', execute: false, gemini_invoked: false, fixture_consumed: false, pipeline_invoked: false, trace_invoked: false, commercial_actions_executed: false, resolver_invoked: false, authorization_header_present: authorization.present, authorization_format_valid: authorization.format_valid, supabase_auth_result: !authorization.present ? 'not_called' : authenticated?.ok ? 'valid' : 'rejected', owner_matches: ownerMatches === true, authorization_result: category, server_total_ms: totalMs, isolated_project_ref: 'uevilhbstnmmdlgyshlv' };
}
function traceEvent({ operationId, fixture, stage, outcome, startedAt, config, counts = {}, errorCode = null, providerDiagnostic = null, temporalDiagnostic = null }) {
  const diagnostic = sanitizeTemporalDiagnostic(temporalDiagnostic);
  return { operation_id: operationId, event_id: eventIdFor(operationId, stage, `${fixture.id}:${stage}`, config.traceSecret), operation_type: 'gemini_v4_temporal_validation', stage, outcome, started_at: startedAt, ended_at: nowIso(), component: 'preview_diagnostic', component_version: traceVersion(), counts, ...(errorCode ? { error_code: errorCode } : {}), ...(providerDiagnostic ? { provider_diagnostic: providerDiagnostic } : {}), ...(diagnostic ? { temporal_diagnostic: diagnostic } : {}) };
}
async function closeTrace({ config, operationId, fixture, startedAt, outcome, stage, counts, errorCode, providerDiagnostic, temporalDiagnostic, terminalTrace }) {
  try { return await terminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: config.traceSecret, event: traceEvent({ operationId, fixture, stage, outcome, startedAt, config, counts, errorCode, providerDiagnostic, temporalDiagnostic }), closeEventKey: `${fixture.id}:operation_closed:${stage}` }); }
  catch (_) { return { ok: false, reason: 'trace_terminal_failed' }; }
}
function publicResult({ fixture, operationId, probe, pipeline, trace, totalMs, status, error, temporalDiagnostic }) {
  const semantic = pipeline?.semantic || null; const diagnostic = sanitizeTemporalDiagnostic(temporalDiagnostic || pipeline?.temporal_diagnostic);
  return {
    ok: status === 200, fixture_id: fixture.id, fixture_family: fixture.family, execute: false, request_count: 1, automatic_retries: 0,
    commercial_actions_executed: false, resolver_invoked: false, operation_id: operationId, model: probe?.model || null,
    schema_sha256: probe?.schema_sha256 || null, schema_bytes: Number.isFinite(Number(probe?.schema_bytes)) ? Number(probe.schema_bytes) : null,
    provider_http_status: Number.isInteger(Number(probe?.provider_http_status)) ? Number(probe.provider_http_status) : null,
    gemini_ms: Number.isFinite(Number(probe?.provider_ms)) ? Number(probe.provider_ms) : null, server_total_ms: totalMs,
    pipeline: pipeline ? { status: pipeline.ok ? 'passed' : 'failed', stage: pipeline.stage, code: safeCode(pipeline.code), timings_ms: pipeline.timing || {}, temporal_diagnostic: diagnostic, semantic: semantic ? { pass: semantic.semantic_pass === true, critical_security_failure: semantic.critical_security_failure === true, safe_outcome: safeCode(semantic.safe_outcome), assertions: semantic.assertions } : null } : null,
    temporal_diagnostic: diagnostic, trace_closed: trace?.ok === true, error: safeCode(error), allowed_egress: ['isolated_supabase_auth_and_ledger', 'gemini_generate_content']
  };
}

function createGeminiV4TemporalValidationHandler({ authenticate = authenticatedOwnerIdentity, runProbe = runGeminiV4Probe, startTrace = recordTrace, terminalTrace = recordTerminalTrace } = {}) {
  return async function geminiV4TemporalValidationHandler(req, res) {
    const totalStarted = performance.now(); const decision = decideGeminiV4TemporalRequest(req, process.env);
    if (!decision.allow) return response(res, decision.status, { ok: false, error: decision.code, execute: false });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
    const authOnly = Object.keys(body).length === 1 && body.auth_only === true;
    const fixture = authOnly ? null : Object.keys(body).length === 1 ? fixtureById(body.fixture_id) : null;
    if (!authOnly && !fixture) return response(res, 400, { ok: false, error: 'gemini_v4_temporal_fixture_forbidden', execute: false });
    const authStarted = performance.now(); const authenticated = await authenticate(req, decision.state.config); const authMs = elapsed(authStarted);
    const ownerMatches = authenticated?.ok === true && authenticated.user?.id === decision.state.config.ownerId;
    if (authOnly) return response(res, !authenticated?.ok ? 401 : ownerMatches ? 200 : 403, authPublic({ authorization: authorizationInfo(req), authenticated, ownerMatches, totalMs: elapsed(totalStarted) }));
    if (!authenticated.ok) return response(res, authenticated.status, { ok: false, error: authenticated.code, execute: false });
    if (!ownerMatches) return response(res, 403, { ok: false, error: 'gemini_v4_temporal_owner_forbidden', execute: false });
    const config = decision.state.config; const operationId = operationIdFromReference('gemini_v4_temporal_validation', fixture.id, config.traceSecret); const startedAt = nowIso();
    let started;
    try { started = await startTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: config.traceSecret, event: traceEvent({ operationId, fixture, stage: 'operation_started', outcome: 'started', startedAt, config, counts: { request_count: 0 } }) }); }
    catch (_) { return response(res, 503, { ok: false, error: 'gemini_v4_temporal_trace_start_failed', execute: false }); }
    if (!started?.ok) return response(res, 503, { ok: false, error: 'gemini_v4_temporal_trace_start_unrecorded', execute: false });
    if (started.duplicate === true) return response(res, 409, { ok: false, error: 'gemini_v4_temporal_already_dispatched', execute: false, fixture_id: fixture.id, operation_id: operationId });
    const probe = await runProbe({ apiKey: config.gemini.apiKey, model: config.gemini.model, timeoutMs: config.gemini.timeoutMs, utterance: fixture.utterance, state: fixture.state, context: fixture.diagnostic_context });
    const pipeline = probe.accepted ? runLocalPipeline(probe.raw, fixture) : null;
    const temporalDiagnostic = pipeline?.temporal_diagnostic || providerUnavailableTemporalDiagnostic();
    const successful = probe.accepted === true && pipeline?.ok === true; const critical = pipeline?.semantic?.critical_security_failure === true;
    const stage = successful ? 'gemini_v4_temporal_completed' : critical ? 'gemini_v4_temporal_critical_blocked' : probe.accepted ? `gemini_v4_temporal_${pipeline?.stage || 'pipeline_failed'}` : 'gemini_v4_temporal_provider_failed';
    const errorCode = successful ? null : safeCode(probe.error_code || pipeline?.code || 'gemini_v4_temporal_failed');
    const trace = await closeTrace({ config, operationId, fixture, startedAt, outcome: successful ? 'completed' : 'failed', stage, counts: { request_count: 1, authentication_ms: authMs }, errorCode, providerDiagnostic: probe.provider_diagnostic, temporalDiagnostic, terminalTrace });
    const totalMs = elapsed(totalStarted); const status = successful && trace?.ok ? 200 : successful ? 503 : critical ? 409 : 422;
    return response(res, status, publicResult({ fixture, operationId, probe, pipeline, trace, totalMs, status, error: successful && !trace?.ok ? 'gemini_v4_temporal_trace_close_failed' : errorCode, temporalDiagnostic }));
  };
}

module.exports = createGeminiV4TemporalValidationHandler();
module.exports.createGeminiV4TemporalValidationHandler = createGeminiV4TemporalValidationHandler;
