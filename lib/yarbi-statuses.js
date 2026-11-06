const INTEREST_LEVELS = new Set(['frio', 'tibio', 'caliente']);
const OPERATIONAL_STATUSES = new Set([
  'sin_accion',
  'seguimiento_pendiente',
  'esperando_cliente',
  'visita_por_confirmar',
  'visita_agendada',
  'trabajo_agendado',
  'trabajo_en_progreso',
  'servicio_completado',
  'cobro_pendiente',
  'cerrado',
  'cancelado'
]);

function clampText(value, max) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeMessageIds(value, allowedMessageIds) {
  const allowed = new Set((allowedMessageIds || []).map(String));
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(item => clampText(item, 160))
    .filter(item => item && allowed.has(item))))
    .slice(0, 12);
}

function normalizeStatusEvidence(value, allowedMessageIds) {
  const interest = String(value?.commercial_status || '').toLowerCase();
  const operational = String(value?.operational_status || '').toLowerCase();
  return {
    commercial_status: INTEREST_LEVELS.has(interest) ? interest : '',
    status_reason: clampText(value?.status_reason, 500),
    commercial_status_source_message_ids: normalizeMessageIds(value?.commercial_status_source_message_ids, allowedMessageIds),
    operational_status: OPERATIONAL_STATUSES.has(operational) ? operational : '',
    operational_reason: clampText(value?.operational_reason, 500),
    operational_status_source_message_ids: normalizeMessageIds(value?.operational_status_source_message_ids, allowedMessageIds)
  };
}

function timestampToIso(value) {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const epochMs = raw < 100000000000 ? raw * 1000 : raw;
  const date = new Date(epochMs);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestEvidenceAt(messages, sourceMessageIds) {
  const allowed = new Set((sourceMessageIds || []).map(String));
  return (messages || []).reduce((latest, message) => {
    if (!allowed.has(String(message?.id || ''))) return latest;
    const value = timestampToIso(message?.timestamp);
    return value && (!latest || value > latest) ? value : latest;
  }, null);
}

function canAdvance(currentAt, nextAt) {
  if (!nextAt) return false;
  if (!currentAt) return true;
  const current = new Date(currentAt).getTime();
  const next = new Date(nextAt).getTime();
  return Number.isFinite(next) && (!Number.isFinite(current) || next >= current);
}

function messageIsLocationSignalOnly(message) {
  const text = clampText(message?.text, 1000).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasLocation = Boolean(String(message?.maps_url || '').trim()) || /ubicacion compartida|google\s*maps|maps\.app\.goo\.gl|coordenadas|https?:\/\/.+maps/i.test(text);
  if (!hasLocation) return false;
  const explicitOperation = /\b(confirm[oa]|agendad[oa]|programad[oa]|visita (?:realizada|hecha|confirmada)|ya (?:fui|visite|realice|termine|cobre)|trabajo (?:realizado|terminado|confirmado)|servicio (?:realizado|terminado|completado)|pago (?:realizado|completo)|quedo debiendo)\b/i.test(text);
  return !explicitOperation;
}

function evidenceIsOnlyLocationSignal(messages, sourceMessageIds) {
  const ids = new Set((sourceMessageIds || []).map(String));
  const evidence = (messages || []).filter(message => ids.has(String(message?.id || '')));
  return evidence.length > 0 && evidence.every(messageIsLocationSignalOnly);
}

function buildContactStatusPatch(current, analysis, messages) {
  const patch = {};
  const interestIds = analysis?.commercial_status_source_message_ids || [];
  const interestAt = latestEvidenceAt(messages, interestIds);
  if (analysis?.commercial_status && interestIds.length && canAdvance(current?.commercial_status_event_at, interestAt)) {
    patch.commercial_status = analysis.commercial_status;
    patch.status_reason = analysis.status_reason || null;
    patch.commercial_status_event_at = interestAt;
    patch.commercial_status_source_message_ids = interestIds;
  }
  const operationalIds = analysis?.operational_status_source_message_ids || [];
  const operationalAt = latestEvidenceAt(messages, operationalIds);
  if (analysis?.operational_status && operationalIds.length && canAdvance(current?.operational_event_at, operationalAt)) {
    const locationOnly = evidenceIsOnlyLocationSignal(messages, operationalIds);
    patch.operational_status = locationOnly ? 'visita_por_confirmar' : analysis.operational_status;
    patch.operational_reason = locationOnly ? 'El cliente envió ubicación; la visita todavía no está confirmada.' : (analysis.operational_reason || null);
    patch.operational_event_at = operationalAt;
    patch.operational_status_source_message_ids = operationalIds;
  }
  return patch;
}

module.exports = {
  INTEREST_LEVELS,
  OPERATIONAL_STATUSES,
  buildContactStatusPatch,
  evidenceIsOnlyLocationSignal,
  messageIsLocationSignalOnly,
  normalizeStatusEvidence
};
