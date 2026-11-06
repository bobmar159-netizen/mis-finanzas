'use strict';

// Propuesta local no conectada a rutas activas. Conserva intención lingüística
// antes de reducirla al contrato que consumen los resolvedores actuales.
const PROPOSED_SCHEMA = 'yarbi.owner-understanding.v4';
const LEGACY_SCHEMA = 'yarbi.owner-understanding.v1';
const INTENTS = new Set(['reference_lookup', 'open_client', 'continue_task', 'cancel', 'clarify', 'general']);
const ACTS = new Set(['request', 'correction', 'confirmation', 'cancellation', 'continuation', 'clarification', 'unknown']);
const TARGETS = new Set(['contact', 'service', 'agenda', 'operation', 'unknown', 'none']);
const KINDS = new Set(['proper_name', 'service_reference', 'location_reference', 'temporal_reference', 'generic_reference', 'anaphoric_reference', 'unknown']);
const POLARITIES = new Set(['affirmed', 'negated']);
const CERTAINTIES = new Set(['confirmed', 'approximate', 'inferred']);
const CLAIMED_SOURCES = new Set(['utterance', 'conversation_state', 'unknown']);
const CORRECTIONS = new Set(['none', 'discard_active_entity', 'replace_previous', 'select_alternative']);
const CONTINUITIES = new Set(['none', 'active_entity', 'last_proposed_entity']);
const CANCELS = new Set(['task', 'operation', 'agenda', 'unknown', 'none']);
const DAY_PARTS = new Set(['morning', 'afternoon', 'night']);

function plain(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function keysExactly(value, allowed, required = allowed) { if (!plain(value)) return false; const actual = Object.keys(value); return required.every(key => actual.includes(key)) && actual.every(key => allowed.includes(key)); }
function string(value, limit = 120) { return typeof value === 'string' && value.length > 0 && value.length <= limit && value === value.trim() ? value : null; }
function enumValue(value, values) { const raw = string(value, 64); return raw && values.has(raw) ? raw : null; }
function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function phrasePresent(utterance, value) { const needle = normalized(value); return Boolean(needle && ` ${normalized(utterance)} `.includes(` ${needle} `)); }
function stateValue(state, kind) { const value = plain(state?.active_constraints?.[kind]) ? state.active_constraints[kind].value : state?.active_constraints?.[kind]; return string(value, 120); }
function comparableKind(kind) { return ({ proper_name: 'name', service_reference: 'service', location_reference: 'location', temporal_reference: 'recency' })[kind] || null; }
function cancellationNegated(utterance) { return /\bno\s+(?:(?:quiero(?:\s+que)?|vayas\s+a|se\s+debe)\s+)?cancel(?:es|ar|en|arlo|arla)?\b/.test(normalized(utterance)); }
function cancellationScopeAmbiguous(utterance) { const value = normalized(utterance); return /\bcancel/.test(value) && /\b(anterior|previa)\b/.test(value) && /\bno\s+(la\s+)?nueva\b/.test(value); }
function legacyNegationOrUnresolvedCorrection(utterance) { const value = normalized(utterance); return /\bno\b/.test(value) || /\b(era|referia|corregir|mejor dicho)\b/.test(value); }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function mentionNegatedInUtterance(mention, utterance) {
  const value = normalized(mention.value); if (!value) return false;
  const escaped = escapeRegex(value);
  const source = normalized(utterance);
  return new RegExp(`\\b(?:no\\s+(?:(?:era|es|fue)\\s+)?(?:(?:en|el|la|los|las)\\s+)?|nunca\\s+fue\\s+|no\\s+quiero\\s+(?:a\\s+)?)${escaped}\\b|\\b${escaped}\\s+no(?:\\s+(?:era|es|fue))?\\b`).test(source);
}
function correctionLanguagePresent(utterance) { return /\b(no\s+(?:era|fue)|era|me\s+referia|mejor\s+dicho|en\s+vez\s+de)\b|\b\S+\s+no\s*,?\s*\S+\s+si\b/.test(normalized(utterance)); }
function hasExplicitNegation(utterance) { return /\b(no|nunca)\b/.test(normalized(utterance)); }
function deriveAttributes(mention, utterance) {
  const issues = []; const attributes = {};
  const source = normalized(utterance); const value = normalized(mention.value);
  const expectedDays = value === 'hoy' ? 0 : value === 'ayer' ? 1 : null;
  if (mention.days !== undefined) {
    if (expectedDays === null || mention.days !== expectedDays || !phrasePresent(utterance, mention.value)) issues.push('days_not_verifiable');
    else attributes.days = expectedDays;
  }
  const expectedPart = /\b(por la tarde|esta tarde|en la tarde)\b/.test(source) ? 'afternoon'
    : /\b(por la manana|esta manana|en la manana)\b/.test(source) ? 'morning'
      : /\b(por la noche|esta noche|en la noche|anoche)\b/.test(source) ? 'night' : null;
  if (mention.day_part !== undefined) {
    if (!expectedPart || mention.day_part !== expectedPart || !phrasePresent(utterance, mention.value)) issues.push('day_part_not_verifiable');
    else attributes.day_part = expectedPart;
  }
  // `present` no se promueve a filtro: una palabra como "ubicación" no prueba
  // que exista, ni que falte, una ubicación o visita utilizable.
  if (mention.present !== undefined) issues.push('present_not_verifiable');
  return { attributes, issues };
}

function proposedJsonSchema() {
  return { type: 'object', additionalProperties: false, required: ['schema', 'intent', 'conversational_act', 'target_type', 'mentions', 'control', 'confidence', 'ambiguity', 'missing_information'], properties: {
    schema: { type: 'string', enum: [PROPOSED_SCHEMA] },
    intent: { type: 'string', enum: [...INTENTS] }, conversational_act: { type: 'string', enum: [...ACTS] }, target_type: { type: 'string', enum: [...TARGETS] },
    mentions: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['kind', 'value', 'polarity', 'certainty', 'claimed_source'], properties: {
      kind: { type: 'string', enum: [...KINDS] }, value: { type: 'string', minLength: 1, maxLength: 120 }, polarity: { type: 'string', enum: [...POLARITIES] }, certainty: { type: 'string', enum: [...CERTAINTIES] }, claimed_source: { type: 'string', enum: [...CLAIMED_SOURCES] },
      attributes: { type: 'object', additionalProperties: false, properties: { days: { type: 'number', minimum: 0, maximum: 3650 }, day_part: { type: 'string', enum: [...DAY_PARTS] }, present: { type: 'boolean' } } }
    } } },
    control: { type: 'object', additionalProperties: false, required: ['correction', 'continuation', 'cancel_scope'], properties: { correction: { type: 'string', enum: [...CORRECTIONS] }, continuation: { type: 'string', enum: [...CONTINUITIES] }, cancel_scope: { type: 'string', enum: [...CANCELS] } } },
    confidence: { type: 'number', minimum: 0, maximum: 1 }, ambiguity: { type: 'boolean' }, missing_information: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 80 } }
  } };
}

