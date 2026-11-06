'use strict';

// Contrato compacto de diagnóstico. No es un segundo motor: su única salida
// es el contrato de proveedor v1 que ya valida, endurece y consume Yarbi.
const COMPACT_SCHEMA = 'yarbi.owner-understanding.compact.v1';
const PROVIDER_SCHEMA = 'yarbi.owner-understanding.v1';
const INTENTS = new Set(['reference_lookup', 'open_client', 'continue_task', 'cancel', 'clarify', 'general']);
const ACTS = new Set(['request', 'correction', 'confirmation', 'cancellation', 'continuation', 'clarification', 'unknown']);
const TARGETS = new Set(['contact', 'service', 'agenda', 'operation', 'unknown', 'none']);
const KINDS = new Set(['proper_name', 'service_reference', 'location_reference', 'temporal_reference', 'generic_reference', 'anaphoric_reference', 'unknown']);
const SOURCES = new Set(['utterance', 'conversation_state']);
const CERTAINTIES = new Set(['confirmed', 'approximate', 'inferred', 'contradiction']);
const POLARITIES = new Set(['affirmed', 'negated', 'contradicted']);
const CORRECTIONS = new Set(['none', 'discard_active_entity', 'replace_previous', 'select_alternative']);
const CONTINUITIES = new Set(['none', 'active_entity', 'last_proposed_entity']);
const CANCELS = new Set(['task', 'operation', 'agenda', 'unknown', 'none']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value, limit = 160) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function enumValue(value, set) { const item = text(value, 48).toLowerCase(); return set.has(item) ? item : null; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function field(value, set, name) { const parsed = enumValue(value, set); if (!parsed) return { ok: false, code: `compact_${name}_invalid` }; return { ok: true, value: parsed }; }

function compactUnderstandingJsonSchema() {
  return { type: 'object', additionalProperties: false, required: ['schema', 'intent', 'conversational_act', 'target_type', 'mentions', 'control', 'confidence', 'ambiguity', 'missing_information'], properties: {
    schema: { type: 'string', enum: [COMPACT_SCHEMA] },
    intent: { type: 'string', enum: [...INTENTS] },
    conversational_act: { type: 'string', enum: [...ACTS] },
    target_type: { type: 'string', enum: [...TARGETS] },
    mentions: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['kind', 'value', 'source', 'certainty', 'polarity'], properties: {
      kind: { type: 'string', enum: [...KINDS] }, value: { type: 'string' }, source: { type: 'string', enum: [...SOURCES] }, certainty: { type: 'string', enum: [...CERTAINTIES] }, polarity: { type: 'string', enum: [...POLARITIES] },
      attributes: { type: 'object', additionalProperties: false, properties: { days: { type: 'number' }, day_part: { type: 'string', enum: ['morning', 'afternoon', 'night'] }, present: { type: 'boolean' } } }
    } } },
    control: { type: 'object', additionalProperties: false, required: ['correction', 'continuation', 'cancel_scope'], properties: { correction: { type: 'string', enum: [...CORRECTIONS] }, continuation: { type: 'string', enum: [...CONTINUITIES] }, cancel_scope: { type: 'string', enum: [...CANCELS] } } },
    confidence: { type: 'number', minimum: 0, maximum: 1 }, ambiguity: { type: 'boolean' }, missing_information: { type: 'array', maxItems: 8, items: { type: 'string' } }
  } };
}

function normalizeMention(raw) {
  const source = object(raw); const kind = enumValue(source.kind, KINDS); const value = text(source.value, 120); const origin = enumValue(source.source, SOURCES); const certainty = enumValue(source.certainty, CERTAINTIES); const polarity = enumValue(source.polarity, POLARITIES);
  if (!kind || !value || !origin || !certainty || !polarity) return null;
  const attributes = object(source.attributes); const out = { kind, value, source: origin, certainty: polarity === 'contradicted' ? 'contradiction' : certainty, polarity };
  if (attributes.days !== undefined) { const days = number(attributes.days); if (days === null || days < 0 || days > 3650) return null; out.days = days; }
  if (attributes.day_part !== undefined) { const part = enumValue(attributes.day_part, new Set(['morning', 'afternoon', 'night'])); if (!part) return null; out.day_part = part; }
  if (attributes.present !== undefined) { if (typeof attributes.present !== 'boolean') return null; out.present = attributes.present; }
  return out;
}

