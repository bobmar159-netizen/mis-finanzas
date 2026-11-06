'use strict';

const { HARDENED_SCHEMA, hardenUnderstanding } = require('./yarbi-semantic-hardening');

// Contrato de comprensión del dueño. El proveedor puede ser Gemini en una fase
// posterior o un fake en pruebas; el resto del producto solo recibe este JSON.
const OWNER_UNDERSTANDING_PROVIDER_SCHEMA = 'yarbi.owner-understanding.v1';
const OWNER_UNDERSTANDING_SCHEMA = HARDENED_SCHEMA;
const ACTS = new Set(['request', 'correction', 'confirmation', 'cancellation', 'continuation', 'clarification', 'unknown']);
const TARGET_TYPES = new Set(['contact', 'service', 'agenda', 'operation', 'unknown', 'none']);
const CANCEL_SCOPES = new Set(['task', 'operation', 'agenda', 'unknown', 'none']);

function text(value, limit = 180) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function positiveInteger(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function bool(value) { return value === true; }
function certainty(value) { const result = text(value, 20).toLowerCase(); return ['confirmed', 'approximate', 'inferred', 'contradiction'].includes(result) ? result : 'inferred'; }
function confidence(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0; }

function compactCandidate(candidate) {
  const source = object(candidate);
  return {
    contact_id: positiveInteger(source.contact_id || source.id),
    display_name: text(source.display_name || source.name, 80) || null,
    district: text(source.district, 80) || null,
    service: text(source.service, 80) || null,
    has_location: bool(source.has_location),
    last_contact_at: text(source.last_contact_at, 40) || null,
    visit_count: Array.isArray(source.visits) ? source.visits.length : 0
  };
}

function compactUnderstandingContext({ state = {}, candidates = [], moduleOrigin = null, visualOrigin = null } = {}) {
  const active = object(state);
  return {
    schema: 'yarbi.owner-understanding-context.v1',
    task: text(active.task, 80) || null,
    intent: text(active.intent, 80) || null,
    // El parser solo necesita saber que existe una referencia activa; no su ID.
    has_active_entity: bool(active.has_active_entity) || Boolean(active.active_entity?.contact_id || active.selected_entity?.contact_id),
    active_entity_id: positiveInteger(active.active_entity?.contact_id),
    selected_entity_id: positiveInteger(active.selected_entity?.contact_id),
    discarded_entity_ids: (Array.isArray(active.discarded_entity_ids) ? active.discarded_entity_ids : []).map(positiveInteger).filter(Boolean).slice(-16),
    active_constraints: object(active.active_constraints),
    last_question: text(active.last_question, 240) || null,
    module_origin: text(moduleOrigin || active.module_origin, 80) || null,
    visual_origin: text(visualOrigin || active.visual_origin, 80) || null,
    candidates: (Array.isArray(candidates) ? candidates : []).slice(0, 8).map(compactCandidate)
  };
}

function normalizeClue(value) {
  if (typeof value === 'string') return { value: text(value, 120), certainty: 'inferred' };
  const source = object(value);
  const result = { value: text(source.value, 120), certainty: certainty(source.certainty) };
  // `Number(null)` es 0 en JavaScript, pero un campo temporal vacío no
  // significa "hoy". Solo conservamos días cuando el proveedor entregó un
  // número real, para que una referencia por nombre no introduzca un filtro
  // temporal accidental.
  if (source.days !== null && source.days !== undefined && String(source.days).trim() !== '' && Number.isFinite(Number(source.days))) result.days = Math.max(0, Math.min(3650, Number(source.days)));
  if (text(source.day_part, 20)) result.day_part = text(source.day_part, 20).toLowerCase();
  if (typeof source.present === 'boolean') result.present = source.present;
  return result.value || result.days !== undefined || result.day_part || result.present !== undefined ? result : null;
}

function normalizeConstraints(input) {
  const source = object(input);
  const result = {};
  const contactId = positiveInteger(source.contact_id || source.id);
  const phone = text(source.phone, 40).replace(/\D/g, '');
  const name = normalizeClue(source.name);
  const district = normalizeClue(source.district);
  const service = normalizeClue(source.service);
  const location = normalizeClue(source.location);
  const visit = normalizeClue(source.visit);
  const recency = normalizeClue(source.recency || source.last_contact);
  if (contactId) result.contact_id = contactId;
  if (phone.length >= 6) result.phone = phone;
  for (const [key, clue] of Object.entries({ name, district, service, location, visit, recency })) if (clue) result[key] = clue;
  return result;
}

function normalizeEntityMentions(input) {
  const mentions = Array.isArray(input) ? input : [];
  return mentions.slice(0, 12).map(item => {
    const source = object(item);
    const kind = text(source.kind, 40).toLowerCase();
    const value = text(source.value, 120);
    if (!value) return null;
    return {
      kind: ['proper_name', 'service_reference', 'location_reference', 'temporal_reference', 'generic_reference', 'anaphoric_reference', 'unknown'].includes(kind) ? kind : 'unknown',
      value,
      source: ['utterance', 'conversation_state', 'unknown'].includes(text(source.source, 32)) ? text(source.source, 32) : 'unknown',
      certainty: certainty(source.certainty),
      evidence: text(source.evidence, 120) || null
    };
  }).filter(Boolean);
}

function normalizeUnderstanding(raw) {
  const source = object(raw);
  if (![OWNER_UNDERSTANDING_PROVIDER_SCHEMA, OWNER_UNDERSTANDING_SCHEMA].includes(text(source.schema, 80))) return { ok: false, code: 'owner_understanding_schema_invalid' };
  const act = text(source.conversational_act, 40).toLowerCase();
  const targetType = text(source.target_type, 40).toLowerCase();
  if (!ACTS.has(act) || !TARGET_TYPES.has(targetType)) return { ok: false, code: 'owner_understanding_contract_invalid' };
  const targetReference = object(source.target_reference);
  const correction = object(source.correction);
  const continuation = object(source.continuation);
  const cancelScope = text(source.cancel_scope, 32).toLowerCase() || 'none';
  if (!CANCEL_SCOPES.has(cancelScope)) return { ok: false, code: 'owner_understanding_cancel_scope_invalid' };
  const temporal = Array.isArray(source.temporal_clues) ? source.temporal_clues.map(normalizeClue).filter(Boolean).slice(0, 6) : [];
  const locations = Array.isArray(source.location_clues) ? source.location_clues.map(normalizeClue).filter(Boolean).slice(0, 6) : [];
  const services = Array.isArray(source.service_clues) ? source.service_clues.map(normalizeClue).filter(Boolean).slice(0, 6) : [];
  const reference = {
    contact_id: positiveInteger(targetReference.contact_id || targetReference.id),
    phone: text(targetReference.phone, 40).replace(/\D/g, ''),
    name: text(targetReference.name, 120) || null,
    relation: text(targetReference.relation, 80) || null
  };
  if (!reference.contact_id) delete reference.contact_id;
  if (reference.phone.length < 6) delete reference.phone;
  if (!reference.name) delete reference.name;
  if (!reference.relation) delete reference.relation;
  return {
    ok: true,
    value: {
      schema: OWNER_UNDERSTANDING_PROVIDER_SCHEMA,
      intent: text(source.intent, 80) || 'general',
      conversational_act: act,
      target_type: targetType,
      target_reference: reference,
      // v1 del proveedor puede omitirlo durante la transición. El hardener
      // v3 jamás convierte esa omisión en un nombre utilizable.
      entity_mentions: normalizeEntityMentions(source.entity_mentions),
      constraints: normalizeConstraints(source.constraints),
      correction: {
        discard_active_entity: bool(correction.discard_active_entity),
        replace_previous: bool(correction.replace_previous),
        select_alternative: bool(correction.select_alternative)
      },
      continuation: {
        use_active_entity: bool(continuation.use_active_entity),
        use_last_proposed_entity: bool(continuation.use_last_proposed_entity)
      },
      cancel_scope: cancelScope,
      temporal_clues: temporal,
      location_clues: locations,
      service_clues: services,
      confidence: confidence(source.confidence),
      ambiguity: bool(source.ambiguity),
      missing_information: (Array.isArray(source.missing_information) ? source.missing_information : []).map(item => text(item, 80)).filter(Boolean).slice(0, 8)
    }
  };
}

async function understandOwnerUtterance({ provider, utterance, state, candidates, moduleOrigin, visualOrigin } = {}) {
  if (!provider || (typeof provider !== 'function' && typeof provider.understandOwnerUtterance !== 'function')) {
    const error = new Error('owner_understanding_provider_unavailable'); error.code = error.message; throw error;
  }
  const input = {
    schema: 'yarbi.owner-understanding-request.v1',
    utterance: text(utterance, 1200),
    context: compactUnderstandingContext({ state, candidates, moduleOrigin, visualOrigin })
  };
  if (!input.utterance) { const error = new Error('owner_understanding_utterance_empty'); error.code = error.message; throw error; }
  const raw = typeof provider === 'function' ? await provider(input) : await provider.understandOwnerUtterance(input);
  const normalized = normalizeUnderstanding(raw);
  if (!normalized.ok) return { status: 'invalid_understanding', code: normalized.code, request: input };
  const understanding = hardenUnderstanding({ understanding: normalized.value, utterance: input.utterance, state: input.context });
  return { status: 'understood', understanding, request: input };
}

module.exports = { OWNER_UNDERSTANDING_PROVIDER_SCHEMA, OWNER_UNDERSTANDING_SCHEMA, compactUnderstandingContext, normalizeUnderstanding, understandOwnerUtterance };

