'use strict';

// Conversación autenticada de solo lectura. El navegador aporta la frase y,
// opcionalmente, un token de continuidad firmado; la identidad, el scope y
// los datos comerciales se resuelven únicamente del lado servidor.
const { configuration, decidePreviewOwnerReferenceRequest } = require('../../lib/preview-owner-reference-policy');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { createCanonicalOwnerScopeResolver, verifiedOwnerId } = require('../../lib/yarbi-owner-scope');
const { loadScopedCrmSources, recordsFromRows, searchScopedCrm, normalizeScope } = require('../../lib/yarbi-crm-search-runtime');
const { buildFinanceContext } = require('../../lib/yarbi-finance-context');
const { runOwnerConversation } = require('../../lib/yarbi-conversation-runtime');
const { createConversationToken, readConversationToken } = require('../../lib/yarbi-conversation-continuity');
const { createGeminiV4OwnerUnderstandingProvider } = require('../../lib/yarbi-v4-provider');
const { errorCode, eventIdFor, newOperationId, recordTrace, recordTerminalTrace, traceSecret, traceVersion } = require('../../lib/yarbi-trace');

const RESPONSE_SCHEMA = 'yarbi.authenticated-conversation-response.v1';
const BLOCKED = new Set(['owner_id', 'owner_account_id', 'ownerid', 'owneraccountid', 'contact_ids', 'contactids', 'active_entity_id', 'selected_entity_id', 'service_role', 'supabase_key', 'supabase_secret_key', 'candidates']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value, limit = 1200) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function containsBlocked(value, depth = 0) { return Boolean(value && typeof value === 'object' && depth <= 5 && Object.entries(value).some(([key, child]) => BLOCKED.has(String(key).replace(/[^a-z0-9_]/gi, '').toLowerCase()) || containsBlocked(child, depth + 1))); }
function serviceClient(config, fetchImpl) { return async path => { const response = await fetchImpl(config.supabaseUrl + path, { headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` } }); return { response, data: await response.json().catch(() => []) }; }; }
function traceEvent({ operationId, secret, startedAt, stage, outcome, eventKey, counts = {}, error = null }) {
  return { operation_id: operationId, event_id: eventIdFor(operationId, stage, eventKey, secret), operation_type: 'authenticated_owner_conversation', stage, outcome, started_at: startedAt, ended_at: new Date().toISOString(), component: 'owner_conversation', component_version: traceVersion(), counts, contact_refs: [], error_code: error ? errorCode(error) : null, provider_diagnostic: error?.provider_diagnostic || null };
}
function needsVerifiedFacts(utterance) { return /\b(agenda|mañana|manana|visitas?|seguimiento|llamar|cobrad|instalaciones?)\b/i.test(String(utterance || '')); }
function financeRowsFrom(sources) {
  const byContact = new Map((Array.isArray(sources.contacts) ? sources.contacts : []).map(row => [Number(row.id), row]));
  return [...byContact.keys()].map(contactId => {
    const context = buildFinanceContext({ contactId, analyses: sources.analyses, receivables: sources.receivables, movements: null });
    return { contact_id: contactId, service: String(byContact.get(contactId)?.latest_service || ''), collected_amount: context.summary?.collected_amount, verified: context.summary?.income_source !== 'unavailable' };
  });
}
function safeResponse(result) {
  return { schema: RESPONSE_SCHEMA, ok: true, execute: false, outcome: text(result.outcome, 80), reply: text(result.reply, 1000), proposal: { kind: text(result.proposal?.kind, 64) || 'none', execute: false }, commercial_effects_allowed: false, selected_contact_id: Number.isSafeInteger(Number(result.selected_contact_id)) ? Number(result.selected_contact_id) : null, facts: object(result.facts), metrics: object(result.metrics) };
}

function createConversationHandler({ fetchImpl = fetch, providerFactory = createGeminiV4OwnerUnderstandingProvider, now = () => Date.now() } = {}) {
  return async function conversationHandler(req, res) {
    const decision = decidePreviewOwnerReferenceRequest(req, process.env);
    if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
    const config = decision.state?.config || configuration(process.env).config;
    if (!config) return res.status(503).json({ ok: false, error: 'owner_conversation_preview_not_configured' });
    const secret = traceSecret(process.env.YARBI_TRACE_HMAC_KEY);
    if (!secret) return res.status(503).json({ ok: false, error: 'trace_hmac_key_missing' });
    const operationId = newOperationId('owner_conversation', secret); const startedAt = new Date().toISOString(); let traceStarted = false;
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
      if (containsBlocked(body)) return res.status(400).json({ ok: false, error: 'owner_scope_client_input_forbidden' });
      const utterance = text(body.utterance || body.text, 1200);
      if (!utterance) return res.status(400).json({ ok: false, error: 'conversation_utterance_required' });
      const authenticated = await authenticatedOwnerIdentity(req, config, fetchImpl);
      if (!authenticated.ok) return res.status(authenticated.status).json({ ok: false, error: authenticated.code });
      const ownerId = verifiedOwnerId(authenticated.identity);
      const continuity = body.conversation_token ? readConversationToken({ token: body.conversation_token, ownerId, secret, now: now() }) : { ok: true, state: null, candidate_ids: [] };
      if (!continuity.ok) return res.status(400).json({ ok: false, error: continuity.code });
      await recordTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, fetchImpl, event: traceEvent({ operationId, secret, startedAt, stage: 'owner_conversation_started', outcome: 'started', eventKey: 'started', counts: { authenticated: 1 } }) });
      traceStarted = true;
      const supabase = serviceClient(config, fetchImpl);
      const scopeResolver = createCanonicalOwnerScopeResolver({ supabase });
      const scope = normalizeScope(ownerId, await scopeResolver(authenticated.identity));
      const sources = needsVerifiedFacts(utterance) && scope.ok ? await loadScopedCrmSources({ supabase, contactIds: scope.ids, metrics: { query_count: 0, sources: {} } }) : { contacts: [], agenda: [], analyses: [], receivables: [] };
      const provider = config.gemini.enabled ? providerFactory({ apiKey: config.gemini.apiKey, model: config.gemini.model, timeoutMs: config.gemini.timeoutMs, fetchImpl }) : null;
      const state = continuity.state || undefined;
      const result = await runOwnerConversation({ utterance, state, provider, candidates: continuity.candidate_ids, agendaEvents: sources.agenda, financeRows: financeRowsFrom(sources), now: now() });
      let candidateIds = continuity.candidate_ids;
      let search = null;
      if (result.crm_search?.outcome === 'crm_search_ready') {
        search = await searchScopedCrm({ supabase, validatedIdentity: authenticated.identity, ownerScopeResolver: scopeResolver, query: result.crm_search.query, filters: result.crm_search.filters, limit: 12 });
        candidateIds = (search.results || []).map(row => row.contact_id);
      }
      const response = safeResponse(result);
      response.operation_id = operationId;
      response.conversation_token = createConversationToken({ ownerId, state: result.state, candidateIds, secret, now: now() });
      if (search) response.crm_search = { outcome: search.outcome, execute: false, results: (search.results || []).map(row => ({ contact_id: row.contact_id, display_name: text(row.display_name, 160) || null, district: text(row.district, 100) || null, latest_service: text(row.latest_service, 80) || null })), source_status: search.metrics?.sources || {} };
      const terminal = await recordTerminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, fetchImpl, event: traceEvent({ operationId, secret, startedAt, stage: 'owner_conversation_completed', outcome: 'completed', eventKey: 'completed', counts: { candidates: candidateIds.length, gemini: config.gemini.enabled ? 1 : 0 } }), closeEventKey: 'owner_conversation_closed' });
      if (!terminal.ok) return res.status(502).json({ ok: false, error: 'owner_conversation_trace_close_failed', operation_id: operationId });
      return res.status(200).json(response);
    } catch (error) {
      if (traceStarted) { try { await recordTerminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, fetchImpl, event: traceEvent({ operationId, secret, startedAt, stage: 'owner_conversation_failed', outcome: 'failed', eventKey: 'failed', error }), closeEventKey: 'owner_conversation_failed_closed' }); } catch (_) {} }
      return res.status(502).json({ ok: false, error: error?.code || errorCode(error), operation_id: operationId });
    }
  };
}

module.exports = createConversationHandler();
module.exports.createConversationHandler = createConversationHandler;
module.exports.containsBlocked = containsBlocked;
