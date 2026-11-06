'use strict';

// Observabilidad estructural para la ruta diagnóstica V4. Este módulo nunca
// conserva texto, valores de menciones, prompts ni respuestas del proveedor.
// Solo deriva categorías cerradas a partir de objetos ya presentes en memoria.

const VERSION = 'yarbi.v4.temporal-diagnostic.v1';
const STAGE_ORDER = ['provider_input', 'v4_normalize', 'v4_hardener', 'v4_v1_adapter', 'v1_normalize', 'v3_hardener', 'semantic_evaluation'];
const STAGES = new Set(STAGE_ORDER);
const REASONS = new Set([
  'TEMPORAL_ATTRIBUTE_MISSING', 'TEMPORAL_ATTRIBUTE_INCONSISTENT', 'TEMPORAL_REFERENCE_UNVERIFIED',
  'TEMPORAL_POLARITY_AMBIGUOUS', 'TEMPORAL_NORMALIZATION_REJECTED', 'TEMPORAL_HARDENER_REJECTED',
  'TEMPORAL_ADAPTER_REJECTED', 'TEMPORAL_DOWNSTREAM_NOT_REACHED', 'TEMPORAL_VERIFICATION_PASSED',
  'PROVIDER_UNAVAILABLE', 'STRUCTURAL_VALIDATION_FAILED', 'DIAGNOSTIC_REASON_NOT_PROVEN'
]);
const DAY_PARTS = new Set(['morning', 'afternoon', 'night']);
const POLARITIES = new Set(['affirmed', 'negated']);
const PROVENANCE = new Set(['utterance', 'conversation_state', 'unverified', 'unknown']);
const DECISIONS = new Set(['observed', 'accepted', 'rejected', 'abstained', 'not_executed']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function safeEnum(value, allowed, fallback = null) { return allowed.has(value) ? value : fallback; }
function isTemporal(item) { return object(item).kind === 'temporal_reference'; }
function temporalCategory(value) {
  const item = normalized(value);
  if (item === 'hoy') return 'today';
  if (item === 'ayer') return 'yesterday';
  if (item === 'manana') return 'tomorrow';
  if (item) return 'other_or_unverified';
  return 'missing';
}
function dayBucket(value) {
  if (value === undefined || value === null) return 'not_provided';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'invalid';
  if (value === 0) return 'day_0';
  if (value === 1) return 'day_1';
  return 'out_of_adapter_range';
}
function localMention(item, index, stage, decision = 'observed') {
  const source = object(item); const verified = source.provenance?.verified;
  const provenance = verified === true ? safeEnum(source.provenance?.source, PROVENANCE, 'unknown') : verified === false ? 'unverified' : safeEnum(source.source || source.claimed_source, PROVENANCE, 'unknown');
  const attrs = object(source.verified_attributes);
  const rawDayPart = attrs.day_part ?? source.day_part;
  const dayPart = safeEnum(rawDayPart, DAY_PARTS, null);
  const rawDays = Object.hasOwn(attrs, 'days') ? attrs.days : source.days;
  const issueCodes = Array.isArray(source.attribute_issues) ? source.attribute_issues : [];
  const structuralValid = issueCodes.length === 0 && dayBucket(rawDays) !== 'invalid';
  return {
    local_mention_id: `tm_${index + 1}`,
    stage,
    reference_category: temporalCategory(source.value),
    attribute_types: [rawDays !== undefined ? 'days' : null, rawDayPart !== undefined ? 'day_part' : null, source.present !== undefined ? 'present' : null].filter(Boolean),
    relative_day_bucket: dayBucket(rawDays),
    day_part: dayPart,
    polarity: safeEnum(source.polarity, POLARITIES, 'unknown'),
    provenance,
    structural_valid: structuralValid,
    decision: safeEnum(decision, DECISIONS, 'observed')
  };
}
function temporalMentions(source, stage, decision) {
  const mentions = Array.isArray(source?.mentions) ? source.mentions.filter(isTemporal) : [];
  return mentions.slice(0, 12).map((item, index) => localMention(item, index, stage, decision));
}
function stage(name, executed, decision, reason, mentions = []) {
  return {
    stage: STAGES.has(name) ? name : 'semantic_evaluation',
    executed: executed === true,
    decision: safeEnum(decision, DECISIONS, executed ? 'observed' : 'not_executed'),
    reason: REASONS.has(reason) ? reason : 'DIAGNOSTIC_REASON_NOT_PROVEN',
    temporal_mentions: Array.isArray(mentions) ? mentions.slice(0, 12) : []
  };
}
function hasTemporal(input) { return temporalMentions(input, 'provider_input').length > 0; }
function hardenerReason(value) {
  const mentions = temporalMentions(value, 'v4_hardener');
  if (!mentions.length) return 'DIAGNOSTIC_REASON_NOT_PROVEN';
  const raw = Array.isArray(value?.mentions) ? value.mentions.filter(isTemporal) : [];
  if (raw.some(item => Array.isArray(item.attribute_issues) && item.attribute_issues.length)) return 'TEMPORAL_ATTRIBUTE_INCONSISTENT';
  if (raw.some(item => item.provenance?.verified === false)) return 'TEMPORAL_REFERENCE_UNVERIFIED';
  if (raw.some(item => ['explicit_conflict', 'scope_ambiguous', 'negation_not_evident'].includes(item.polarity_guard?.status))) return 'TEMPORAL_POLARITY_AMBIGUOUS';
  return 'DIAGNOSTIC_REASON_NOT_PROVEN';
}

function createTemporalDiagnostic(raw) {
  const stages = [];
  const inputMentions = temporalMentions(raw, 'provider_input');
  stages.push(stage('provider_input', true, inputMentions.length ? 'observed' : 'accepted', inputMentions.length ? 'TEMPORAL_VERIFICATION_PASSED' : 'DIAGNOSTIC_REASON_NOT_PROVEN', inputMentions));
  return {
    observeV4Normalize(result) {
      const mentions = result?.ok ? temporalMentions(result.value, 'v4_normalize') : [];
      stages.push(stage('v4_normalize', true, result?.ok ? 'accepted' : 'rejected', result?.ok ? (mentions.length ? 'TEMPORAL_VERIFICATION_PASSED' : 'DIAGNOSTIC_REASON_NOT_PROVEN') : hasTemporal(raw) ? 'TEMPORAL_NORMALIZATION_REJECTED' : 'STRUCTURAL_VALIDATION_FAILED', mentions));
    },
    observeV4Hardener(result) {
      const mentions = result?.ok ? temporalMentions(result.value, 'v4_hardener') : [];
      const requiresClarification = result?.value?.plan?.requires_clarification === true;
      stages.push(stage('v4_hardener', true, !result?.ok ? 'rejected' : requiresClarification ? 'abstained' : 'accepted', !result?.ok ? 'TEMPORAL_HARDENER_REJECTED' : requiresClarification ? hardenerReason(result.value) : mentions.length ? 'TEMPORAL_VERIFICATION_PASSED' : 'DIAGNOSTIC_REASON_NOT_PROVEN', mentions));
    },
    observeAdapter(result, hardened) {
      const mentions = temporalMentions(hardened?.value, 'v4_v1_adapter');
      stages.push(stage('v4_v1_adapter', true, result?.ok ? 'accepted' : 'rejected', result?.ok ? (mentions.length ? 'TEMPORAL_VERIFICATION_PASSED' : 'DIAGNOSTIC_REASON_NOT_PROVEN') : mentions.length ? 'TEMPORAL_ADAPTER_REJECTED' : 'DIAGNOSTIC_REASON_NOT_PROVEN', mentions));
    },
    observeV1(result, adapted) {
      const clues = Array.isArray(result?.value?.temporal_clues) ? result.value.temporal_clues.map((item, index) => localMention({ kind: 'temporal_reference', ...item }, index, 'v1_normalize', result?.ok ? 'accepted' : 'rejected')) : [];
      stages.push(stage('v1_normalize', adapted?.ok === true, result?.ok ? 'accepted' : adapted?.ok ? 'rejected' : 'not_executed', result?.ok ? (clues.length ? 'TEMPORAL_VERIFICATION_PASSED' : 'DIAGNOSTIC_REASON_NOT_PROVEN') : adapted?.ok ? 'STRUCTURAL_VALIDATION_FAILED' : 'TEMPORAL_DOWNSTREAM_NOT_REACHED', clues));
    },
    observeV3(result, normalizedV1) {
      const clues = Array.isArray(result?.temporal_clues) ? result.temporal_clues.map((item, index) => localMention({ kind: 'temporal_reference', ...item }, index, 'v3_hardener', 'accepted')) : [];
      stages.push(stage('v3_hardener', normalizedV1?.ok === true, normalizedV1?.ok ? 'accepted' : 'not_executed', normalizedV1?.ok ? (clues.length ? 'TEMPORAL_VERIFICATION_PASSED' : 'DIAGNOSTIC_REASON_NOT_PROVEN') : 'TEMPORAL_DOWNSTREAM_NOT_REACHED', clues));
    },
    observeEvaluation(semantic) {
      const safeOutcome = semantic?.safe_outcome;
      const decision = semantic?.semantic_pass === true ? 'accepted' : safeOutcome === 'abstained' ? 'abstained' : 'rejected';
      const reason = safeOutcome === 'abstained' ? 'DIAGNOSTIC_REASON_NOT_PROVEN' : semantic?.semantic_pass === true ? 'TEMPORAL_VERIFICATION_PASSED' : 'DIAGNOSTIC_REASON_NOT_PROVEN';
      stages.push(stage('semantic_evaluation', true, decision, reason));
    },
    finish() {
      const observed = new Map(stages.map(item => [item.stage, item]));
      return { schema: VERSION, stages: STAGE_ORDER.map(name => observed.get(name) || stage(name, false, 'not_executed', 'TEMPORAL_DOWNSTREAM_NOT_REACHED')) };
    }
  };
}

function providerUnavailableTemporalDiagnostic() {
  return {
    schema: VERSION,
    stages: STAGE_ORDER.map((name, index) => stage(name, false, 'not_executed', index === 0 ? 'PROVIDER_UNAVAILABLE' : 'TEMPORAL_DOWNSTREAM_NOT_REACHED'))
  };
}

function sanitizeTemporalDiagnostic(value) {
  const source = object(value); if (source.schema !== VERSION || !Array.isArray(source.stages)) return null;
  const sanitizedStages = source.stages.filter(item => STAGES.has(item?.stage)).slice(0, 7).map(item => {
    const mentions = Array.isArray(item?.temporal_mentions) ? item.temporal_mentions.map((mention, index) => ({
      local_mention_id: `tm_${index + 1}`,
      reference_category: ['today', 'yesterday', 'tomorrow', 'other_or_unverified', 'missing'].includes(mention?.reference_category) ? mention.reference_category : 'missing',
      attribute_types: Array.isArray(mention?.attribute_types) ? mention.attribute_types.filter(type => ['days', 'day_part', 'present'].includes(type)).slice(0, 3) : [],
      relative_day_bucket: ['not_provided', 'invalid', 'day_0', 'day_1', 'out_of_adapter_range'].includes(mention?.relative_day_bucket) ? mention.relative_day_bucket : 'not_provided',
      day_part: safeEnum(mention?.day_part, DAY_PARTS, null),
      polarity: safeEnum(mention?.polarity, POLARITIES, 'unknown'),
      provenance: safeEnum(mention?.provenance, PROVENANCE, 'unknown'),
      structural_valid: mention?.structural_valid === true,
      decision: safeEnum(mention?.decision, DECISIONS, 'observed')
    })) : [];
    return stage(item.stage, item.executed === true, item.decision, item.reason, mentions);
  });
  return {
    schema: VERSION,
    stages: sanitizedStages
  };
}

module.exports = { VERSION, REASONS, createTemporalDiagnostic, providerUnavailableTemporalDiagnostic, sanitizeTemporalDiagnostic };
