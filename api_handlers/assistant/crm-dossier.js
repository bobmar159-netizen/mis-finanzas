'use strict';

// Consulta de expediente protegida. No acepta owner/contact scope desde el
// cliente, no muta CRM y conserva trazabilidad del recorrido de lectura.
const { configuration, decidePreviewOwnerReferenceRequest } = require('../../lib/preview-owner-reference-policy');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { createPaginatedCanonicalOwnerScopeResolver, verifiedOwnerId } = require('../../lib/yarbi-owner-scope');
const { getScopedCrmDossier } = require('../../lib/yarbi-crm-dossier-runtime');
const { createConversationToken } = require('../../lib/yarbi-conversation-continuity');
const { errorCode, eventIdFor, newOperationId, recordTrace, recordTerminalTrace, traceSecret, traceVersion } = require('../../lib/yarbi-trace');

const RESPONSE_SCHEMA = 'yarbi.crm-dossier-response.v1';
const BLOCKED = new Set(['owner_id', 'owner_account_id', 'ownerid', 'owneraccountid', 'contact_ids', 'contactids', 'service_role', 'supabase_key', 'supabase_secret_key']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function integer(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function includesBlocked(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return false;
  return Object.entries(value).some(([key, child]) => BLOCKED.has(String(key).replace(/[^a-z0-9_]/gi, '').toLowerCase()) || includesBlocked(child, depth + 1));
}
function serviceClient(config, fetchImpl = fetch) {
  return async path => {
    const response = await fetchImpl(config.supabaseUrl + path, { headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` } });
    return { response, data: await response.json().catch(() => []) };
  };
}
function traceEvent({ operationId, secret, startedAt, stage, outcome, eventKey, counts = {}, error = null }) {
  return { operation_id: operationId, event_id: eventIdFor(operationId, stage, eventKey, secret), operation_type: 'authenticated_crm_dossier', stage, outcome, started_at: startedAt, ended_at: new Date().toISOString(), component: 'crm_dossier', component_version: traceVersion(), counts, contact_refs: [], error_code: error ? errorCode(error) : null };
}

function createCrmDossierHandler({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return async function crmDossierHandler(req, res) {
  const decision = decidePreviewOwnerReferenceRequest(req, process.env);
  if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
  const config = decision.state?.config || configuration(process.env).config;
  if (!config) return res.status(503).json({ ok: false, error: 'crm_dossier_preview_not_configured' });
  const secret = traceSecret(process.env.YARBI_TRACE_HMAC_KEY);
  if (!secret) return res.status(503).json({ ok: false, error: 'trace_hmac_key_missing' });
  const operationId = newOperationId('crm_dossier', secret);
  const startedAt = new Date().toISOString();
  let traceStarted = false;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
    if (includesBlocked(body)) return res.status(400).json({ ok: false, error: 'owner_scope_client_input_forbidden' });
    const contactId = integer(body.contact_id);
    if (!contactId) return res.status(400).json({ ok: false, error: 'crm_dossier_contact_id_required' });
    const authenticated = await authenticatedOwnerIdentity(req, config, fetchImpl);
    if (!authenticated.ok) return res.status(authenticated.status).json({ ok: false, error: authenticated.code });
    await recordTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, fetchImpl, event: traceEvent({ operationId, secret, startedAt, stage: 'crm_dossier_started', outcome: 'started', eventKey: 'started', counts: { authenticated: 1 } }) });
    traceStarted = true;
    const supabase = serviceClient(config, fetchImpl);
    const dossier = await getScopedCrmDossier({ supabase, validatedIdentity: authenticated.identity, ownerScopeResolver: createPaginatedCanonicalOwnerScopeResolver({ supabase }), contactId });
    const terminal = await recordTerminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, fetchImpl, event: traceEvent({ operationId, secret, startedAt, stage: 'crm_dossier_completed', outcome: dossier.outcome, eventKey: 'completed', counts: { timeline: dossier.timeline?.length || 0 } }), closeEventKey: 'crm_dossier_closed' });
    if (!terminal.ok) return res.status(502).json({ ok: false, error: 'crm_dossier_trace_close_failed', operation_id: operationId });
    // The browser cannot nominate a contact for conversation state. A dossier
    // is already owner-authenticated and scope-checked, so it is the narrow
    // point where a short-lived, owner-bound continuity token may be minted.
    const ownerId = verifiedOwnerId(authenticated.identity);
    const conversationToken = dossier.outcome === 'dossier_found' && ownerId
      ? createConversationToken({ ownerId, state: { active_entity: { contact_id: contactId }, selected_entity: { contact_id: contactId } }, candidateIds: [contactId], secret })
      : null;
    return res.status(200).json({ ok: true, schema: RESPONSE_SCHEMA, operation_id: operationId, execute: false, ...dossier, ...(conversationToken ? { conversation_token: conversationToken } : {}) });
  } catch (error) {
    if (traceStarted) {
      try { await recordTerminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, fetchImpl, event: traceEvent({ operationId, secret, startedAt, stage: 'crm_dossier_failed', outcome: 'failed', eventKey: 'failed', error }), closeEventKey: 'crm_dossier_failed_closed' }); } catch (_) { /* conserva el error principal */ }
    }
    return res.status(502).json({ ok: false, error: error?.code || errorCode(error), operation_id: operationId });
  }
  };
}

module.exports = createCrmDossierHandler();
module.exports.createCrmDossierHandler = createCrmDossierHandler;

module.exports.includesBlocked = includesBlocked;
