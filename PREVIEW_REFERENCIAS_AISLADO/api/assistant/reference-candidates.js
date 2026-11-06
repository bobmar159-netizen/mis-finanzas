'use strict';

const { configuration, decidePreviewOwnerReferenceRequest } = require('../../lib/preview-owner-reference-policy');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { getOwnerReferenceCandidates } = require('../../lib/yarbi-owner-reference-candidates');
const { createCanonicalOwnerScopeResolver, verifiedOwnerId } = require('../../lib/yarbi-owner-scope');
const { resolveCandidateReference } = require('../../lib/yarbi-candidate-resolver');
const { understandOwnerUtterance } = require('../../lib/yarbi-owner-understanding');
const { createGeminiOwnerUnderstandingProvider } = require('../../lib/yarbi-gemini-owner-understanding');
const { errorCode, eventIdFor, hashReference, newOperationId, recordTrace, recordTerminalTrace, traceSecret, traceVersion } = require('../../lib/yarbi-trace');

const RESPONSE_SCHEMA = 'yarbi.authenticated-reference-response.v1';
const BLOCKED_CLIENT_FIELDS = new Set(['owner_id', 'owneraccountid', 'owner_account_id', 'contact_ids', 'contactids', 'active_entity_id', 'selected_entity_id', 'owner_scope', 'verified_owner_scope', 'service_role', 'supabase_key', 'supabase_secret_key']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value, limit = 160) { return String(value ?? '').trim().slice(0, limit); }
function time(value) { return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0; }
function hasStructuredUnderstanding(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function containsBlockedClientField(value, depth = 0) {
  if (depth > 5 || !value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_CLIENT_FIELDS.has(String(key).replace(/[^a-z0-9_]/gi, '').toLowerCase())) return true;
    if (containsBlockedClientField(child, depth + 1)) return true;
  }
  return false;
}

// Conserva solo pistas estructuradas. El endpoint no clasifica ni interpreta
// texto libre: esa capacidad queda fuera de este alcance.
function sanitizedUnderstanding(input) {
  const source = object(input);
  const constraints = object(source.constraints);
  const accepted = {};
  for (const key of ['contact_id', 'phone', 'name', 'district', 'service', 'location', 'visit', 'recency']) {
    const value = constraints[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      accepted[key] = {
        value: text(value.value, 120) || undefined,
        certainty: ['confirmed', 'approximate', 'inferred', 'contradiction'].includes(text(value.certainty, 20)) ? text(value.certainty, 20) : 'inferred',
        days: optionalNumber(value.days),
        day_part: text(value.day_part, 20).toLowerCase() || undefined,
        present: typeof value.present === 'boolean' ? value.present : undefined
      };
    } else if (['contact_id', 'phone'].includes(key)) accepted[key] = value;
  }
  const ref = object(source.target_reference);
  const target_reference = {};
  for (const key of ['contact_id', 'phone', 'name']) if (ref[key] !== undefined) target_reference[key] = typeof ref[key] === 'string' || Number.isSafeInteger(Number(ref[key])) ? ref[key] : undefined;
  const temporal_clues = (Array.isArray(source.temporal_clues) ? source.temporal_clues : []).slice(0, 4).map(item => {
    const clue = object(item);
    return { days: optionalNumber(clue.days), day_part: text(clue.day_part, 20).toLowerCase() || undefined, certainty: ['confirmed', 'approximate', 'inferred', 'contradiction'].includes(text(clue.certainty, 20)) ? text(clue.certainty, 20) : 'inferred' };
  });
  return { intent: text(source.intent, 80) || 'reference_lookup', constraints: accepted, target_reference, temporal_clues };
}

// Estado mínimo para turnos como "sí, ese" o "no, fue de noche". Nunca
// acepta IDs, candidatos, teléfonos, scope ni historial de conversación.
function sanitizedConversationState(input) {
  const source = object(input); const constraints = object(source.active_constraints); const accepted = {};
  for (const key of ['name', 'district', 'service', 'location', 'recency']) {
    const raw = constraints[key]; if (raw === undefined || raw === null) continue;
    const item = typeof raw === 'object' && !Array.isArray(raw) ? raw : { value: raw };
    const value = text(item.value, 120); const days = optionalNumber(item.days); const dayPart = text(item.day_part, 20).toLowerCase();
    if (value || days !== undefined || dayPart) accepted[key] = { value: value || undefined, certainty: ['confirmed', 'approximate', 'inferred', 'contradiction'].includes(text(item.certainty, 20)) ? text(item.certainty, 20) : 'inferred', days, day_part: dayPart || undefined };
  }
  return { task: text(source.task, 80) || null, intent: text(source.intent, 80) || null, has_active_entity: source.has_active_entity === true, active_constraints: accepted, last_question: text(source.last_question, 240) || null };
}

