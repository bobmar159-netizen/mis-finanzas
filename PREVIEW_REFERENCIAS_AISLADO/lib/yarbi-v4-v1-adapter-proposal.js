'use strict';

// Adaptador local de propuesta. Recibe exclusivamente un v4 YA endurecido;
// no interpreta lenguaje, no consulta datos y no se importa desde handlers.
const V4_SCHEMA = 'yarbi.owner-understanding.v4';
const V1_SCHEMA = 'yarbi.owner-understanding.v1';
const INTENTS = new Set(['reference_lookup', 'open_client', 'continue_task', 'cancel', 'clarify', 'general']);
const ACTS = new Set(['request', 'correction', 'confirmation', 'cancellation', 'continuation', 'clarification', 'unknown']);
const TARGETS = new Set(['contact', 'service', 'agenda', 'operation', 'unknown', 'none']);
const KINDS = new Set(['proper_name', 'service_reference', 'location_reference', 'temporal_reference', 'generic_reference', 'anaphoric_reference', 'unknown']);
const CERTAINTIES = new Set(['confirmed', 'approximate', 'inferred']);
const SOURCES = new Set(['utterance', 'conversation_state']);
const POLARITY_GUARDS = new Set(['no_detectable_conflict', 'negation_elsewhere', 'verified_negation', 'explicit_conflict', 'scope_ambiguous', 'negation_not_evident']);
const CONSTRAINT_KINDS = { name: 'proper_name', service: 'service_reference', location: 'location_reference', recency: 'temporal_reference' };

