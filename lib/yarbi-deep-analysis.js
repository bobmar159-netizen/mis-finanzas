'use strict';

// DEEP nunca usa memoria de proceso como cola. El adaptador acepta únicamente
// un store durable explícito, para que una futura migración/worker pueda
// conectarlo sin cambiar el router de conversación.
const DEEP_SCHEMA = 'yarbi.deep-analysis-request.v1';
const ALLOWED_KINDS = new Set(['sales_analysis', 'client_comparison', 'profitability', 'conversation_analysis', 'whatsapp_analysis', 'meta_ads_analysis', 'campaign_analysis', 'budget_recommendation']);

function text(value, limit = 160) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function requestKey({ ownerId, kind, idempotencyKey }) { return [String(ownerId || ''), String(kind || ''), text(idempotencyKey, 160)].join(':'); }

async function requestDeepAnalysis({ ownerId, kind, idempotencyKey, payload = {}, durableStore } = {}) {
  const normalizedKind = text(kind, 64);
  if (!String(ownerId || '').trim() || !ALLOWED_KINDS.has(normalizedKind) || !text(idempotencyKey, 160)) {
    return { schema: DEEP_SCHEMA, outcome: 'deep_request_invalid', accepted: false, execute: false };
  }
  if (!durableStore || typeof durableStore.enqueue !== 'function') {
    return { schema: DEEP_SCHEMA, outcome: 'deep_infrastructure_unavailable', accepted: false, execute: false, reason: 'durable_queue_not_verified' };
  }
  const request = { schema: DEEP_SCHEMA, owner_id: String(ownerId), kind: normalizedKind, idempotency_key: requestKey({ ownerId, kind: normalizedKind, idempotencyKey }), payload, execute: false };
  const stored = await durableStore.enqueue(request);
  if (!stored || stored.ok !== true || !stored.job_id) return { schema: DEEP_SCHEMA, outcome: 'deep_enqueue_failed', accepted: false, execute: false };
  return { schema: DEEP_SCHEMA, outcome: 'deep_queued', accepted: true, execute: false, job_id: String(stored.job_id), idempotency_key: request.idempotency_key };
}

module.exports = { DEEP_SCHEMA, ALLOWED_KINDS, requestDeepAnalysis, requestKey };
