'use strict';

// Contrato del segundo paso conversacional: después de resolver identidad y
// reunir hechos verificables, un modelo podrá redactar un BORRADOR. No es el
// intérprete V4 y nunca puede enviar WhatsApp ni cambiar CRM/Agenda/Finanzas.

const { verifiedOwnerId } = require('./yarbi-owner-scope');

const REPLY_DRAFT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: {
    draft: { type: 'string', minLength: 1, maxLength: 900 },
    disposition: { type: 'string', enum: ['answer', 'clarify', 'decline'] },
    requires_owner_confirmation: { type: 'boolean', enum: [true] },
    fact_ids_used: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 80 } },
    historical_context_categories_used: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 48 } }
  },
  required: ['draft', 'disposition', 'requires_owner_confirmation', 'fact_ids_used', 'historical_context_categories_used']
});

function text(value, limit = 900) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function unique(values, limit) { return [...new Set((Array.isArray(values) ? values : []).map(value => text(value, 80)).filter(Boolean))].slice(0, limit); }
function positiveId(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function error(code) { const value = new Error(code); value.code = code; return value; }

function safeFact(value) {
  const id = text(value?.id, 80); const kind = text(value?.kind, 32); const statement = text(value?.statement, 360);
  if (!id || !['crm', 'agenda', 'finance', 'owner_instruction'].includes(kind) || !statement || value?.verified !== true) return null;
  return { id, kind, statement, verified: true };
}

function safeInstruction(value) {
  const instruction = text(value?.instruction ?? value, 280);
  return instruction || null;
}

function safeHistoricalContext(value, ownerId, contactId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || text(value.schema, 96) !== 'yarbi.approved-historical-reply-context.v1'
    || String(value.owner_account_id || '') !== ownerId
    || (value.contact_id !== null && Number(value.contact_id) !== contactId)
    || value.commercial_effects_allowed !== false || value.reply_send_allowed !== false) return { observations: [], styles: [] };
  const observations = (Array.isArray(value.contact_observations) ? value.contact_observations : []).map(row => {
    const category = text(row?.category, 48); const summary = text(row?.summary, 360);
    return category && summary && row?.commercial_fact === false ? { category, summary } : null;
  }).filter(Boolean).slice(0, 8);
  const styles = (Array.isArray(value.owner_reply_style_patterns) ? value.owner_reply_style_patterns : []).map(row => {
    const category = text(row?.category, 48); const guidance = text(row?.guidance, 360);
    return category && guidance ? { category, guidance } : null;
  }).filter(Boolean).slice(0, 8);
  return { observations, styles };
}

function buildOwnerReplyDraftRequest({ ownerIdentity, contact, incoming_message, verified_facts, owner_instructions, historical_context } = {}) {
  const ownerId = verifiedOwnerId(ownerIdentity);
  const contactId = positiveId(contact?.id ?? contact?.contact_id);
  const messageId = text(incoming_message?.id, 80);
  const messageText = text(incoming_message?.text, 1800);
  if (!contactId || !messageId || !messageText) throw error('owner_reply_draft_input_invalid');
  const facts = (Array.isArray(verified_facts) ? verified_facts : []).map(safeFact).filter(Boolean).slice(0, 12);
  const instructions = (Array.isArray(owner_instructions) ? owner_instructions : []).map(safeInstruction).filter(Boolean).slice(0, 12);
  const historical = safeHistoricalContext(historical_context, ownerId, contactId);
  const payload = {
    contract: 'yarbi.owner-reply-draft.v1',
    incoming_message: { id: messageId, text: messageText },
    contact: { id: contactId, display_name: text(contact?.display_name ?? contact?.name, 120) || null },
    verified_facts: facts,
    approved_contact_context: historical.observations,
    approved_owner_style: historical.styles,
    owner_instructions: instructions,
    safety: {
      owner_confirmation_required: true,
      automatic_send_allowed: false,
      commercial_state_changes_allowed: false,
      do_not_invent_prices_dates_visits_payments_or_identity: true,
      ask_for_clarification_when_information_is_missing: true
    }
  };
  const prompt = [
    'Redacta un borrador breve en español para responder al cliente.',
    'Respeta los hechos verificados y las instrucciones del propietario. El contexto histórico aprobado es solo contexto y nunca confirma pagos, visitas, fechas ni cierres.',
    'No inventes identidad, precio, disponibilidad, visita, pago, garantía, fecha, ubicación ni servicio. Si falta un dato, pide una aclaración corta.',
    'El resultado es un borrador que requiere confirmación humana. Nunca indiques que el mensaje fue enviado.',
    'Devuelve exclusivamente JSON conforme al schema indicado.',
    JSON.stringify(payload)
  ].join('\n\n');
  return {
    schema: 'yarbi.owner-reply-draft-request.v1', owner_account_id: ownerId, contact_id: contactId,
    message_id: messageId, prompt, response_mime_type: 'application/json', response_json_schema: REPLY_DRAFT_SCHEMA,
    execute: false, automatic_send_allowed: false, commercial_effects_allowed: false,
    allowed_fact_ids: facts.map(item => item.id), allowed_historical_categories: historical.observations.map(item => item.category)
  };
}

function normalizeOwnerReplyDraft({ request, response } = {}) {
  if (!request || text(request.schema, 96) !== 'yarbi.owner-reply-draft-request.v1') throw error('owner_reply_draft_request_invalid');
  const draft = text(response?.draft, 900);
  const disposition = text(response?.disposition, 24);
  const factIds = unique(response?.fact_ids_used, 12);
  const categories = unique(response?.historical_context_categories_used, 8);
  const allowedFacts = new Set(unique(request.allowed_fact_ids, 12));
  const allowedCategories = new Set(unique(request.allowed_historical_categories, 8));
  if (!draft || !['answer', 'clarify', 'decline'].includes(disposition)
    || response?.requires_owner_confirmation !== true
    || factIds.some(id => !allowedFacts.has(id))
    || categories.some(category => !allowedCategories.has(category))) throw error('owner_reply_draft_response_invalid');
  return {
    schema: 'yarbi.owner-reply-draft.v1', contact_id: request.contact_id, message_id: request.message_id,
    draft, disposition, fact_ids_used: factIds, historical_context_categories_used: categories,
    requires_owner_confirmation: true, automatic_send_allowed: false, commercial_effects_allowed: false,
    status: 'draft_pending_owner_confirmation'
  };
}

module.exports = { REPLY_DRAFT_SCHEMA, buildOwnerReplyDraftRequest, normalizeOwnerReplyDraft, safeHistoricalContext };