function serviceClient(config) {
  return async (path, options = {}) => {
    const response = await fetch(config.supabaseUrl + path, { ...options, headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, ...(options.headers || {}) } });
    return { response, data: await response.json().catch(() => []) };
  };
}

function responseCandidates(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 8).map(row => ({
    contact_id: Number(row.contact_id), display_name: text(row.display_name, 160) || null,
    district: text(row.district, 100) || null, service: text(row.service, 80) || null,
    has_location: row.has_location === true, last_contact_at: row.last_contact_at || null,
    commercial_temperature: text(row.commercial_temperature, 32) || null
  }));
}

function responseResolution(resolution) {
  const result = object(resolution);
  return {
    outcome: text(result.outcome, 48) || 'no_match',
    selected_contact_id: Number.isSafeInteger(Number(result.selected?.contact_id)) ? Number(result.selected.contact_id) : null,
    next_question: text(result.search?.next_question, 240) || null,
    candidate_count: Number(result.search?.candidate_count || 0),
    highlighted_contact_id: Number.isSafeInteger(Number(result.search?.highlighted_contact_id)) ? Number(result.search.highlighted_contact_id) : null
  };
}

// El contrato Gemini ya excluye teléfono, contact_id y scope. Esta salida
// permite al cliente aislado explicar qué interpretó el parser sin convertirlo
// en una fuente de verdad ni exponer datos del CRM.
function responseUnderstanding(understanding) {
  const source = object(understanding); const constraints = object(source.constraints);
  const clue = value => { const item = object(value); return { value: text(item.value, 120) || null, certainty: text(item.certainty, 20) || 'inferred', days: item.days === undefined ? null : Number(item.days), day_part: text(item.day_part, 20) || null, source: text(item.source, 32) || 'unknown', evidence_text: text(item.evidence_text, 120) || null, semantic_safety: text(item.semantic_safety, 24) || 'unsupported' }; };
  const mentions = (Array.isArray(source.entity_mentions) ? source.entity_mentions : []).slice(0, 12).map(item => {
    const mention = object(item);
    return { kind: text(mention.kind, 40) || 'unknown', value: text(mention.value, 120) || null, source: text(mention.source, 32) || 'unknown', certainty: text(mention.certainty, 20) || 'inferred', evidence_text: text(mention.evidence_text, 120) || null };
  }).filter(item => item.value);
  return { schema: text(source.schema, 80) || null, intent: text(source.intent, 80) || null, conversational_act: text(source.conversational_act, 40) || null, target_type: text(source.target_type, 40) || null, entity_mentions: mentions, target_reference: { name: text(source.target_reference?.name, 120) || null, relation: text(source.target_reference?.relation, 80) || null, source: text(source.target_reference?.source, 32) || 'unknown', evidence_text: text(source.target_reference?.evidence_text, 120) || null, semantic_safety: text(source.target_reference?.semantic_safety, 24) || 'unsupported' }, constraints: { name: clue(constraints.name), district: clue(constraints.district), service: clue(constraints.service), location: clue(constraints.location), visit: clue(constraints.visit), recency: clue(constraints.recency) }, cancel_scope: text(source.cancel_scope, 32) || 'none', temporal_clues: (Array.isArray(source.temporal_clues) ? source.temporal_clues : []).slice(0, 6).map(clue), location_clues: (Array.isArray(source.location_clues) ? source.location_clues : []).slice(0, 6).map(clue), service_clues: (Array.isArray(source.service_clues) ? source.service_clues : []).slice(0, 6).map(clue), ambiguity: source.ambiguity === true, reference_specificity: text(source.reference_specificity, 24) || 'unknown', historical_relationship: source.historical_relationship === true, semantic_safety: text(source.semantic_safety, 24) || 'unsupported', semantic_guard: { removed_fact_count: Number(source.semantic_guard?.removed_fact_count || 0), removed_fields: (Array.isArray(source.semantic_guard?.removed_fields) ? source.semantic_guard.removed_fields : []).map(item => text(item, 80)).filter(Boolean).slice(0, 16), rejected_facts: (Array.isArray(source.semantic_guard?.rejected_facts) ? source.semantic_guard.rejected_facts : []).slice(0, 16).map(item => ({ field: text(item?.field, 80) || null, reason: text(item?.reason, 80) || null, evidence_type: text(item?.evidence_type, 40) || null })), normalized_fields: (Array.isArray(source.semantic_guard?.normalized_fields) ? source.semantic_guard.normalized_fields : []).map(item => text(item, 80)).filter(Boolean).slice(0, 16) }, missing_information: (Array.isArray(source.missing_information) ? source.missing_information : []).map(item => text(item, 80)).filter(Boolean).slice(0, 8) };
}

