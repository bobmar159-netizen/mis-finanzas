'use strict';

// Búsqueda CRM de solo lectura dentro del router P0.6. El navegador nunca
// aporta el owner: la sesión se verifica y el alcance sale de la relación
// canónica yarbi_owner_contact_scope.
const { configuration, decidePreviewOwnerReferenceRequest } = require('../../lib/preview-owner-reference-policy');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { createCanonicalOwnerScopeResolver } = require('../../lib/yarbi-owner-scope');
const { searchScopedCrm } = require('../../lib/yarbi-crm-search-runtime');
const { planCrmSearchFromUnderstanding } = require('../../lib/yarbi-crm-search-conversation');
const { errorCode, eventIdFor, newOperationId, recordTrace, recordTerminalTrace, traceSecret, traceVersion } = require('../../lib/yarbi-trace');

const RESPONSE_SCHEMA = 'yarbi.crm-search-response.v1';
const BLOCKED = new Set(['owner_id', 'owner_account_id', 'ownerid', 'owneraccountid', 'contact_ids', 'contactids', 'service_role', 'supabase_key', 'supabase_secret_key']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value, limit = 240) { return String(value ?? '').trim().slice(0, limit); }
function integer(value, fallback, maximum) { return Math.min(Math.max(Number(value) || fallback, 1), maximum); }
function includesBlocked(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return false;
  return Object.entries(value).some(([key, child]) => BLOCKED.has(String(key).replace(/[^a-z0-9_]/gi, '').toLowerCase()) || includesBlocked(child, depth + 1));
}

function sanitizedFilters(value) {
  const source = object(value);
  return {
    ...(text(source.status, 48) ? { status: text(source.status, 48) } : {}),
    ...(text(source.service, 80) ? { service: text(source.service, 80) } : {}),
    ...(text(source.district, 100) ? { district: text(source.district, 100) } : {}),
    ...(source.pending === true ? { pending: true } : {}),
    ...(Number.isFinite(Number(source.recency_days)) ? { recency_days: Math.max(0, Math.min(3660, Number(source.recency_days))) } : {})
  };
}

function serviceClient(config) {
  return async (path, options = {}) => {
    const response = await fetch(config.supabaseUrl + path, { ...options, headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, ...(options.headers || {}) } });
    return { response, data: await response.json().catch(() => []) };
  };
}

function traceEvent({ operationId, secret, startedAt, stage, outcome, eventKey, counts = {}, error = null }) {
  return {
    operation_id: operationId,
    event_id: eventIdFor(operationId, stage, eventKey, secret),
    operation_type: 'authenticated_crm_search', stage, outcome,
    started_at: startedAt, ended_at: new Date().toISOString(), component: 'crm_search', component_version: traceVersion(),
    counts, contact_refs: [], error_code: error ? errorCode(error) : null
  };
}

module.exports = async function crmSearchHandler(req, res) {
  const decision = decidePreviewOwnerReferenceRequest(req, process.env);
  if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
  const config = decision.state?.config || configuration(process.env).config;
  if (!config) return res.status(503).json({ ok: false, error: 'crm_search_preview_not_configured' });
  const secret = traceSecret(process.env.YARBI_TRACE_HMAC_KEY);
  if (!secret) return res.status(503).json({ ok: false, error: 'trace_hmac_key_missing' });
  const operationId = newOperationId('crm_search', secret);
  const startedAt = new Date().toISOString();
  let traceStarted = false;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
    if (includesBlocked(body)) return res.status(400).json({ ok: false, error: 'owner_scope_client_input_forbidden' });
    const query = text(body.query, 240);
    const plan = body.understanding ? planCrmSearchFromUnderstanding({ understanding: object(body.understanding), state: object(body.conversation_state) }) : null;
    if (!query && plan?.outcome !== 'crm_search_ready') {
      return res.status(400).json({ ok: false, error: 'crm_search_query_or_structured_understanding_required', execute: false });
    }
    const authenticated = await authenticatedOwnerIdentity(req, config);
    if (!authenticated.ok) return res.status(authenticated.status).json({ ok: false, error: authenticated.code });
    await recordTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, event: traceEvent({ operationId, secret, startedAt, stage: 'crm_search_started', outcome: 'started', eventKey: 'started', counts: { authenticated: 1 } }) });
    traceStarted = true;
    const resolvedQuery = query || plan.query;
    const resolvedFilters = { ...sanitizedFilters(body.filters), ...sanitizedFilters(plan?.filters) };
    const supabase = serviceClient(config);
    const search = await searchScopedCrm({
      supabase,
      validatedIdentity: authenticated.identity,
      ownerScopeResolver: createCanonicalOwnerScopeResolver({ supabase }),
      query: resolvedQuery,
      filters: resolvedFilters,
      page: integer(body.page, 1, 1000),
      limit: integer(body.limit, 12, 12)
    });
    const terminal = await recordTerminalTrace({
      supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret,
      event: traceEvent({ operationId, secret, startedAt, stage: 'crm_search_completed', outcome: 'completed', eventKey: 'completed', counts: { results: search.results?.length || 0, scope: search.scope?.contact_count || 0 } }),
      closeEventKey: 'crm_search_closed'
    });
    if (!terminal.ok) return res.status(502).json({ ok: false, error: 'crm_search_trace_close_failed', operation_id: operationId });
    return res.status(200).json({
      ok: true, schema: RESPONSE_SCHEMA, operation_id: operationId, execute: false,
      outcome: search.outcome, results: search.results || [], pagination: search.pagination,
      source_status: search.metrics?.sources || {}, metrics: { cache: search.metrics?.cache || 'disabled', query_count: Number(search.metrics?.query_count || 0), total_ms: Math.round(Number(search.metrics?.total_ms || 0)) },
      ...(plan ? { search_plan: { outcome: plan.outcome, source: plan.source || null } } : {})
    });
  } catch (error) {
    if (traceStarted) {
      try {
        await recordTerminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, event: traceEvent({ operationId, secret, startedAt, stage: 'crm_search_failed', outcome: 'failed', eventKey: 'failed', error }), closeEventKey: 'crm_search_failed_closed' });
      } catch (_) { /* El fallo original conserva prioridad. */ }
    }
    return res.status(502).json({ ok: false, error: error?.code || errorCode(error), operation_id: operationId });
  }
};

module.exports.sanitizedFilters = sanitizedFilters;
module.exports.includesBlocked = includesBlocked;