function validateMention(raw) {
  const allowed = ['kind', 'value', 'polarity', 'certainty', 'claimed_source', 'attributes'];
  if (!keysExactly(raw, allowed, ['kind', 'value', 'polarity', 'certainty', 'claimed_source'])) return null;
  const kind = enumValue(raw.kind, KINDS); const value = string(raw.value, 120); const polarity = enumValue(raw.polarity, POLARITIES); const certainty = enumValue(raw.certainty, CERTAINTIES); const claimed_source = enumValue(raw.claimed_source, CLAIMED_SOURCES);
  if (!kind || !value || !polarity || !certainty || !claimed_source) return null;
  const out = { kind, value, polarity, certainty, claimed_source };
  if (raw.attributes !== undefined) {
    if (!keysExactly(raw.attributes, ['days', 'day_part', 'present'], [])) return null;
    if (raw.attributes.days !== undefined) { if (typeof raw.attributes.days !== 'number' || !Number.isFinite(raw.attributes.days) || raw.attributes.days < 0 || raw.attributes.days > 3650) return null; out.days = raw.attributes.days; }
    if (raw.attributes.day_part !== undefined) { const part = enumValue(raw.attributes.day_part, DAY_PARTS); if (!part) return null; out.day_part = part; }
    if (raw.attributes.present !== undefined) { if (typeof raw.attributes.present !== 'boolean') return null; out.present = raw.attributes.present; }
  }
  return out;
}

function verifySource(mention, utterance, state) {
  // `claimed_source` sólo se conserva como diagnóstico; el resultado útil se
  // deriva localmente desde frase o estado real.
  if (phrasePresent(utterance, mention.value)) return { verified: true, source: 'utterance' };
  const stateKey = comparableKind(mention.kind);
  if (stateKey && normalized(stateValue(state, stateKey)) === normalized(mention.value)) return { verified: true, source: 'conversation_state' };
  return { verified: false, source: 'unverified' };
}