function traceEvent({ operationId, secret, startedAt, stage, outcome, eventKey, counts = {}, contactRefs = [], error = null }) {
  return {
    operation_id: operationId,
    event_id: eventIdFor(operationId, stage, eventKey, secret),
    operation_type: 'authenticated_reference_lookup', stage, outcome,
    started_at: startedAt, ended_at: new Date().toISOString(), component: 'owner_reference_candidates', component_version: traceVersion(),
    counts, contact_refs: contactRefs, error_code: error ? errorCode(error) : null,
    provider_diagnostic: error?.provider_diagnostic || null
  };
}

async function understandingForRequest({ body, config } = {}) {
  if (hasStructuredUnderstanding(body?.understanding)) return { route: 'FAST_LOCAL', understanding: sanitizedUnderstanding(body.understanding), geminiMs: 0 };
  const utterance = text(body?.utterance, 1200);
  if (!utterance) return { route: 'FAST_LOCAL', understanding: sanitizedUnderstanding({}), geminiMs: 0 };
  if (!config?.gemini?.enabled || !config.gemini.apiKey) {
    const error = new Error('understanding_unavailable'); error.code = error.message; throw error;
  }
  const provider = createGeminiOwnerUnderstandingProvider({ apiKey: config.gemini.apiKey, model: config.gemini.model, timeoutMs: config.gemini.timeoutMs });
  const started = performance.now();
  const interpreted = await understandOwnerUtterance({ provider, utterance, state: sanitizedConversationState(body?.conversation_state), candidates: [] });
  const geminiMs = performance.now() - started;
  if (interpreted.status !== 'understood') {
    // Conservamos una causa estable y sanitizada para diferenciar contrato
    // inválido de indisponibilidad del proveedor. Nunca incluye el texto,
    // la respuesta del modelo ni una credencial.
    const error = new Error('understanding_unavailable');
    error.code = text(interpreted.code, 80) || 'owner_understanding_response_invalid';
    throw error;
  }
  return { route: 'NEEDS_LANGUAGE_MODEL', understanding: interpreted.understanding, geminiMs };
}

