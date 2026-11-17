'use strict';

// Conversación autenticada de solo lectura. El navegador aporta la frase y,
// opcionalmente, un token de continuidad firmado; la identidad, el scope y
// los datos comerciales se resuelven únicamente del lado servidor.
const { configuration, decideOwnerConversationRequest } = require('../../lib/yarbi-owner-conversation-policy');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { createCanonicalOwnerScopeResolver, verifiedOwnerId } = require('../../lib/yarbi-owner-scope');
const { loadScopedCrmSources, recordsFromRows, searchScopedCrm, normalizeScope } = require('../../lib/yarbi-crm-search-runtime');
const { buildFinanceContext } = require('../../lib/yarbi-finance-context');
const { buildBusinessTimeline } = require('../../lib/yarbi-business-timeline');
const { runOwnerConversation } = require('../../lib/yarbi-conversation-runtime');
const { createConversationToken, readConversationToken } = require('../../lib/yarbi-conversation-continuity');
const { createGeminiV4OwnerUnderstandingProvider } = require('../../lib/yarbi-v4-provider');
const { errorCode, eventIdFor, newOperationId, recordTrace, recordTerminalTrace, traceSecret, traceVersion } = require('../../lib/yarbi-trace');

const RESPONSE_SCHEMA = 'yarbi.authenticated-conversation-response.v1';
const BLOCKED = new Set(['owner_id', 'owner_account_id', 'ownerid', 'owneraccountid', 'contact_ids', 'contactids', 'active_entity_id', 'selected_entity_id', 'service_role', 'supabase_key', 'supabase_secret_key', 'candidates']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value, limit = 1200) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
// Las respuestas de Yarbi se renderizan con el subconjunto Markdown seguro del
// cliente. Los saltos de línea son estructura de presentación (títulos,
// listas, checks), no datos de control: conservarlos evita que el servidor
// aplaste una respuesta útil en un solo párrafo antes de que llegue al móvil.
function presentationText(value, limit = 4000) {
  const cleaned = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim();
  const characters = Array.from(cleaned);
  return characters.length > limit ? characters.slice(0, limit).join('') : cleaned;
}
function containsBlocked(value, depth = 0) { return Boolean(value && typeof value === 'object' && depth <= 5 && Object.entries(value).some(([key, child]) => BLOCKED.has(String(key).replace(/[^a-z0-9_]/gi, '').toLowerCase()) || containsBlocked(child, depth + 1))); }
function serviceClient(config, fetchImpl) { return async path => { const response = await fetchImpl(config.supabaseUrl + path, { headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` } }); return { response, data: await response.json().catch(() => []) }; }; }
function traceEvent({ operationId, secret, startedAt, stage, outcome, eventKey, counts = {}, error = null }) {
  return { operation_id: operationId, event_id: eventIdFor(operationId, stage, eventKey, secret), operation_type: 'authenticated_owner_conversation', stage, outcome, started_at: startedAt, ended_at: new Date().toISOString(), component: 'owner_conversation', component_version: traceVersion(), counts, contact_refs: [], error_code: error ? errorCode(error) : null, provider_diagnostic: error?.provider_diagnostic || null };
}
function positiveId(value) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function focusedDossierFrom({ state, scope, sources } = {}) {
  const contactId = positiveId(state?.selected_entity?.contact_id || state?.active_entity?.contact_id);
  if (!contactId || !scope?.ids?.includes(contactId)) return null;
  const contact = (Array.isArray(sources?.contacts) ? sources.contacts : []).find(row => positiveId(row?.id) === contactId);
  if (!contact) return null;
  const timeline = buildBusinessTimeline({ sources, contactId, limit: 24 });
  return {
    contact_id: contactId,
    dossier: { client_name: text(contact.display_name || contact.full_name, 160) || null },
    finance: buildFinanceContext({ contactId, analyses: sources.analyses, receivables: sources.receivables, movements: null }),
    timeline: timeline.events
  };
}
function needsVerifiedFacts(utterance) { return /\b(agenda|mañana|manana|visitas?|seguimiento|llamar|cobrad|instalaciones?|debe|deuda|saldo|historial|que\s+pas[oó])\b/i.test(String(utterance || '')); }
function financeRowsFrom(sources) {
  const byContact = new Map((Array.isArray(sources.contacts) ? sources.contacts : []).map(row => [Number(row.id), row]));
  return [...byContact.keys()].map(contactId => {
    const context = buildFinanceContext({ contactId, analyses: sources.analyses, receivables: sources.receivables, movements: null });
    return { contact_id: contactId, service: String(byContact.get(contactId)?.latest_service || ''), collected_amount: context.summary?.collected_amount, verified: context.summary?.income_source !== 'unavailable' };
  });
}
function safeIntelligence(value) {
  const source = object(value); const route = object(source.route); const deep = object(source.deep);
  return {
    tier: ['FAST', 'STANDARD', 'DEEP'].includes(String(route.tier || '')) ? route.tier : 'STANDARD',
    reason: text(route.reason, 96) || 'unclassified',
    transfer: source.transfer ? { from: text(source.transfer.from, 16), to: text(source.transfer.to, 16), reason: text(source.transfer.reason, 96), execute: false } : null,
    deep: Object.keys(deep).length ? { outcome: text(deep.outcome, 80), accepted: deep.accepted === true } : null
  };
}
function safeResponse(result) {
  const rawDiagnosticCode = text(result.code, 96);
  const diagnosticCode = /^(?:gemini_v4_[a-z0-9_]+|owner_understanding_[a-z0-9_]+)$/i.test(rawDiagnosticCode) ? rawDiagnosticCode : null;
  const providerDiagnostic = object(result.provider_diagnostic);
  const httpStatus = Number(providerDiagnostic.http_status);
  const diagnosticCategory = text(providerDiagnostic.category, 64).replace(/[^a-z0-9_:-]/gi, '') || null;
  return {
    schema: RESPONSE_SCHEMA, ok: true, execute: false, outcome: text(result.outcome, 80),
    reply: presentationText(result.reply),
    diagnostic: diagnosticCode || httpStatus || diagnosticCategory ? {
      code: diagnosticCode, http_status: Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599 ? httpStatus : null,
      category: diagnosticCategory
    } : null,
    proposal: { kind: text(result.proposal?.kind, 64) || 'none', execute: false }, commercial_effects_allowed: false,
    selected_contact_id: Number.isSafeInteger(Number(result.selected_contact_id)) ? Number(result.selected_contact_id) : null,
    facts: object(result.facts), intelligence: safeIntelligence(result.intelligence), metrics: object(result.metrics)
  };
}

function createConversationHandler({ fetchImpl = fetch, providerFactory = createGeminiV4OwnerUnderstandingProvider, now = () => Date.now() } = {}) {
  return async function conversationHandler(req, res) {
    const decision = decideOwnerConversationRequest(req, process.env);
    if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
    const config = decision.state?.config || configuration(process.env).config;
    if (!config) return res.status(503).json({ ok: false, error: 'owner_conversation_preview_not_configured' });
    const secret = traceSecret(process.env.YARBI_TRACE_HMAC_KEY);
    if (!secret) return res.status(503).json({ ok: false, error: 'trace_hmac_key_missing' });
    const operationId = newOperationId('owner_conversation', secret); const startedAt = new Date().toISOString(); let traceStarted = false; let diagnosticStage = 'request_validation';
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
      if (containsBlocked(body)) return res.status(400).json({ ok: false, error: 'owner_scope_client_input_forbidden' });
      const utterance = text(body.utterance || body.text, 1200);
      if (!utterance) return res.status(400).json({ ok: false, error: 'conversation_utterance_required' });
      diagnosticStage = 'owner_authentication';
      const authenticated = await authenticatedOwnerIdentity(req, config, fetchImpl);
      if (!authenticated.ok) return res.status(authenticated.status).json({ ok: false, error: authenticated.code });
      const ownerId = verifiedOwnerId(authenticated.identity);
      const continuity = body.conversation_token ? readConversationToken({ token: body.conversation_token, ownerId, secret, now: now() }) : { ok: true, state: null, candidate_ids: [] };
      if (!continuity.ok) return res.status(400).json({ ok: false, error: continuity.code });
      diagnosticStage = 'trace_start';
      await recordTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, fetchImpl, event: traceEvent({ operationId, secret, startedAt, stage: 'owner_conversation_started', outcome: 'started', eventKey: 'started', counts: { authenticated: 1 } }) });
      traceStarted = true;
      const supabase = serviceClient(config, fetchImpl);
      const scopeResolver = createCanonicalOwnerScopeResolver({ supabase });
      diagnosticStage = 'owner_scope';
      const scope = normalizeScope(ownerId, await scopeResolver(authenticated.identity));
      diagnosticStage = 'crm_source_read';
      const sources = needsVerifiedFacts(utterance) && scope.ok ? await loadScopedCrmSources({ supabase, contactIds: scope.ids, metrics: { query_count: 0, sources: {} } }) : { contacts: [], agenda: [], analyses: [], receivables: [] };
      diagnosticStage = 'gemini_provider_init';
      const provider = config.gemini.enabled ? providerFactory({ apiKey: config.gemini.apiKey, model: config.gemini.model, timeoutMs: config.gemini.timeoutMs, fetchImpl }) : null;
      const state = continuity.state || undefined;
      const dossier = focusedDossierFrom({ state, scope, sources });
      diagnosticStage = 'owner_turn_runtime';
      const result = await runOwnerConversation({ utterance, state, provider, candidates: continuity.candidate_ids, agendaEvents: sources.agenda, financeRows: financeRowsFrom(sources), dossier, now: now(), ownerId, deepIdempotencyKey: operationId });
      let candidateIds = continuity.candidate_ids;
      let search = null;
      if (result.crm_search?.outcome === 'crm_search_ready') {
        diagnosticStage = 'crm_search';
        search = await searchScopedCrm({ supabase, validatedIdentity: authenticated.identity, ownerScopeResolver: scopeResolver, query: result.crm_search.query, filters: result.crm_search.filters, limit: 12 });
        candidateIds = (search.results || []).map(row => row.contact_id);
      }
      diagnosticStage = 'response_formatting';
      const response = safeResponse(result);
      response.operation_id = operationId;
      diagnosticStage = 'continuity_token';
      response.conversation_token = createConversationToken({ ownerId, state: result.state, candidateIds, secret, now: now() });
      if (search) response.crm_search = { outcome: search.outcome, execute: false, results: (search.results || []).map(row => ({ contact_id: row.contact_id, display_name: text(row.display_name, 160) || null, district: text(row.district, 100) || null, latest_service: text(row.latest_service, 80) || null })), source_status: search.metrics?.sources || {} };
      diagnosticStage = 'trace_close';
      const terminal = await recordTerminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, fetchImpl, event: traceEvent({ operationId, secret, startedAt, stage: 'owner_conversation_completed', outcome: 'completed', eventKey: 'completed', counts: { candidates: candidateIds.length, gemini: config.gemini.enabled ? 1 : 0 } }), closeEventKey: 'owner_conversation_closed' });
      if (!terminal.ok) return res.status(502).json({ ok: false, error: 'owner_conversation_trace_close_failed', diagnostic: { stage: 'trace_close', code: 'owner_conversation_trace_close_failed' }, operation_id: operationId });
      return res.status(200).json(response);
    } catch (error) {
      if (traceStarted) { try { await recordTerminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, fetchImpl, event: traceEvent({ operationId, secret, startedAt, stage: 'owner_conversation_failed', outcome: 'failed', eventKey: 'failed', error }), closeEventKey: 'owner_conversation_failed_closed' }); } catch (_) {} }
      const safeErrorCode = String(error?.code || errorCode(error)).replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80) || 'operation_failed';
      const errorType = ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError', 'AbortError'].includes(error?.name) ? error.name : 'Error';
      const stackLocation = String(error?.stack || '').match(/((?:lib|api_handlers)[\\/][A-Za-z0-9_./\\-]+:\d+):\d+/);
      const location = stackLocation ? stackLocation[1].replace(/\\/g, '/').slice(0, 160) : null;
      return res.status(502).json({ ok: false, error: safeErrorCode, diagnostic: { stage: diagnosticStage, code: safeErrorCode, exception: errorType, location }, operation_id: operationId });
    }
  };
}

module.exports = createConversationHandler();
module.exports.createConversationHandler = createConversationHandler;
module.exports.containsBlocked = containsBlocked;
module.exports.safeIntelligence = safeIntelligence;
module.exports.focusedDossierFrom = focusedDossierFrom;
module.exports.presentationText = presentationText;
