'use strict';

const { cleanPhone } = require('./yarbi-processing-recovery');

const RESOLUTION_OUTCOMES = Object.freeze([
  'resolved_existing',
  'created_new',
  'identity_pending',
  'identity_error'
]);

function identityError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

/**
 * Resuelve una identidad telefónica únicamente mediante la RPC transaccional.
 * No crea nombres de relleno: la identidad CRM se limita al teléfono hasta que
 * una fase posterior tenga evidencia confiable de un nombre.
 */
async function resolveOrCreateContactByPhone({ supabase, phone, messageId, analysisId }) {
  if (typeof supabase !== 'function') throw identityError('identity_resolver_unavailable');
  const normalizedPhone = cleanPhone(phone);
  if (!normalizedPhone) {
    return { outcome: 'identity_pending', contact_id: null, normalized_phone: '' };
  }
  if (!String(messageId || '').trim() || !Number.isFinite(Number(analysisId))) {
    throw identityError('identity_reference_invalid');
  }

  const result = await supabase('/rest/v1/rpc/resolve_or_create_contact_by_phone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_phone: normalizedPhone,
      p_message_id: String(messageId),
      p_analysis_id: Number(analysisId)
    })
  });
  if (!result?.response?.ok) {
    const error = identityError('identity_resolution_failed');
    error.cause = result?.response?.status || null;
    throw error;
  }
  const row = Array.isArray(result.data) ? result.data[0] : null;
  const outcome = String(row?.outcome || '');
  const contactId = Number(row?.contact_id);
  if (!RESOLUTION_OUTCOMES.includes(outcome) || !['resolved_existing', 'created_new'].includes(outcome) || !Number.isSafeInteger(contactId) || contactId <= 0) {
    throw identityError('identity_resolution_invalid_response');
  }
  return { outcome, contact_id: contactId, normalized_phone: normalizedPhone };
}

module.exports = { RESOLUTION_OUTCOMES, resolveOrCreateContactByPhone };