function plain(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exactKeys(value, allowed, required = allowed) { return plain(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.includes(key)); }
function text(value, limit = 120) { return typeof value === 'string' && value.length > 0 && value.length <= limit && value === value.trim() ? value : null; }
function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function enumValue(value, allowed, limit = 80) { const raw = text(value, limit); return raw && allowed.has(raw) ? raw : null; }
function exactConfidence(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null; }

function validateProvenance(value) { return exactKeys(value, ['verified', 'source']) && typeof value.verified === 'boolean' && (value.source === 'utterance' || value.source === 'conversation_state' || value.source === 'unverified') ? value : null; }
function validatePolarityGuard(value) { return exactKeys(value, ['status', 'reason']) && enumValue(value.status, POLARITY_GUARDS) && (value.reason === null || typeof value.reason === 'string') ? value : null; }
function validateAttributes(value) {
  if (!exactKeys(value, ['days', 'day_part'], [])) return null;
  const out = {};
  if (Object.hasOwn(value, 'days')) { if (typeof value.days !== 'number' || !Number.isFinite(value.days) || ![0, 1].includes(value.days)) return null; out.days = value.days; }
  if (Object.hasOwn(value, 'day_part')) { if (!['morning', 'afternoon', 'night'].includes(value.day_part)) return null; out.day_part = value.day_part; }
  return out;
}
function validateMention(value) {
  const allowed = ['kind', 'value', 'polarity', 'certainty', 'claimed_source', 'days', 'day_part', 'present', 'provenance', 'polarity_guard', 'verified_attributes', 'attribute_issues'];
  if (!exactKeys(value, allowed, ['kind', 'value', 'polarity', 'certainty', 'claimed_source', 'provenance', 'polarity_guard', 'verified_attributes', 'attribute_issues'])) return null;
  const kind = enumValue(value.kind, KINDS, 40); const mentionValue = text(value.value); const polarity = value.polarity === 'affirmed' || value.polarity === 'negated' ? value.polarity : null; const certainty = enumValue(value.certainty, CERTAINTIES, 20); const claimed = ['utterance', 'conversation_state', 'unknown'].includes(value.claimed_source) ? value.claimed_source : null;
  const provenance = validateProvenance(value.provenance); const guard = validatePolarityGuard(value.polarity_guard); const attributes = validateAttributes(value.verified_attributes);
  if (!kind || !mentionValue || !polarity || !certainty || !claimed || !provenance || !guard || !attributes || !Array.isArray(value.attribute_issues) || value.attribute_issues.some(item => !text(item, 64))) return null;
  // `present` no puede cruzar el borde al contrato v1: el hardener propuesto
  // no tiene evidencia suficiente para convertirlo en una restricción.
  if (Object.hasOwn(value, 'present')) return null;
  if (Object.hasOwn(value, 'days') && (!Object.hasOwn(attributes, 'days') || value.days !== attributes.days)) return null;
  if (Object.hasOwn(value, 'day_part') && (!Object.hasOwn(attributes, 'day_part') || value.day_part !== attributes.day_part)) return null;
  return { kind, value: mentionValue, polarity, certainty, claimed_source: claimed, provenance, polarity_guard: guard, verified_attributes: attributes, attribute_issues: value.attribute_issues.slice() };
}
function positiveMentionSafe(item, contradictions) {
  if (item.polarity !== 'affirmed' || item.provenance.verified !== true || item.attribute_issues.length !== 0) return false;
  if (item.polarity_guard.status === 'no_detectable_conflict') return true;
  const dimension = ({ proper_name: 'name', service_reference: 'service', location_reference: 'location', temporal_reference: 'recency' })[item.kind];
  return item.polarity_guard.status === 'negation_elsewhere' && contradictions.some(itemContradiction => itemContradiction.dimension === dimension && normalized(itemContradiction.current_value) === normalized(item.value));
}
function validateConstraint(key, value, mentions, contradictions) {
  if (!Object.hasOwn(CONSTRAINT_KINDS, key) || !exactKeys(value, ['value', 'certainty', 'source', 'days', 'day_part'], ['value', 'certainty', 'source'])) return null;
  const constraintValue = text(value.value); const certainty = enumValue(value.certainty, CERTAINTIES, 20); const source = enumValue(value.source, SOURCES, 32);
  if (!constraintValue || !certainty || !source || Object.hasOwn(value, 'present')) return null;
  const attributes = validateAttributes({ ...(Object.hasOwn(value, 'days') ? { days: value.days } : {}), ...(Object.hasOwn(value, 'day_part') ? { day_part: value.day_part } : {}) });
  if (!attributes) return null;
  const expectedKind = CONSTRAINT_KINDS[key];
  const matching = mentions.find(item => item.kind === expectedKind && positiveMentionSafe(item, contradictions) && item.provenance.source === source && normalized(item.value) === normalized(constraintValue) && item.certainty === certainty && JSON.stringify(item.verified_attributes) === JSON.stringify(attributes));
  if (!matching) return null;
  return { value: matching.value, certainty, source, ...attributes };
}
function validateContradiction(value) {
  if (!exactKeys(value, ['dimension', 'previous_value', 'current_value', 'status']) || !['name', 'service', 'location', 'recency'].includes(value.dimension) || !text(value.previous_value) || !text(value.current_value) || value.status !== 'resolved_by_correction') return null;
  return { dimension: value.dimension, previous_value: value.previous_value, current_value: value.current_value, status: value.status };
}
function validateDiscardedMention(value, mentions) {
  const discarded = validateMention(value);
  if (!discarded || discarded.polarity !== 'negated') return null;
  return mentions.some(item => item.polarity === 'negated' && item.kind === discarded.kind && normalized(item.value) === normalized(discarded.value)) ? discarded : null;
}
function validateControl(value) {
  if (!exactKeys(value, ['correction', 'continuation', 'cancel_scope'])) return null;
  const correction = ['none', 'discard_active_entity', 'replace_previous', 'select_alternative'].includes(value.correction) ? value.correction : null;
  const continuation = ['none', 'active_entity', 'last_proposed_entity'].includes(value.continuation) ? value.continuation : null;
  const cancel_scope = ['task', 'operation', 'agenda', 'unknown', 'none'].includes(value.cancel_scope) ? value.cancel_scope : null;
  return correction && continuation && cancel_scope ? { correction, continuation, cancel_scope } : null;
}

function adaptV4ToV1(hardened) {
  const topKeys = ['schema', 'intent', 'conversational_act', 'target_type', 'mentions', 'control', 'contradictions', 'discarded_mentions', 'confidence', 'ambiguity', 'missing_information', 'plan'];
  if (!exactKeys(hardened, topKeys) || hardened.schema !== V4_SCHEMA) return { ok: false, code: 'v4_hardened_contract_invalid' };
  const intent = enumValue(hardened.intent, INTENTS); const act = enumValue(hardened.conversational_act, ACTS, 40); const target = enumValue(hardened.target_type, TARGETS, 40); const control = validateControl(hardened.control); const confidence = exactConfidence(hardened.confidence);
  if (!intent || !act || !target || !control || confidence === null || typeof hardened.ambiguity !== 'boolean' || !Array.isArray(hardened.mentions) || !Array.isArray(hardened.contradictions) || !Array.isArray(hardened.discarded_mentions) || !Array.isArray(hardened.missing_information) || hardened.missing_information.some(item => !text(item, 80))) return { ok: false, code: 'v4_semantic_fields_invalid' };
  const mentions = hardened.mentions.map(validateMention); if (mentions.some(item => !item)) return { ok: false, code: 'v4_mentions_invalid' };
  const contradictions = hardened.contradictions.map(validateContradiction); if (contradictions.some(item => !item)) return { ok: false, code: 'v4_contradictions_invalid' };
  const discarded = hardened.discarded_mentions.map(item => validateDiscardedMention(item, mentions)); if (discarded.some(item => !item)) return { ok: false, code: 'v4_discarded_mentions_invalid' };
  if (!exactKeys(hardened.plan, ['query_constraints', 'excluded_constraints', 'may_query_candidates', 'may_auto_select', 'requires_clarification', 'blocked_reasons']) || !plain(hardened.plan.query_constraints) || !Array.isArray(hardened.plan.excluded_constraints) || !Array.isArray(hardened.plan.blocked_reasons) || hardened.plan.may_query_candidates !== true || hardened.plan.may_auto_select !== false || hardened.plan.requires_clarification !== false) return { ok: false, code: 'v4_plan_invalid' };
  if (hardened.plan.excluded_constraints.length !== 0 || hardened.plan.blocked_reasons.length !== 0) return { ok: false, code: 'v4_plan_not_clean' };
  const constraints = {};
  for (const [key, value] of Object.entries(hardened.plan.query_constraints)) { const normalizedConstraint = validateConstraint(key, value, mentions, contradictions); if (!normalizedConstraint) return { ok: false, code: 'v4_constraint_not_backed_by_verified_affirmation' }; constraints[key] = normalizedConstraint; }
  if (!Object.keys(constraints).length) return { ok: false, code: 'v4_constraints_empty' };
  const positiveMentions = mentions.filter(item => positiveMentionSafe(item, contradictions));
  for (const contradiction of contradictions) {
    const kind = CONSTRAINT_KINDS[contradiction.dimension];
    const hasDiscarded = discarded.some(item => item.kind === kind && normalized(item.value) === normalized(contradiction.previous_value));
    const hasReplacement = positiveMentions.some(item => item.kind === kind && normalized(item.value) === normalized(contradiction.current_value));
    if (!hasDiscarded || !hasReplacement) return { ok: false, code: 'v4_contradiction_not_backed_by_mentions' };
  }
  const entity_mentions = positiveMentions.map(item => ({ kind: item.kind, value: item.value, source: item.provenance.source, certainty: item.certainty, evidence: item.value }));
  const nameMention = positiveMentions.find(item => item.kind === 'proper_name' && constraints.name && normalized(item.value) === normalized(constraints.name.value)) || null;
  const output = {
    schema: V1_SCHEMA, intent, conversational_act: act, target_type: target,
    target_reference: nameMention ? { name: nameMention.value, relation: 'explicit_name' } : {}, entity_mentions, constraints,
    correction: { discard_active_entity: control.correction === 'discard_active_entity', replace_previous: control.correction === 'replace_previous', select_alternative: control.correction === 'select_alternative' },
    continuation: { use_active_entity: control.continuation === 'active_entity', use_last_proposed_entity: control.continuation === 'last_proposed_entity' }, cancel_scope: control.cancel_scope,
    temporal_clues: constraints.recency ? [constraints.recency] : [], location_clues: constraints.location ? [constraints.location] : [], service_clues: constraints.service ? [constraints.service] : [], confidence, ambiguity: hardened.ambiguity, missing_information: hardened.missing_information.slice()
  };
  return { ok: true, value: output, preservation: { discarded_mentions: discarded.map(item => ({ kind: item.kind, value: item.value, polarity: item.polarity })), resolved_contradictions: contradictions, adapter_policy: 'positive_verified_constraints_only', may_auto_select: false } };
}

module.exports = { V4_SCHEMA, V1_SCHEMA, adaptV4ToV1 };