function compactToProviderV1(input) {
  const source = object(input);
  if (text(source.schema, 80) !== COMPACT_SCHEMA) return { ok: false, code: 'compact_schema_invalid' };
  const intent = field(source.intent, INTENTS, 'intent'); const act = field(source.conversational_act, ACTS, 'act'); const target = field(source.target_type, TARGETS, 'target');
  const control = object(source.control); const correction = field(control.correction, CORRECTIONS, 'correction'); const continuation = field(control.continuation, CONTINUITIES, 'continuation'); const cancel = field(control.cancel_scope, CANCELS, 'cancel_scope');
  const confidence = number(source.confidence); if (!intent.ok || !act.ok || !target.ok || !correction.ok || !continuation.ok || !cancel.ok || confidence === null || confidence < 0 || confidence > 1 || typeof source.ambiguity !== 'boolean' || !Array.isArray(source.mentions) || source.mentions.length > 12 || !Array.isArray(source.missing_information) || source.missing_information.length > 8) return { ok: false, code: 'compact_contract_invalid' };
  const mentions = source.mentions.map(normalizeMention); if (mentions.some(item => !item)) return { ok: false, code: 'compact_mention_invalid' };
  // v1/v3 no conservan una polaridad explícita: el hardener reduce las
  // menciones a confirmed|approximate|inferred. Convertir una negación o una
  // contradicción en una mención positiva perdería significado y podría
  // resolver al cliente equivocado. Hasta ampliar el contrato interno en una
  // fase autorizada, el adaptador prefiere abstenerse de adaptar esos casos.
  const unrepresentablePolarity = mentions.find(item => item.polarity !== 'affirmed');
  if (unrepresentablePolarity) return {
    ok: false,
    code: 'compact_polarity_not_representable_by_v1',
    diagnostics: { kind: unrepresentablePolarity.kind, polarity: unrepresentablePolarity.polarity }
  };
  const first = predicate => mentions.find(predicate) || null;
  const name = first(item => item.kind === 'proper_name' && item.polarity === 'affirmed');
  const service = first(item => item.kind === 'service_reference' && item.polarity === 'affirmed');
  const location = first(item => item.kind === 'location_reference' && item.polarity === 'affirmed');
  const temporal = mentions.filter(item => item.kind === 'temporal_reference' && item.polarity === 'affirmed');
  const toClue = item => ({ value: item.value, certainty: item.certainty, ...(item.days !== undefined ? { days: item.days } : {}), ...(item.day_part ? { day_part: item.day_part } : {}), ...(item.present !== undefined ? { present: item.present } : {}) });
  const constraints = {};
  if (name) constraints.name = toClue(name); if (service) constraints.service = toClue(service); if (location) constraints.location = toClue(location);
  const provider = { schema: PROVIDER_SCHEMA, intent: intent.value, conversational_act: act.value, target_type: target.value, target_reference: name ? { name: name.value, relation: 'explicit_name' } : {}, entity_mentions: mentions.map(item => ({ kind: item.kind, value: item.value, source: item.source, certainty: item.certainty, evidence: item.value })), constraints, correction: { discard_active_entity: correction.value === 'discard_active_entity', replace_previous: correction.value === 'replace_previous', select_alternative: correction.value === 'select_alternative' }, continuation: { use_active_entity: continuation.value === 'active_entity', use_last_proposed_entity: continuation.value === 'last_proposed_entity' }, cancel_scope: cancel.value, temporal_clues: temporal.map(toClue), location_clues: location ? [toClue(location)] : [], service_clues: service ? [toClue(service)] : [], confidence, ambiguity: source.ambiguity, missing_information: source.missing_information.map(item => text(item, 80)).filter(Boolean) };
  return { ok: true, value: provider, diagnostics: { mention_count: mentions.length, derived_constraints: Object.keys(constraints), unsupported_legacy_fields: [] } };
}

module.exports = { COMPACT_SCHEMA, compactUnderstandingJsonSchema, compactToProviderV1 };
