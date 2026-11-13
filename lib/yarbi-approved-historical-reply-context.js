'use strict';

// Contexto compacto para una futura composición de respuestas. No interpreta
// conversaciones, no llama a modelos y no ejecuta efectos comerciales. Sus
// fuentes deben ser batches aprobados por el mismo propietario en la cola
// canónica; nunca se alimenta de texto crudo de WhatsApp en el navegador.

const { verifiedOwnerId } = require('./yarbi-owner-scope');

const MAX_CONTACT_OBSERVATIONS = 8;
const MAX_OWNER_STYLE_PATTERNS = 8;

function text(value, limit = 280) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function positiveId(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }

function approvedProposal(row) {
  const proposal = row?.proposal && typeof row.proposal === 'object' && !Array.isArray(row.proposal) ? row.proposal : null;
  const contactId = positiveId(row?.contact_id);
  if (!contactId || text(row?.status, 32) !== 'approved'
    || text(proposal?.schema, 96) !== 'yarbi.historical-intelligence-result.v1'
    || String(proposal?.contact_id || '') !== String(contactId)
    || proposal?.commercial_effects_allowed !== false
    || !Array.isArray(proposal?.contact_context_observations)
    || !Array.isArray(proposal?.reply_style_patterns)) return null;
  return { contact_id: contactId, proposal };
}

function observation(row) {
  const category = text(row?.category, 48);
  const summary = text(row?.summary, 360);
  const confidence = Number(row?.confidence);
  if (!category || !summary || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { category, summary, confidence, provenance: 'owner_reviewed_historical_context', commercial_fact: false };
}

function stylePattern(row) {
  const pattern_key = text(row?.pattern_key, 80);
  const category = text(row?.category, 48);
  const guidance = text(row?.guidance, 360);
  const confidence = Number(row?.confidence);
  if (!pattern_key || !category || !guidance || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { pattern_key, category, guidance, confidence, provenance: 'owner_reviewed_outgoing_style' };
}

function uniqueBy(rows, key, limit) {
  const seen = new Set();
  return rows.filter(row => {
    const value = String(row?.[key] || '');
    if (!value || seen.has(value)) return false;
    seen.add(value); return true;
  }).slice(0, limit);
}

function buildApprovedHistoricalReplyContext({ ownerIdentity, contact_id, batches } = {}) {
  const ownerId = verifiedOwnerId(ownerIdentity);
  const selectedContactId = contact_id === undefined || contact_id === null || contact_id === '' ? null : positiveId(contact_id);
  if (contact_id !== undefined && contact_id !== null && contact_id !== '' && !selectedContactId) {
    const error = new Error('historical_reply_context_contact_invalid'); error.code = error.message; throw error;
  }
  const approved = (Array.isArray(batches) ? batches : []).map(approvedProposal).filter(Boolean);
  const contactObservations = selectedContactId
    ? uniqueBy(approved.filter(batch => batch.contact_id === selectedContactId)
      .flatMap(batch => batch.proposal.contact_context_observations.map(observation).filter(Boolean)), 'summary', MAX_CONTACT_OBSERVATIONS)
    : [];
  const stylePatterns = uniqueBy(approved
    .flatMap(batch => batch.proposal.reply_style_patterns.map(stylePattern).filter(Boolean))
    .sort((a, b) => b.confidence - a.confidence || a.pattern_key.localeCompare(b.pattern_key)), 'pattern_key', MAX_OWNER_STYLE_PATTERNS);
  return {
    schema: 'yarbi.approved-historical-reply-context.v1',
    owner_account_id: ownerId,
    contact_id: selectedContactId,
    contact_observations: contactObservations,
    owner_reply_style_patterns: stylePatterns,
    provenance: 'owner_reviewed_historical_learning',
    commercial_effects_allowed: false,
    reply_send_allowed: false,
    requires_resolved_contact_for_contact_context: true
  };
}

function createApprovedHistoricalReplyContextReader({ queue } = {}) {
  if (!queue || typeof queue.listApproved !== 'function') throw new TypeError('historical_reply_context_queue_unavailable');
  return {
    async read({ ownerIdentity, contact_id, limit = 100 } = {}) {
      const batches = await queue.listApproved({ ownerIdentity, contact_id, limit });
      return buildApprovedHistoricalReplyContext({ ownerIdentity, contact_id, batches });
    }
  };
}

module.exports = {
  MAX_CONTACT_OBSERVATIONS,
  MAX_OWNER_STYLE_PATTERNS,
  approvedProposal,
  buildApprovedHistoricalReplyContext,
  createApprovedHistoricalReplyContextReader
};