function assessPolarityConsistency(mention, utterance) {
  const textNegates = mentionNegatedInUtterance(mention, utterance);
  if (mention.polarity === 'affirmed' && textNegates) return { status: 'explicit_conflict', reason: 'utterance_negates_affirmed_mention' };
  if (mention.polarity === 'negated' && textNegates) return { status: 'verified_negation', reason: null };
  if (mention.polarity === 'negated') return { status: hasExplicitNegation(utterance) ? 'scope_ambiguous' : 'negation_not_evident', reason: 'negation_scope_not_verifiable' };
  // Una negación dirigida a otra mención no invalida una afirmación cuya
  // presencia y procedencia ya se verificaron por separado. Este estado no
  // "confirma" semánticamente la afirmación: solo constata que no hay un
  // conflicto detectable para esta mención concreta.
  return { status: 'no_detectable_conflict', reason: null };
}

function usableAffirmation(item) { return item.polarity === 'affirmed' && item.provenance.verified && ['no_detectable_conflict', 'negation_elsewhere'].includes(item.polarity_guard.status) && item.attribute_issues.length === 0; }
function usableNegation(item) { return item.polarity === 'negated' && item.provenance.verified && item.polarity_guard.status === 'verified_negation'; }

function correctionAssessment(mentions, state, correction, utterance) {
  const negatives = mentions.filter(item => usableNegation(item) && comparableKind(item.kind));
  const positives = mentions.filter(item => usableAffirmation(item) && comparableKind(item.kind));
  if (correction === 'none') return { valid: true, pairs: [], reasons: [] };
  if (correction === 'replace_previous') {
    if (!correctionLanguagePresent(utterance)) return { valid: false, pairs: [], reasons: ['correction_language_missing'] };
    if (negatives.length === 1 && positives.length === 1 && comparableKind(negatives[0].kind) !== comparableKind(positives[0].kind)) return { valid: false, pairs: [], reasons: ['correction_dimension_mismatch'] };
    const pairs = [];
    for (const dimension of ['name', 'service', 'location', 'recency']) {
      const discarded = negatives.filter(item => comparableKind(item.kind) === dimension);
      const replacements = positives.filter(item => comparableKind(item.kind) === dimension);
      if (!discarded.length || !replacements.length) continue;
      const active = stateValue(state, dimension);
      const relevantDiscarded = active ? discarded.filter(item => normalized(item.value) === normalized(active)) : discarded;
      if (relevantDiscarded.length === 1 && replacements.length === 1) pairs.push({ dimension, previous: relevantDiscarded[0], replacement: replacements[0], active_value: active || null });
    }
    if (pairs.length !== 1) return { valid: false, pairs: [], reasons: ['correction_pair_missing_or_ambiguous'] };
    return { valid: true, pairs, reasons: [] };
  }
  if (correction === 'discard_active_entity') {
    if (negatives.length !== 1 || positives.length) return { valid: false, pairs: [], reasons: ['discard_active_entity_ambiguous'] };
    const dimension = comparableKind(negatives[0].kind); const active = stateValue(state, dimension);
    if (!active || normalized(active) !== normalized(negatives[0].value)) return { valid: false, pairs: [], reasons: ['discarded_value_not_active'] };
    return { valid: true, pairs: [], reasons: [] };
  }
  // `select_alternative` conserva el control, pero nunca autoriza una
  // selección ni crea restricciones que el backend no pueda verificar.
  return { valid: true, pairs: [], reasons: [] };
}

function contradictionFor(mention, state, correctionPairs) {
  const key = comparableKind(mention.kind); const prior = key ? stateValue(state, key) : null;
  if (!prior || normalized(prior) === normalized(mention.value)) return null;
  if (correctionPairs.some(pair => pair.dimension === key && normalized(pair.replacement.value) === normalized(mention.value) && normalized(pair.previous.value) === normalized(prior))) return { dimension: key, previous_value: prior, current_value: mention.value, status: 'resolved_by_correction' };
  return { dimension: key, previous_value: prior, current_value: mention.value, status: 'unresolved' };
}

