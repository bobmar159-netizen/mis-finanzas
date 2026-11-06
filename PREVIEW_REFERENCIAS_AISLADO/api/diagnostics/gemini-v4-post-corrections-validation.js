'use strict';

// Ruta temporal, aislada y diagnóstica. Acepta sólo IDs de fixtures locales;
// no recibe texto, contexto ni identificadores comerciales por HTTP.
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { decideGeminiV4PostCorrectionsRequest } = require('../../lib/preview-gemini-v4-post-corrections-policy');
const { CASES, fixtureById } = require('../../lib/yarbi-v4-post-corrections-fixtures');
const { runGeminiV4Probe } = require('../../lib/yarbi-gemini-v4-probe');
const { runLocalPipeline } = require('./gemini-v4-semantic-validation');
const { eventIdFor, operationIdFromReference, recordTrace, recordTerminalTrace, traceVersion } = require('../../lib/yarbi-trace');
const { providerUnavailableTemporalDiagnostic, sanitizeTemporalDiagnostic } = require('../../lib/yarbi-v4-temporal-diagnostics');

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
function v4AuthOnlyPublic({ authorization, authenticated, ownerMatches, totalMs }) {
  const category = !authorization.present ? 'header_missing' : !authenticated?.ok ? 'supabase_auth_rejected' : ownerMatches ? 'authorized' : 'owner_mismatch';
  return { ok: category === 'authorized', route_mode: 'v4_auth_only', execute: false, gemini_invoked: false, fixture_consumed: false, pipeline_invoked: false, trace_invoked: false, commercial_actions_executed: false, resolver_invoked: false, authorization_header_present: authorization.present, authorization_format_valid: authorization.format_valid, supabase_auth_result: !authorization.present ? 'not_called' : authenticated?.ok ? 'valid' : 'rejected', owner_matches: ownerMatches === true, authorization_result: category === 'authorized' ? 'authorized' : category, category, server_total_ms: totalMs, isolated_project_ref: 'uevilhbstnmmdlgyshlv' };
}
function safeLedgerStage(value) { return String(value || '').replace(/[^a-z0-9_.-]/gi, '').slice(0, 96) || null; }
function operationForFixture(fixture, traceSecret) {
  return operationIdFromReference('gemini_v4_post_corrections_validation', fixture.id, traceSecret);
}
function summarizeLedgerRows(rows, config) {
  const expected = new Map(CASES.map(fixture => [operationForFixture(fixture, config.traceSecret), fixture.id]));
  const grouped = new Map(CASES.map(fixture => [fixture.id, []]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const fixtureId = expected.get(String(row?.target_id || ''));
    if (!fixtureId) continue;
    const request = object(row.request_payload); const result = object(row.result_payload);
    if (request.operation_type !== 'gemini_v4_post_corrections_validation') continue;
    grouped.get(fixtureId).push({
      stage: safeLedgerStage(result.stage || request.stage),
      outcome: ['started', 'completed', 'failed'].includes(result.outcome) ? result.outcome : null,
      request_count: Number.isInteger(Number(result?.counts?.request_count)) ? Number(result.counts.request_count) : null
    });
  }
  return CASES.map(fixture => {
    const events = grouped.get(fixture.id) || [];
    const started = events.filter(event => event.stage === 'operation_started').length;
    const terminal = events.filter(event => event.stage !== 'operation_started' && event.outcome !== 'started');
    return {
      fixture_id: fixture.id,
      event_count: events.length,
      started_count: started,
      terminal_count: terminal.length,
      terminal_stages: [...new Set(terminal.map(event => event.stage).filter(Boolean))].sort(),
      terminal_request_counts: [...new Set(terminal.map(event => event.request_count).filter(Number.isInteger))].sort((a, b) => a - b)
    };
  });
}
async function readLedgerPreflight(config, fetchImpl = fetch) {
  const operationIds = CASES.map(fixture => operationForFixture(fixture, config.traceSecret));
  const url = new URL(`${String(config.supabaseUrl).replace(/\/$/, '')}/rest/v1/yarbi_agent_actions`);
  url.searchParams.set('select', 'target_id,request_payload,result_payload');
  url.searchParams.set('target_type', 'eq.trace_operation');
  url.searchParams.set('target_id', `in.(${operationIds.join(',')})`);
  let response;
  try {
    response = await fetchImpl(url, { headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, Accept: 'application/json' } });
  } catch (_) { return { ok: false, code: 'ledger_preflight_read_failed' }; }
  if (!response?.ok) return { ok: false, code: 'ledger_preflight_read_failed' };
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows)) return { ok: false, code: 'ledger_preflight_invalid_response' };
  const fixtures = summarizeLedgerRows(rows, config);
  const byId = new Map(fixtures.map(item => [item.fixture_id, item]));
  const firstThree = ['F3PC-01', 'F3PC-02', 'F3PC-03'];
  const completed = firstThree.every(id => {
    const entry = byId.get(id);
    return entry?.event_count === 3 && entry.started_count === 1 && entry.terminal_count === 2
      && entry.terminal_request_counts.length === 1 && entry.terminal_request_counts[0] === 1
      && entry.terminal_stages.includes('gemini_v4_post_corrections_completed')
      && entry.terminal_stages.includes('operation_closed');
  });
  const fourth = byId.get('F3PC-04');
  const pending = CASES.filter(fixture => /^F3PC-(0[5-9]|1[0-6])$/.test(fixture.id)).every(fixture => byId.get(fixture.id)?.event_count === 0);
  return { ok: completed && fourth?.event_count === 0 && pending, code: completed && fourth?.event_count === 0 && pending ? null : 'ledger_preflight_state_mismatch', fixtures };
}
function ledgerPreflightPublic({ ledger, totalMs }) {
  return {
    ok: ledger.ok === true,
    route_mode: 'ledger_preflight',
    execute: false,
    gemini_invoked: false,
    fixture_consumed: false,
    pipeline_invoked: false,
    trace_invoked: false,
    commercial_actions_executed: false,
    resolver_invoked: false,
    isolated_project_ref: 'uevilhbstnmmdlgyshlv',
    ledger: { code: ledger.code || null, fixtures: ledger.fixtures || [] },
    server_total_ms: totalMs
  };
}
function traceEvent({ operationId, fixture, stage, outcome, startedAt, config, counts = {}, errorCode = null, providerDiagnostic = null, temporalDiagnostic = null }) {
  const diagnostic = temporalDiagnostic ? sanitizeTemporalDiagnostic(temporalDiagnostic) : null;
  return { operation_id: operationId, event_id: eventIdFor(operationId, stage, `${fixture.id}:${stage}`, config.traceSecret), operation_type: 'gemini_v4_post_corrections_validation', stage, outcome, started_at: startedAt, ended_at: nowIso(), component: 'preview_diagnostic', component_version: traceVersion(), counts, ...(errorCode ? { error_code: errorCode } : {}), ...(providerDiagnostic ? { provider_diagnostic: providerDiagnostic } : {}), ...(diagnostic ? { temporal_diagnostic: diagnostic } : {}) };
}
async function closeTrace({ config, operationId, fixture, startedAt, outcome, stage, counts, errorCode, providerDiagnostic, temporalDiagnostic, terminalTrace }) {
  try { return await terminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: config.traceSecret, event: traceEvent({ operationId, fixture, stage, outcome, startedAt, config, counts, errorCode, providerDiagnostic, temporalDiagnostic }), closeEventKey: `${fixture.id}:operation_closed:${stage}` }); }
  catch (_) { return { ok: false, reason: 'trace_terminal_failed' }; }
}
function safePublic({ fixture, operationId, probe, pipeline, trace, totalMs, status, error, temporalDiagnostic = null }) {
  const semantic = pipeline?.semantic || null;
  const diagnostic = temporalDiagnostic ? sanitizeTemporalDiagnostic(temporalDiagnostic) : null;
  return {
    ok: status === 200, fixture_id: fixture.id, fixture_family: fixture.family, execute: false,
    request_count: 1, automatic_retries: 0, commercial_actions_executed: false, resolver_invoked: false,
    operation_id: operationId, model: probe?.model || null, schema_sha256: probe?.schema_sha256 || null,
    schema_bytes: Number.isFinite(Number(probe?.schema_bytes)) ? Number(probe.schema_bytes) : null,
    provider_http_status: Number.isInteger(Number(probe?.provider_http_status)) ? Number(probe.provider_http_status) : null,
    gemini_ms: Number.isFinite(Number(probe?.provider_ms)) ? Number(probe.provider_ms) : null,
    server_total_ms: totalMs,
    pipeline: pipeline ? { status: pipeline.ok ? 'passed' : 'failed', stage: pipeline.stage, code: safeCode(pipeline.code), timings_ms: pipeline.timing || {}, temporal_diagnostic: diagnostic, semantic: semantic ? { pass: semantic.semantic_pass === true, critical_security_failure: semantic.critical_security_failure === true, safe_outcome: safeCode(semantic.safe_outcome), assertions: semantic.assertions } : null } : null,
    temporal_diagnostic: diagnostic,
    trace_closed: trace?.ok === true, error: safeCode(error), allowed_egress: ['isolated_supabase_auth_and_ledger', 'gemini_generate_content']
  };
}

