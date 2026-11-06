'use strict';

// Esta capa no interpreta lenguaje natural. Solo convierte selecciones que ya
// llegaron al servidor mediante un canal autenticado/validado en evidencia
// comercial serializable para la cola canónica.
const SCHEMA = 'yarbi.commercial.v1';
const ADAPTER = 'yarbi-commercial-evidence.v1';
const ORIGINS = Object.freeze(['interactive_service_selection', 'operator_verified']);
const SERVICES = Object.freeze([
  'instalacion_nueva',
  'punto_adicional',
  'modificacion_tuberia',
  'conversion_artefacto',
  'reparacion',
  'otro',
  'unknown'
]);

const ORIGIN_SET = new Set(ORIGINS);
const SERVICE_SET = new Set(SERVICES);
const TRUSTED_EVENT = Symbol('yarbi.commercial.evidence.trusted-event');
const MAX_ID_LENGTH = 160;

const SERVICE_SELECTIONS = new Map(SERVICES.map(service => [
  `yarbi.commercial.v1.service.${service}`,
  service
]));
const VISIT_SELECTION = 'yarbi.commercial.v1.visit.requested';

function text(value, limit = MAX_ID_LENGTH) {
  return String(value ?? '').trim().slice(0, limit);
}

function isoTimestamp(value) {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const millis = number < 100000000000 ? number * 1000 : number;
  const parsed = new Date(millis);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function failure(outcome, code) {
  return { outcome, code, evidence: null, trace: { event_id: null, source: null } };
}

function trustedEvent({ origin, eventId, messageId, occurredAt, selections = [], operatorAction = null, source = 'server_verified' } = {}) {
  const normalizedOrigin = text(origin, 64);
  const normalizedEventId = text(eventId);
  const normalizedMessageId = text(messageId);
  const normalizedOccurredAt = isoTimestamp(occurredAt);
  if (!ORIGIN_SET.has(normalizedOrigin) || !normalizedEventId || !normalizedMessageId || !normalizedOccurredAt) {
    return null;
  }
  return Object.freeze({
    [TRUSTED_EVENT]: true,
    origin: normalizedOrigin,
    event_id: normalizedEventId,
    message_id: normalizedMessageId,
    occurred_at: normalizedOccurredAt,
    selections: Array.isArray(selections) ? selections.map(value => text(value, 120)).filter(Boolean) : [],
    operator_action: operatorAction && typeof operatorAction === 'object' && !Array.isArray(operatorAction)
      ? Object.freeze({ service: text(operatorAction.service, 64), visit_requested: operatorAction.visit_requested === true })
      : null,
    source: text(source, 64) || 'server_verified'
  });
}

// Solo el código de servidor que ya validó al proveedor o al operador debe
// construir este sobre. Un payload HTTP, metadata de WhatsApp o texto libre no
// posee la marca privada TRUSTED_EVENT y por tanto nunca será evidencia.
function createVerifiedWebhookEvidenceEvent({ providerVerified, eventId, messageId, occurredAt, interactive } = {}) {
  if (providerVerified !== true || !interactive || typeof interactive !== 'object' || Array.isArray(interactive)) return null;
  const type = text(interactive.type, 64);
  const selectionId = text(interactive.selection_id, 120);
  if (!['button_reply', 'list_reply'].includes(type) || !selectionId) return null;
  return trustedEvent({
    origin: 'interactive_service_selection',
    eventId,
    messageId,
    occurredAt,
    selections: [selectionId],
    source: 'verified_whatsapp_interactive'
  });
}

function createVerifiedOperatorEvidenceEvent({ operatorVerified, eventId, messageId, occurredAt, service = 'unknown', visitRequested = false } = {}) {
  if (operatorVerified !== true || (!SERVICE_SET.has(text(service, 64)) && visitRequested !== true)) return null;
  return trustedEvent({
    origin: 'operator_verified',
    eventId,
    messageId,
    occurredAt,
    operatorAction: { service, visit_requested: visitRequested },
    source: 'verified_operator_action'
  });
}

function adaptCommercialEvidence(event) {
  if (!event || typeof event !== 'object' || event[TRUSTED_EVENT] !== true) {
    return failure('ignored', 'ignored_untrusted');
  }
  let service = 'unknown';
  let visitRequested = false;
  if (event.origin === 'interactive_service_selection') {
    for (const selection of event.selections) {
      if (SERVICE_SELECTIONS.has(selection)) {
        if (service !== 'unknown' && service !== SERVICE_SELECTIONS.get(selection)) return failure('invalid', 'multiple_service_selections');
        service = SERVICE_SELECTIONS.get(selection);
      } else if (selection === VISIT_SELECTION) {
        visitRequested = true;
      } else {
        return failure('unsupported', 'interactive_selection_not_allowlisted');
      }
    }
  } else if (event.origin === 'operator_verified') {
    service = event.operator_action?.service || 'unknown';
    visitRequested = event.operator_action?.visit_requested === true;
  } else {
    return failure('unsupported', 'origin_unsupported');
  }

  if (!SERVICE_SET.has(service) || (service === 'unknown' && !visitRequested)) {
    return failure('invalid', 'commercial_evidence_incomplete');
  }
  const evidence = Object.freeze({
    schema: SCHEMA,
    adapter: ADAPTER,
    origin: event.origin,
    service,
    visit_requested: visitRequested,
    event_id: event.event_id,
    occurred_at: event.occurred_at
  });
  return {
    outcome: 'accepted',
    code: 'accepted',
    evidence,
    trace: { event_id: event.event_id, message_id: event.message_id, source: event.source, origin: event.origin }
  };
}

function attachCommercialEvidence(messageMetadata, result) {
  const metadata = messageMetadata && typeof messageMetadata === 'object' && !Array.isArray(messageMetadata) ? { ...messageMetadata } : {};
  if (result?.outcome !== 'accepted' || !result.evidence) return metadata;
  return { ...metadata, commercial_context: result.evidence };
}

module.exports = {
  ADAPTER,
  ORIGINS,
  SCHEMA,
  SERVICES,
  VISIT_SELECTION,
  adaptCommercialEvidence,
  attachCommercialEvidence,
  createVerifiedOperatorEvidenceEvent,
  createVerifiedWebhookEvidenceEvent
};