function strictNormalizeProposed(raw) {
  const allowed = ['schema', 'intent', 'conversational_act', 'target_type', 'mentions', 'control', 'confidence', 'ambiguity', 'missing_information'];
  if (!keysExactly(raw, allowed)) return { ok: false, code: 'proposed_contract_shape_invalid' };
  if (raw.schema !== PROPOSED_SCHEMA || !enumValue(raw.intent, INTENTS) || !enumValue(raw.conversational_act, ACTS) || !enumValue(raw.target_type, TARGETS) || typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1 || typeof raw.ambiguity !== 'boolean' || !Array.isArray(raw.mentions) || raw.mentions.length > 12 || !Array.isArray(raw.missing_information) || raw.missing_information.length > 8) return { ok: false, code: 'proposed_contract_invalid' };
  if (!keysExactly(raw.control, ['correction', 'continuation', 'cancel_scope'])) return { ok: false, code: 'proposed_control_invalid' };
  const correction = enumValue(raw.control.correction, CORRECTIONS); const continuation = enumValue(raw.control.continuation, CONTINUITIES); const cancel_scope = enumValue(raw.control.cancel_scope, CANCELS);
  if (!correction || !continuation || !cancel_scope || raw.missing_information.some(item => !string(item, 80))) return { ok: false, code: 'proposed_control_invalid' };
  const mentions = raw.mentions.map(validateMention); if (mentions.some(item => !item)) return { ok: false, code: 'proposed_mention_invalid' };
  return { ok: true, value: { schema: PROPOSED_SCHEMA, intent: raw.intent, conversational_act: raw.conversational_act, target_type: raw.target_type, mentions, control: { correction, continuation, cancel_scope }, confidence: raw.confidence, ambiguity: raw.ambiguity, missing_information: raw.missing_information.slice() } };
}

// La normalización estricta aplana `attributes`; el hardener recibe
// normalmente esa salida. La volvemos a expresar en la forma de entrada y la
// validamos otra vez, sin aceptar campos ni tipos nuevos.
function strictForHardening(understanding) {
  if (!plain(understanding) || !Array.isArray(understanding.mentions)) return strictNormalizeProposed(understanding);
  const rebuilt = {
    ...understanding,
    mentions: understanding.mentions.map(mention => {
      if (!plain(mention)) return mention;
      const { days, day_part, present, ...base } = mention;
      const attributes = {
        ...(days !== undefined ? { days } : {}),
        ...(day_part !== undefined ? { day_part } : {}),
        ...(present !== undefined ? { present } : {})
      };
      return Object.keys(attributes).length ? { ...base, attributes } : base;
    })
  };
  return strictNormalizeProposed(rebuilt);
}

function upgradeLegacyV1(raw, utterance) {
  if (!plain(raw) || raw.schema !== LEGACY_SCHEMA) return { ok: false, code: 'legacy_schema_invalid' };
  if (legacyNegationOrUnresolvedCorrection(utterance)) return { ok: false, code: 'legacy_polarity_ambiguous' };
  const mentions = Array.isArray(raw.entity_mentions) ? raw.entity_mentions.map(item => {
    if (!plain(item)) return null;
    return { kind: item.kind, value: item.value, polarity: 'affirmed', certainty: item.certainty || 'inferred', claimed_source: item.source || 'unknown' };
  }) : [];
  return strictNormalizeProposed({ schema: PROPOSED_SCHEMA, intent: raw.intent || 'general', conversational_act: raw.conversational_act || 'unknown', target_type: raw.target_type || 'unknown', mentions, control: { correction: raw.correction?.replace_previous ? 'replace_previous' : raw.correction?.discard_active_entity ? 'discard_active_entity' : raw.correction?.select_alternative ? 'select_alternative' : 'none', continuation: raw.continuation?.use_active_entity ? 'active_entity' : raw.continuation?.use_last_proposed_entity ? 'last_proposed_entity' : 'none', cancel_scope: raw.cancel_scope || 'none' }, confidence: typeof raw.confidence === 'number' ? raw.confidence : 0, ambiguity: raw.ambiguity === true, missing_information: Array.isArray(raw.missing_information) ? raw.missing_information : [] });
}