module.exports = async function referenceCandidatesHandler(req, res) {
  const decision = decidePreviewOwnerReferenceRequest(req, process.env);
  if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
  const config = decision.state?.config || configuration(process.env).config;
  if (!config) return res.status(503).json({ ok: false, error: 'owner_reference_preview_not_configured' });
  const startedAt = new Date().toISOString();
  const totalStarted = performance.now();
  const secret = traceSecret(process.env.YARBI_TRACE_HMAC_KEY);
  if (!secret) return res.status(503).json({ ok: false, error: 'trace_hmac_key_missing' });
  const operationId = newOperationId('owner_reference', secret);
  let traceStarted = false;
  let traceMs = 0;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
    if (containsBlockedClientField(body)) return res.status(400).json({ ok: false, error: 'owner_scope_client_input_forbidden' });
    const authStarted = performance.now();
    const authenticated = await authenticatedOwnerIdentity(req, config);
    const authMs = performance.now() - authStarted;
    if (!authenticated.ok) return res.status(authenticated.status).json({ ok: false, error: authenticated.code });
    const traceStartStarted = performance.now();
    await recordTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, event: traceEvent({ operationId, secret, startedAt, stage: 'reference_lookup_started', outcome: 'started', eventKey: 'started', counts: { authenticated: 1 } }) });
    traceMs += performance.now() - traceStartStarted;
    traceStarted = true;
    const ownerId = verifiedOwnerId(authenticated.identity);
    // El scope canónico y Gemini no dependen uno del otro. Se inician en
    // paralelo tras validar la sesión; la recuperación de candidatos espera
    // ambos para aplicar solo restricciones ya validadas.
    const scopeStarted = performance.now();
    const ownerScopeResolver = createCanonicalOwnerScopeResolver({ supabase: serviceClient(config) });
    const scopePromise = ownerScopeResolver(authenticated.identity).then(value => ({ value, scopeMs: performance.now() - scopeStarted }));
    const understandingPromise = understandingForRequest({ body, config });
    let understandingResult;
    let resolvedScope;
    try { [resolvedScope, understandingResult] = await Promise.all([scopePromise, understandingPromise]); }
    catch (error) {
      const terminalStarted = performance.now();
      const terminal = await recordTerminalTrace({
        supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret,
        event: traceEvent({ operationId, secret, startedAt, stage: 'understanding_unavailable', outcome: 'unavailable', eventKey: 'unavailable', error }),
        closeEventKey: 'understanding_unavailable_closed'
      });
      traceMs += performance.now() - terminalStarted;
      if (!terminal.ok) return res.status(502).json({ ok: false, error: 'owner_reference_trace_close_failed', operation_id: operationId });
      // Sólo se expone un código estable y sanitizado: nunca el detalle del
      // proveedor, credenciales ni contenido de la frase del dueño.
      const providerStatus = Number.isInteger(Number(error?.status)) && Number(error.status) >= 400 && Number(error.status) < 600 ? `_${Number(error.status)}` : '';
      return res.status(503).json({ ok: false, error: 'understanding_unavailable', understanding_error: `${text(error?.code, 80) || 'owner_understanding_unavailable'}${providerStatus}`, execute: false, operation_id: operationId });
    }
    const understanding = understandingResult.understanding;
    const timeZone = text(body.timezone, 64) || undefined;
    const adapterStarted = performance.now();
    // Nunca reaprovechamos candidatos/scope recibidos desde el cliente. El
    // estado reutilizable deberá vivir del lado del servidor en una fase futura.
    const candidateResult = await getOwnerReferenceCandidates({
      supabase: serviceClient(config), ownerId, understanding, conversationState: {}, timeZone, limit: 8,
      ownerScopeResolver: async () => resolvedScope.value
    });
    candidateResult.metrics = { ...(candidateResult.metrics || {}), scope_ms: resolvedScope.scopeMs };
    const adapterMs = performance.now() - adapterStarted;
    const resolutionStarted = performance.now();
    const resolution = resolveCandidateReference({ candidates: candidateResult.candidates, state: {}, understanding });
    const resolverMs = performance.now() - resolutionStarted;
    const selectedContactId = resolution.selected?.contact_id;
    const contactRefs = selectedContactId ? [hashReference('contact', String(selectedContactId), secret)].filter(Boolean) : [];
    const terminalStarted = performance.now();
    const terminal = await recordTerminalTrace({
      supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret,
      event: traceEvent({ operationId, secret, startedAt, stage: 'reference_lookup_completed', outcome: 'completed', eventKey: 'completed', contactRefs, counts: { candidates: candidateResult.candidates?.length || 0, resolved: selectedContactId ? 1 : 0 } }),
      closeEventKey: 'reference_lookup_closed'
    });
    traceMs += performance.now() - terminalStarted;
    if (!terminal.ok) return res.status(502).json({ ok: false, error: 'owner_reference_trace_close_failed', operation_id: operationId });
    const totalMs = performance.now() - totalStarted;
    const knownMs = authMs + Number(understandingResult.geminiMs || 0) + Number(candidateResult.metrics?.scope_ms || 0) + Number(candidateResult.metrics?.candidate_query_ms || 0) + Number(candidateResult.metrics?.enrichment_ms || 0) + resolverMs + traceMs;
    return res.status(200).json({
      ok: true, schema: RESPONSE_SCHEMA, operation_id: operationId, execute: false,
      candidate_outcome: candidateResult.outcome,
      candidates: responseCandidates(candidateResult.candidates), resolution: responseResolution(resolution), understanding: responseUnderstanding(understanding),
      route: understandingResult.route,
      metrics: { auth_ms: time(authMs), owner_scope_ms: time(candidateResult.metrics?.scope_ms), scope_ms: time(candidateResult.metrics?.scope_ms), gemini_called: understandingResult.route === 'NEEDS_LANGUAGE_MODEL', gemini_ms: time(understandingResult.geminiMs), candidate_ms: time(candidateResult.metrics?.candidate_query_ms), candidate_query_ms: time(candidateResult.metrics?.candidate_query_ms), enrichment_ms: time(candidateResult.metrics?.enrichment_ms), resolver_ms: time(resolverMs), trace_ms: time(traceMs), other_overhead_ms: time(Math.max(0, totalMs - knownMs)), adapter_ms: time(adapterMs), total_ms: time(totalMs), query_count: Number(candidateResult.metrics?.query_count || 0), candidate_count: Number(candidateResult.candidates?.length || 0) }
    });
  } catch (error) {
    if (traceStarted) {
      try {
        await recordTerminalTrace({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, traceSecret: secret, event: traceEvent({ operationId, secret, startedAt, stage: 'reference_lookup_failed', outcome: 'failed', eventKey: 'failed', error }), closeEventKey: 'reference_lookup_failed_closed' });
      } catch (_) { /* Nunca ocultar el fallo original por una falla de trazabilidad. */ }
    }
    return res.status(502).json({ ok: false, error: error?.code || errorCode(error), operation_id: operationId });
  }
};

module.exports.serviceClient = serviceClient;
module.exports.sanitizedUnderstanding = sanitizedUnderstanding;
module.exports.containsBlockedClientField = containsBlockedClientField;
module.exports.understandingForRequest = understandingForRequest;
module.exports.responseUnderstanding = responseUnderstanding;

