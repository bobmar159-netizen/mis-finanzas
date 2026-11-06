'use strict';

// Traduce una comprensión V4 ya validada a una búsqueda CRM de solo lectura.
// No interpreta texto libre ni selecciona contactos: si falta evidencia
// estructurada, la conversación conserva el camino NEEDS_LANGUAGE_MODEL.
const { normalize } = require('./yarbi-client-search');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value, limit = 160) { return String(value ?? '').trim().slice(0, limit); }
function clause(value) { return text(value?.value ?? value, 120); }

function acceptedConstraint(value) {
  if (value === null || value === undefined || value === '') return '';
  const source = object(value);
  if (typeof value === 'object' && Object.keys(source).length === 0) return '';
  const certainty = text(source.certainty, 24).toLowerCase();
  if (source.negated === true || certainty === 'contradiction' || certainty === 'invalid') return '';
  return clause(source);
}

function planCrmSearchFromUnderstanding({ understanding, state } = {}) {
  const source = object(understanding);
  const constraints = { ...object(state?.active_constraints), ...object(source.constraints) };
  const reference = object(source.target_reference);
  const name = acceptedConstraint(constraints.name) || acceptedConstraint(reference.name);
  const phone = text(constraints.phone, 48).replace(/\D/g, '');
  const district = acceptedConstraint(constraints.district);
  const service = acceptedConstraint(constraints.service);
  const location = acceptedConstraint(constraints.location);
  const recency = object(constraints.recency);
  const intent = text(source.intent, 80).toLowerCase();
  const conversationalAct = text(source.conversational_act, 48).toLowerCase();
  const pending = /pending|follow.?up|cotiza|quote|seguimiento/.test([intent, conversationalAct, text(source.target_type, 48)].join(' '));
  const query = [name, phone, district, service, location].filter(Boolean).join(' ').trim();
  const filters = {
    ...(district ? { district } : {}),
    ...(service ? { service } : {}),
    ...(pending ? { pending: true } : {}),
    ...(recency.days !== undefined ? { recency_days: Number(recency.days) } : {})
  };
  if (!query && !pending) {
    return { outcome: 'needs_clarification', execute: false, question: '¿Qué dato recuerdas del cliente: nombre, teléfono, distrito, servicio o un pendiente?' };
  }
  if (source.ambiguity === true && !query) {
    return { outcome: 'needs_clarification', execute: false, question: 'Necesito una pista verificable para buscar sin confundir clientes.' };
  }
  return {
    schema: 'yarbi.crm-search-plan.v1',
    outcome: 'crm_search_ready',
    execute: false,
    query: query || 'pendiente',
    filters,
    source: 'v4_structured_understanding',
    normalized_query: normalize(query || 'pendiente')
  };
}

module.exports = { planCrmSearchFromUnderstanding };
