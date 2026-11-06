'use strict';

const { inspectCommercialEvidence } = require('./yarbi-commercial-context');

const MEMORY_TYPES = Object.freeze([
  'service',
  'district',
  'location',
  'pending_step',
  'visit',
  'customer_commitment',
  'business_commitment',
  'objection'
]);
const MEMORY_SOURCES = Object.freeze([
  'verified_webhook',
  'operator_verified',
  'structured_context',
  'internal_event'
]);
const TRUSTED_FACT = Symbol('yarbi.operational-memory.trusted-fact');
const TRUSTED_RESOLUTION = Symbol('yarbi.operational-memory.trusted-resolution');

function text(value, limit = 160) {
  return String(value ?? '').trim().slice(0, limit);
}

function isoTimestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function memoryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function trustedFact({ source, memoryType, memoryKey = 'current', value, sourceMessageId = null, sourceEventId = null, occurredAt } = {}) {
  const normalizedSource = text(source, 48);
  const normalizedType = text(memoryType, 48);
  const normalizedKey = text(memoryKey, 120);
  const normalizedValue = normalizeValue(value);
  const normalizedMessageId = text(sourceMessageId, 240) || null;
  const normalizedEventId = text(sourceEventId, 240) || null;
  const normalizedOccurredAt = isoTimestamp(occurredAt);
  if (!MEMORY_SOURCES.includes(normalizedSource)
    || !MEMORY_TYPES.includes(normalizedType)
    || !normalizedKey
    || !normalizedValue
    || !normalizedOccurredAt
    || (!normalizedMessageId && !normalizedEventId)) return null;
  return Object.freeze({
    [TRUSTED_FACT]: true,
    source: normalizedSource,
    memory_type: normalizedType,
    memory_key: normalizedKey,
    value: normalizedValue,
    source_message_id: normalizedMessageId,
    source_event_id: normalizedEventId,
    occurred_at: normalizedOccurredAt
  });
}

function createVerifiedOperatorOperationalFact({ operatorVerified, memoryType, memoryKey = 'current', value, eventId, messageId = null, occurredAt } = {}) {
  if (operatorVerified !== true) return null;
  return trustedFact({
    source: 'operator_verified', memoryType, memoryKey, value,
    sourceEventId: eventId, sourceMessageId: messageId, occurredAt
  });
}

function createVerifiedOperatorMemoryResolution({ operatorVerified, memoryType, memoryKey = 'current', eventId, messageId = null, occurredAt } = {}) {
  if (operatorVerified !== true) return null;
  const normalizedType = text(memoryType, 48);
  const normalizedKey = text(memoryKey, 120);
  const normalizedEventId = text(eventId, 240);
  const normalizedOccurredAt = isoTimestamp(occurredAt);
  if (!MEMORY_TYPES.includes(normalizedType) || !normalizedKey || !normalizedEventId || !normalizedOccurredAt) return null;
  return Object.freeze({
    [TRUSTED_RESOLUTION]: true,
    memory_type: normalizedType,
    memory_key: normalizedKey,
    source_message_id: text(messageId, 240) || null,
    source_event_id: normalizedEventId,
    occurred_at: normalizedOccurredAt
  });
}

function sourceForCommercialEvidence(evidence) {
  if (evidence?.origin === 'interactive_service_selection') return 'verified_webhook';
  if (evidence?.origin === 'operator_verified') return 'operator_verified';
  return 'structured_context';
}

function deriveOperationalFactsFromCommercialEvidence(message = {}) {
  const inspected = inspectCommercialEvidence(message);
  if (inspected.state !== 'accepted' || !inspected.evidence) return [];
  const evidence = inspected.evidence;
  const source = sourceForCommercialEvidence(evidence);
  const shared = {
    source,
    sourceMessageId: text(message.id, 240) || null,
    sourceEventId: evidence.event_id,
    occurredAt: evidence.occurred_at
  };
  const facts = [];
  if (evidence.service && evidence.service !== 'unknown') {
    const fact = trustedFact({ ...shared, memoryType: 'service', value: { service: evidence.service } });
    if (fact) facts.push(fact);
  }
  if (evidence.visit_requested === true) {
    const visit = trustedFact({ ...shared, memoryType: 'visit', value: { requested: true } });
    const pending = trustedFact({ ...shared, memoryType: 'pending_step', value: { step: 'visit_requested' } });
    if (visit) facts.push(visit);
    if (pending) facts.push(pending);
  }
  return facts;
}