function hardenProposed({ understanding, utterance, state = {} } = {}) {
  const normalizedInput = strictForHardening(understanding); if (!normalizedInput.ok) return normalizedInput;
  const source = normalizedInput.value;
  const verified = source.mentions.map(mention => {
    const attributeVerification = deriveAttributes(mention, utterance);
    return { ...mention, provenance: verifySource(mention, utterance, state), polarity_guard: assessPolarityConsistency(mention, utterance), verified_attributes: attributeVerification.attributes, attribute_issues: attributeVerification.issues };
  });
  const correction = correctionAssessment(verified, state, source.control.correction, utterance);
  const negated = verified.filter(item => item.polarity === 'negated');
  const affirmed = verified.filter(usableAffirmation);
  const contradictions = affirmed.map(item => contradictionFor(item, state, correction.pairs)).filter(Boolean);
  const unresolvedContradiction = contradictions.some(item => item.status === 'unresolved');
  const negatedCancellation = cancellationNegated(utterance);
  const ambiguousCancellationScope = !negatedCancellation && source.conversational_act === 'cancellation' && cancellationScopeAmbiguous(utterance);
  const polarityConflict = verified.some(item => ['explicit_conflict', 'scope_ambiguous', 'negation_not_evident'].includes(item.polarity_guard.status));
  const attributesInvalid = verified.some(item => item.attribute_issues.length > 0);
  const unpairedNegation = negated.length > 0 && (source.control.correction === 'none' || !correction.valid || affirmed.length === 0);
  const noActionableConstraint = !affirmed.some(item => comparableKind(item.kind));
  const needsClarification = source.ambiguity || negatedCancellation || ambiguousCancellationScope || !correction.valid || unresolvedContradiction || polarityConflict || attributesInvalid || unpairedNegation || noActionableConstraint;
  const usable = needsClarification || source.control.correction === 'select_alternative' ? [] : affirmed;
  const constraints = {};
  for (const item of usable) {
    const key = comparableKind(item.kind); if (!key || constraints[key]) continue;
    constraints[key] = { value: item.value, certainty: item.certainty, source: item.provenance.source, ...item.verified_attributes };
  }
  const act = negatedCancellation ? 'clarification' : source.conversational_act;
  const cancel_scope = negatedCancellation ? 'none' : source.control.cancel_scope;
  const plan = {
    query_constraints: constraints,
    excluded_constraints: [],
    may_query_candidates: Object.keys(constraints).length > 0 && !needsClarification,
    may_auto_select: false,
    requires_clarification: needsClarification,
    blocked_reasons: [
      ...(negatedCancellation ? ['negated_cancellation'] : []),
      ...(ambiguousCancellationScope ? ['cancellation_scope_ambiguous'] : []),
      ...(!correction.valid ? correction.reasons : []),
      ...(unresolvedContradiction ? ['state_contradiction'] : []),
      ...(source.ambiguity ? ['provider_ambiguity'] : []),
      ...(polarityConflict ? ['polarity_not_verifiable'] : []),
      ...(attributesInvalid ? ['attributes_not_verifiable'] : []),
      ...(unpairedNegation ? ['negation_scope_or_replacement_missing'] : []),
      ...(noActionableConstraint ? ['no_verified_actionable_constraint'] : [])
    ]
  };
  return { ok: true, value: { schema: PROPOSED_SCHEMA, intent: source.intent, conversational_act: act, target_type: source.target_type, mentions: verified, control: { ...source.control, cancel_scope }, contradictions, discarded_mentions: negated, confidence: source.confidence, ambiguity: source.ambiguity, missing_information: source.missing_information, plan } };
}

function diagnoseProposed({ understanding, utterance, state = {} } = {}) {
  const rawMentions = Array.isArray(understanding?.mentions) ? understanding.mentions : null;
  const invalidMentionIndexes = rawMentions ? rawMentions.map((item, index) => validateMention(item) ? null : index).filter(Number.isInteger) : [];
  const strict = strictNormalizeProposed(understanding);
  if (!strict.ok) return { ok: false, stage: 'strict_normalize', code: strict.code, rule_ids: [strict.code], field_paths: invalidMentionIndexes.map(index => `mentions[${index}]`) };
  const hardened = hardenProposed({ understanding: strict.value, utterance, state });
  if (!hardened.ok) return { ok: false, stage: 'v4_hardener', code: hardened.code, rule_ids: [hardened.code], field_paths: [] };
  return { ok: true, stage: 'v4_hardener', code: null, rule_ids: hardened.value.plan.blocked_reasons.slice(), field_paths: [] };
}

module.exports = { PROPOSED_SCHEMA, proposedJsonSchema, strictNormalizeProposed, upgradeLegacyV1, hardenProposed, diagnoseProposed };
