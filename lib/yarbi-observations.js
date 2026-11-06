const { createHash } = require('node:crypto');

const OBSERVATION_TYPES = new Set(['fact', 'signal', 'inference']);

function clampText(value, max) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeCategory(value) {
  return clampText(value, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeConfidence(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function normalizeSourceMessageIds(value, allowedIds) {
  const allowed = allowedIds instanceof Set ? allowedIds : new Set((allowedIds || []).map(String));
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(item => clampText(item, 160))
    .filter(item => item && allowed.has(item))))
    .slice(0, 12);
}

function normalizeObservationItems(value, type, allowedIds) {
  if (!OBSERVATION_TYPES.has(type)) return [];
  const fallbackConfidence = type === 'fact' ? 1 : type === 'signal' ? 0.8 : 0.6;
  return (Array.isArray(value) ? value : []).map(item => {
    const category = normalizeCategory(item?.category);
    const observationValue = clampText(item?.value, 500);
    const sourceMessageIds = normalizeSourceMessageIds(item?.source_message_ids, allowedIds);
    if (!category || !observationValue || !sourceMessageIds.length) return null;
    return {
      observation_type: type,
      category,
      value: observationValue,
      source_message_ids: sourceMessageIds,
      confidence: normalizeConfidence(item?.confidence, fallbackConfidence)
    };
  }).filter(Boolean).slice(0, 12);
}

function normalizeObservationBundle(value, messageIds) {
  const allowedIds = new Set((messageIds || []).map(String));
  const source = value && typeof value === 'object' ? value : {};
  return {
    facts: normalizeObservationItems(source.facts, 'fact', allowedIds),
    signals: normalizeObservationItems(source.signals, 'signal', allowedIds),
    inferences: normalizeObservationItems(source.inferences, 'inference', allowedIds)
  };
}

function observationDedupeKey(contactId, item) {
  const stable = JSON.stringify({
    contact_id: Number(contactId),
    observation_type: item.observation_type,
    category: item.category,
    value: item.value.toLowerCase(),
    source_message_ids: [...item.source_message_ids].sort()
  });
  return 'obs:' + createHash('sha256').update(stable).digest('hex');
}

function buildObservationRows({ contactId, analysisId, processingRunId, observations, observedAt }) {
  const source = observations && typeof observations === 'object' ? observations : {};
  const items = [...(source.facts || []), ...(source.signals || []), ...(source.inferences || [])];
  return items.map(item => ({
    contact_id: Number(contactId),
    analysis_id: Number.isFinite(Number(analysisId)) ? Number(analysisId) : null,
    processing_run_id: Number.isFinite(Number(processingRunId)) ? Number(processingRunId) : null,
    observation_type: item.observation_type,
    category: item.category,
    value: item.value,
    source_message_ids: item.source_message_ids,
    confidence: item.confidence,
    status: 'active',
    observed_at: observedAt || new Date().toISOString(),
    dedupe_key: observationDedupeKey(contactId, item)
  }));
}

module.exports = {
  buildObservationRows,
  normalizeObservationBundle,
  observationDedupeKey
};