async function upsertOperationalMemory({ supabase, contactId, fact } = {}) {
  if (typeof supabase !== 'function') throw memoryError('operational_memory_store_unavailable');
  if (!Number.isInteger(Number(contactId)) || Number(contactId) <= 0 || !fact?.[TRUSTED_FACT]) {
    throw memoryError('operational_memory_fact_untrusted');
  }
  const result = await supabase('/rest/v1/rpc/upsert_yarbi_contact_operational_memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_contact_id: Number(contactId),
      p_memory_type: fact.memory_type,
      p_memory_key: fact.memory_key,
      p_value: fact.value,
      p_source: fact.source,
      p_source_message_id: fact.source_message_id,
      p_source_event_id: fact.source_event_id,
      p_occurred_at: fact.occurred_at
    })
  });
  if (!result?.response?.ok) throw memoryError('operational_memory_upsert_failed');
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row?.outcome) throw memoryError('operational_memory_invalid_result');
  return row;
}

async function resolveOperationalMemory({ supabase, contactId, resolution } = {}) {
  if (typeof supabase !== 'function') throw memoryError('operational_memory_store_unavailable');
  if (!Number.isInteger(Number(contactId)) || Number(contactId) <= 0 || !resolution?.[TRUSTED_RESOLUTION]) {
    throw memoryError('operational_memory_resolution_untrusted');
  }
  const result = await supabase('/rest/v1/rpc/resolve_yarbi_contact_operational_memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_contact_id: Number(contactId),
      p_memory_type: resolution.memory_type,
      p_memory_key: resolution.memory_key,
      p_source_message_id: resolution.source_message_id,
      p_source_event_id: resolution.source_event_id,
      p_occurred_at: resolution.occurred_at
    })
  });
  if (!result?.response?.ok) throw memoryError('operational_memory_resolution_failed');
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row?.outcome) throw memoryError('operational_memory_invalid_result');
  return row;
}

function emptyContactOperationalMemory(contactId) {
  return {
    contact_id: Number(contactId),
    service: null,
    district: null,
    location: null,
    pending_step: null,
    visit: null,
    customer_commitment: null,
    business_commitment: null,
    objection: null
  };
}

async function getContactOperationalMemory({ supabase, contactId } = {}) {
  if (typeof supabase !== 'function') throw memoryError('operational_memory_store_unavailable');
  const normalizedContactId = Number(contactId);
  if (!Number.isInteger(normalizedContactId) || normalizedContactId <= 0) throw memoryError('operational_memory_contact_invalid');
  const result = await supabase('/rest/v1/yarbi_contact_operational_memory?contact_id=eq.' + encodeURIComponent(String(normalizedContactId))
    + '&state=eq.active&select=memory_type,memory_key,value,occurred_at&order=occurred_at.desc&limit=16');
  if (!result?.response?.ok) throw memoryError('operational_memory_read_failed');
  const context = emptyContactOperationalMemory(normalizedContactId);
  for (const row of (Array.isArray(result.data) ? result.data : [])) {
    if (!MEMORY_TYPES.includes(row?.memory_type) || context[row.memory_type] !== null) continue;
    context[row.memory_type] = normalizeValue(row.value);
  }
  return context;
}

// Variante acotada para procesos de fondo: una sola lectura para todos los
// contactos solicitados, conservando el mismo contrato de memoria activa.
async function getContactOperationalMemories({ supabase, contactIds } = {}) {
  if (typeof supabase !== 'function') throw memoryError('operational_memory_store_unavailable');
  const ids = [...new Set((Array.isArray(contactIds) ? contactIds : []).map(Number)
    .filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const filter = ids.join(',');
  const result = await supabase('/rest/v1/yarbi_contact_operational_memory?contact_id=in.(' + encodeURIComponent(filter)
    + ')&state=eq.active&select=contact_id,memory_type,memory_key,value,occurred_at&order=contact_id.asc,occurred_at.desc&limit=' + Math.min(ids.length * 16, 800));
  if (!result?.response?.ok) throw memoryError('operational_memory_read_failed');
  const contexts = new Map(ids.map(id => [id, emptyContactOperationalMemory(id)]));
  for (const row of (Array.isArray(result.data) ? result.data : [])) {
    const context = contexts.get(Number(row?.contact_id));
    if (!context || !MEMORY_TYPES.includes(row?.memory_type) || context[row.memory_type] !== null) continue;
    context[row.memory_type] = normalizeValue(row.value);
  }
  return contexts;
}

module.exports = {
  MEMORY_SOURCES,
  MEMORY_TYPES,
  createVerifiedOperatorMemoryResolution,
  createVerifiedOperatorOperationalFact,
  deriveOperationalFactsFromCommercialEvidence,
  emptyContactOperationalMemory,
  getContactOperationalMemories,
  getContactOperationalMemory,
  resolveOperationalMemory,
  upsertOperationalMemory
};
