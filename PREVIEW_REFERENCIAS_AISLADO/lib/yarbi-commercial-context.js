'use strict';

const SERVICES = Object.freeze([
  'instalacion_nueva',
  'punto_adicional',
  'modificacion_tuberia',
  'conversion_artefacto',
  'reparacion',
  'otro',
  'unknown'
]);
const SERVICE_SET = new Set(SERVICES);
const ORIGINS = new Set(['interactive_service_selection', 'operator_verified']);
const EVIDENCE_ADAPTER = 'yarbi-commercial-evidence.v1';

function asText(value, limit = 160) {
  return String(value ?? '').trim().slice(0, limit);
}

function toIsoTimestamp(value) {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const millis = numeric < 100000000000 ? numeric * 1000 : numeric;
  const parsed = new Date(millis);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function inspectCommercialEvidence(message = {}) {
  const raw = message?.metadata?.commercial_context;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'absent', evidence: null };
  if (raw.schema !== 'yarbi.commercial.v1') return { state: 'rejected', code: 'schema_invalid', evidence: null };
  // 3C solo confía en evidencia que el adaptador de servidor marcó. Texto,
  // metadata de cliente y objetos con forma parecida no bastan.
  if (raw.adapter !== EVIDENCE_ADAPTER || !asText(raw.event_id, 160) || !toIsoTimestamp(raw.occurred_at)) return { state: 'rejected', code: 'adapter_provenance_missing', evidence: null };
  const origin = asText(raw.origin, 64);
  if (!ORIGINS.has(origin)) return { state: 'rejected', code: 'origin_invalid', evidence: null };
  const service = asText(raw.service, 64);
  const normalizedService = SERVICE_SET.has(service) && service !== 'unknown' ? service : null;
  const visitRequested = raw.visit_requested === true;
  if (!normalizedService && !visitRequested) return { state: 'rejected', code: 'signal_invalid', evidence: null };
  const messageId = asText(message.id, 160);
  const occurredAt = toIsoTimestamp(message.timestamp) || toIsoTimestamp(message.created_at);
  if (!messageId || !occurredAt) return { state: 'rejected', code: 'message_reference_invalid', evidence: null };
  return { state: 'accepted', evidence: {
    message_id: messageId,
    occurred_at: occurredAt,
    service: normalizedService,
    visit_requested: visitRequested,
    origin,
    reason: visitRequested ? 'structured_visit_requested' : 'structured_service_request',
    event_id: asText(raw.event_id, 160)
  } };
}

function extractCommercialEvidence(message = {}) {
  return inspectCommercialEvidence(message).evidence;
}

function commercialContextError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function updateCommercialContext({ supabase, contactId, message }) {
  const normalizedContactId = Number(contactId);
  const evidence = extractCommercialEvidence(message);
  const messageId = asText(message?.id, 160);
  const occurredAt = toIsoTimestamp(message?.timestamp) || toIsoTimestamp(message?.created_at);
  if (!Number.isSafeInteger(normalizedContactId) || normalizedContactId <= 0 || !messageId || !occurredAt) {
    throw commercialContextError('commercial_context_reference_invalid', 'commercial_context_reference_invalid');
  }
  const payload = {
    p_contact_id: normalizedContactId,
    p_message_id: messageId,
    p_occurred_at: occurredAt,
    p_service: evidence?.service || null,
    p_visit_requested: evidence?.visit_requested === true,
    p_source: evidence?.origin || 'none',
    p_reason: evidence?.reason || 'identity_resolved_no_commercial_signal'
  };
  const result = await supabase('/rest/v1/rpc/update_yarbi_commercial_context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!result?.response?.ok || !Array.isArray(result.data) || !result.data[0]) {
    throw commercialContextError('commercial_context_update_failed', 'commercial_context_update_failed');
  }
  const context = result.data[0];
  const allowed = new Set(['unchanged', 'service_recorded', 'status_changed', 'context_updated']);
  if (!allowed.has(context.outcome)) {
    throw commercialContextError('commercial_context_invalid_result', 'commercial_context_invalid_result');
  }
  return { ...context, evidence };
}

module.exports = {
  ORIGINS,
  EVIDENCE_ADAPTER,
  SERVICES,
  extractCommercialEvidence,
  inspectCommercialEvidence,
  toIsoTimestamp,
  updateCommercialContext
};