function createGeminiV4PostCorrectionsValidationHandler({ authenticate = authenticatedOwnerIdentity, runProbe = runGeminiV4Probe, startTrace = recordTrace, terminalTrace = recordTerminalTrace, fetchImpl = fetch } = {}) {
  return async function geminiV4PostCorrectionsValidationHandler(req, res) {
    const totalStarted = performance.now(); const decision = decideGeminiV4PostCorrectionsRequest(req, process.env);
    if (!decision.allow) return response(res, decision.status, { ok: false, error: decision.code, execute: false });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
    const authOnly = Object.keys(body).length === 1 && body.auth_only === true;
    const ledgerPreflight = Object.keys(body).length === 1 && body.ledger_preflight === true;
    const fixture = authOnly || ledgerPreflight ? null : Object.keys(body).length === 1 ? fixtureById(body.fixture_id) : null;
    if (!authOnly && !ledgerPreflight && !fixture) return response(res, 400, { ok: false, error: 'gemini_v4_post_corrections_fixture_forbidden', execute: false });
    const authStarted = performance.now(); const authenticated = await authenticate(req, decision.state.config); const authMs = elapsed(authStarted);
    const ownerMatches = authenticated?.ok === true && authenticated.user?.id === decision.state.config.ownerId;
    if (authOnly) {
      const status = !authenticated?.ok ? 401 : ownerMatches ? 200 : 403;
      return response(res, status, v4AuthOnlyPublic({ authorization: authorizationInfo(req), authenticated, ownerMatches, totalMs: elapsed(totalStarted) }));
    }
    if (!authenticated.ok) return response(res, authenticated.status, { ok: false, error: authenticated.code, execute: false });
    if (!ownerMatches) return response(res, 403, { ok: false, error: 'gemini_v4_post_corrections_owner_forbidden', execute: false });
    const config = decision.state.config;
    if (ledgerPreflight) {
      const ledger = await readLedgerPreflight(config, fetchImpl);
      return response(res, ledger.ok ? 200 : 409, ledgerPreflightPublic({ ledger, totalMs: elapsed(totalStarted) }));
    }
    const operationId = operationIdFromReference('gemini_v4_post_corrections_validation', fixture.id, config.traceSecret); const startedAt = nowIso();
    let started;
    try { started = await startTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: config.traceSecret, event: traceEvent({ operationId, fixture, stage: 'operation_started', outcome: 'started', startedAt, config, counts: { request_count: 0 } }) }); }
    catch (_) { return response(res, 503, { ok: false, error: 'gemini_v4_post_corrections_trace_start_failed', execute: false }); }
    if (!started?.ok) return response(res, 503, { ok: false, error: 'gemini_v4_post_corrections_trace_start_unrecorded', execute: false });
    if (started.duplicate === true) return response(res, 409, { ok: false, error: 'gemini_v4_post_corrections_already_dispatched', execute: false, fixture_id: fixture.id, operation_id: operationId });
    const probe = await runProbe({ apiKey: config.gemini.apiKey, model: config.gemini.model, timeoutMs: config.gemini.timeoutMs, utterance: fixture.utterance, state: fixture.state, context: fixture.diagnostic_context });
    const pipeline = probe.accepted ? runLocalPipeline(probe.raw, fixture) : null;
    const temporalDiagnostic = pipeline?.temporal_diagnostic || providerUnavailableTemporalDiagnostic();
    const successful = probe.accepted === true && pipeline?.ok === true;
    const critical = pipeline?.semantic?.critical_security_failure === true;
    const stage = successful ? 'gemini_v4_post_corrections_completed' : critical ? 'gemini_v4_post_corrections_critical_blocked' : probe.accepted ? `gemini_v4_post_corrections_${pipeline?.stage || 'pipeline_failed'}` : 'gemini_v4_post_corrections_provider_failed';
    const errorCode = successful ? null : safeCode(probe.error_code || pipeline?.code || 'gemini_v4_post_corrections_failed');
    const trace = await closeTrace({ config, operationId, fixture, startedAt, outcome: successful ? 'completed' : 'failed', stage, counts: { request_count: 1, authentication_ms: authMs }, errorCode, providerDiagnostic: probe.provider_diagnostic, temporalDiagnostic, terminalTrace });
    const totalMs = elapsed(totalStarted); const status = successful && trace?.ok ? 200 : successful ? 503 : critical ? 409 : 422;
    return response(res, status, safePublic({ fixture, operationId, probe, pipeline, trace, totalMs, status, error: successful && !trace?.ok ? 'gemini_v4_post_corrections_trace_close_failed' : errorCode, temporalDiagnostic }));
  };
}

module.exports = createGeminiV4PostCorrectionsValidationHandler();
module.exports.createGeminiV4PostCorrectionsValidationHandler = createGeminiV4PostCorrectionsValidationHandler;
