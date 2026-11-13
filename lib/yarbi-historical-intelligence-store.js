'use strict';

const { verifiedOwnerId } = require('./yarbi-owner-scope');

function text(value, limit = 280) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function ids(value, limit = 60) { return [...new Set((Array.isArray(value) ? value : []).map(item => String(item || '')).filter(Boolean))].slice(0, limit); }
function timestamp(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function validKey(value) { return /^[a-f0-9]{64}$/.test(String(value || '')); }
function storeError(code) { const error = new Error(code); error.code = code; return error; }
function failureCode(value) { return String(value || 'historical_batch_processing_failed').toLowerCase().replace(/[^a-z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'historical_batch_processing_failed'; }
function validBatchId(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }

async function rpc(supabase, name, body, code) {
  if (typeof supabase !== 'function') throw storeError('historical_batch_store_unavailable');
  const result = await supabase('/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!result?.response?.ok) throw storeError(code);
  return Array.isArray(result.data) ? result.data[0] || null : result.data || null;
}

async function rpcRows(supabase, name, body, code) {
  if (typeof supabase !== 'function') throw storeError('historical_batch_store_unavailable');
  const result = await supabase('/rest/v1/rpc/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!result?.response?.ok || !Array.isArray(result.data)) throw storeError(code);
  return result.data;
}

function reviewProposal(value, contactId) {
  const proposal = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!proposal || text(proposal.schema, 96) !== 'yarbi.historical-intelligence-result.v1'
    || String(proposal.contact_id || '') !== String(contactId)
    || !Array.isArray(proposal.contact_context_observations)
    || !Array.isArray(proposal.reply_style_patterns)) return null;
  return {
    schema: proposal.schema, contact_id: String(contactId),
    contact_context_observations: proposal.contact_context_observations.slice(0, 12),
    reply_style_patterns: proposal.reply_style_patterns.slice(0, 8),
    requires_owner_review: true, commercial_effects_allowed: false
  };
}

function reviewBatch(value) {
  const contactId = Number(value?.contact_id);
  const proposal = reviewProposal(value?.proposal, contactId);
  const status = text(value?.status, 40);
  if (!validBatchId(value?.batch_id) || !Number.isSafeInteger(contactId) || contactId <= 0
    || !['awaiting_owner_review', 'approved', 'rejected'].includes(status) || !proposal) throw storeError('historical_batch_review_invalid');
  return {
    batch_id: String(value.batch_id), contact_id: contactId, status,
    segment_index: Number(value?.segment_index) || 0, segment_count: Number(value?.segment_count) || 1,
    occurred_from: timestamp(value?.occurred_from), occurred_to: timestamp(value?.occurred_to),
    proposal
  };
}

function batchRow({ ownerIdentity, task, now = () => new Date() } = {}) {
  const ownerId = verifiedOwnerId(ownerIdentity);
  const messageIds = ids(task?.message_ids);
  const outgoingMessageIds = ids(task?.outgoing_message_ids);
  const contactId = Number(task?.contact_id);
  const segmentIndex = Number(task?.segment_index);
  const segmentCount = Number(task?.segment_count);
  if (!Number.isSafeInteger(contactId) || contactId <= 0 || !validKey(task?.idempotency_key) || !messageIds.length || !Number.isSafeInteger(segmentIndex) || segmentIndex < 0 || !Number.isSafeInteger(segmentCount) || segmentCount < 1 || segmentIndex >= segmentCount) {
    const error = new Error('historical_batch_task_invalid');
    error.code = error.message;
    throw error;
  }
  if (outgoingMessageIds.some(id => !messageIds.includes(id))) {
    const error = new Error('historical_batch_outgoing_scope_invalid');
    error.code = error.message;
    throw error;
  }
  return {
    owner_account_id: ownerId,
    contact_id: contactId,
    idempotency_key: String(task.idempotency_key),
    message_ids: messageIds,
    outgoing_message_ids: outgoingMessageIds,
    segment_index: segmentIndex,
    segment_count: segmentCount,
    occurred_from: timestamp(task.occurred_from),
    occurred_to: timestamp(task.occurred_to),
    status: 'ready',
    requires_owner_review: true,
    commercial_effects_allowed: false,
    proposal: null,
    error_code: null,
    attempt_count: 0,
    created_at: new Date(now()).toISOString(),
    updated_at: new Date(now()).toISOString()
  };
}

function proposalPatch({ task, result, now = () => new Date() } = {}) {
  if (!validKey(task?.idempotency_key) || String(result?.task_key || '') !== String(task.idempotency_key)) {
    const error = new Error('historical_batch_result_binding_invalid');
    error.code = error.message;
    throw error;
  }
  if (String(result?.contact_id || '') !== String(task?.contact_id || '') || result?.commercial_effects_allowed !== false || result?.requires_owner_review !== true || result?.status !== 'awaiting_owner_review') {
    const error = new Error('historical_batch_result_contract_invalid');
    error.code = error.message;
    throw error;
  }
  return {
    status: 'awaiting_owner_review',
    requires_owner_review: true,
    commercial_effects_allowed: false,
    proposal: {
      schema: text(result.schema, 96),
      task_key: text(result.task_key, 80),
      contact_id: String(result.contact_id),
      contact_context_observations: Array.isArray(result.contact_context_observations) ? result.contact_context_observations.slice(0, 12) : [],
      reply_style_patterns: Array.isArray(result.reply_style_patterns) ? result.reply_style_patterns.slice(0, 8) : []
    },
    error_code: null,
    completed_at: new Date(now()).toISOString(),
    updated_at: new Date(now()).toISOString()
  };
}

function claimedTask(row) {
  const task = {
    batch_id: String(row?.batch_id || ''),
    contact_id: Number(row?.contact_id),
    idempotency_key: String(row?.idempotency_key || ''),
    message_ids: ids(row?.message_ids),
    outgoing_message_ids: ids(row?.outgoing_message_ids),
    segment_index: Number(row?.segment_index),
    segment_count: Number(row?.segment_count),
    occurred_from: timestamp(row?.occurred_from),
    occurred_to: timestamp(row?.occurred_to),
    attempt_count: Number(row?.attempt_count)
  };
  if (!task.batch_id || !Number.isSafeInteger(task.contact_id) || task.contact_id <= 0 || !validKey(task.idempotency_key)
    || !task.message_ids.length || !Number.isSafeInteger(task.segment_index) || task.segment_index < 0
    || !Number.isSafeInteger(task.segment_count) || task.segment_count < 1 || task.segment_index >= task.segment_count
    || !Number.isSafeInteger(task.attempt_count) || task.attempt_count < 1
    || task.outgoing_message_ids.some(id => !task.message_ids.includes(id))) {
    throw storeError('historical_batch_claim_invalid');
  }
  return task;
}

// Adaptador sin modelo: solamente persiste/recupera referencias de mensajes y
// propuestas ya normalizadas. El backend entrega una identidad autenticada;
// nada de este módulo acepta un owner desde el navegador.
function createHistoricalIntelligenceQueue({ supabase, now = () => new Date() } = {}) {
  return {
    async enqueue({ ownerIdentity, task }) {
      const row = batchRow({ ownerIdentity, task, now });
      const result = await rpc(supabase, 'enqueue_yarbi_historical_intelligence_batch', {
        p_owner_account_id: row.owner_account_id,
        p_contact_id: row.contact_id,
        p_idempotency_key: row.idempotency_key,
        p_message_ids: row.message_ids,
        p_outgoing_message_ids: row.outgoing_message_ids,
        p_segment_index: row.segment_index,
        p_segment_count: row.segment_count,
        p_occurred_from: row.occurred_from,
        p_occurred_to: row.occurred_to
      }, 'historical_batch_enqueue_failed');
      const outcome = String(result?.outcome || '');
      if (!result?.batch_id || !['created', 'existing'].includes(outcome)) throw storeError('historical_batch_enqueue_invalid');
      return { batch_id: String(result.batch_id), outcome, status: text(result.status, 40), attempt_count: Number(result.attempt_count || 0) };
    },
    async claim({ ownerIdentity }) {
      const ownerId = verifiedOwnerId(ownerIdentity);
      const result = await rpc(supabase, 'claim_yarbi_historical_intelligence_batch', {
        p_owner_account_id: ownerId
      }, 'historical_batch_claim_failed');
      return result ? claimedTask(result) : null;
    },
    async complete({ ownerIdentity, task, result }) {
      const ownerId = verifiedOwnerId(ownerIdentity);
      const claimed = claimedTask(task);
      const patch = proposalPatch({ task: claimed, result, now });
      const persisted = await rpc(supabase, 'complete_yarbi_historical_intelligence_batch', {
        p_owner_account_id: ownerId,
        p_batch_id: claimed.batch_id,
        p_expected_attempt_count: claimed.attempt_count,
        p_proposal: {
          ...patch.proposal,
          requires_owner_review: true,
          commercial_effects_allowed: false
        }
      }, 'historical_batch_complete_failed');
      if (String(persisted?.batch_id || '') !== claimed.batch_id || persisted?.status !== 'awaiting_owner_review') throw storeError('historical_batch_complete_invalid');
      return { batch_id: claimed.batch_id, status: 'awaiting_owner_review' };
    },
    async fail({ ownerIdentity, task, error_code }) {
      const ownerId = verifiedOwnerId(ownerIdentity);
      const claimed = claimedTask(task);
      const persisted = await rpc(supabase, 'fail_yarbi_historical_intelligence_batch', {
        p_owner_account_id: ownerId,
        p_batch_id: claimed.batch_id,
        p_expected_attempt_count: claimed.attempt_count,
        p_error_code: failureCode(error_code)
      }, 'historical_batch_fail_failed');
      if (String(persisted?.batch_id || '') !== claimed.batch_id || persisted?.status !== 'failed') throw storeError('historical_batch_fail_invalid');
      return { batch_id: claimed.batch_id, status: 'failed', error_code: failureCode(error_code) };
    },
    async listReview({ ownerIdentity, limit = 20 }) {
      const ownerId = verifiedOwnerId(ownerIdentity);
      const requestedLimit = Math.min(50, Math.max(1, Number(limit) || 20));
      const rows = await rpcRows(supabase, 'list_yarbi_historical_intelligence_review_batches', {
        p_owner_account_id: ownerId, p_limit: requestedLimit
      }, 'historical_batch_review_list_failed');
      return rows.map(reviewBatch);
    },
    async listApproved({ ownerIdentity, contact_id, limit = 100 }) {
      const ownerId = verifiedOwnerId(ownerIdentity);
      const requestedContactId = contact_id === undefined || contact_id === null || contact_id === '' ? null : Number(contact_id);
      const requestedLimit = Math.min(200, Math.max(1, Number(limit) || 100));
      if (requestedContactId !== null && (!Number.isSafeInteger(requestedContactId) || requestedContactId <= 0)) throw storeError('historical_batch_approved_context_input_invalid');
      const rows = await rpcRows(supabase, 'list_yarbi_historical_intelligence_approved_batches', {
        p_owner_account_id: ownerId, p_contact_id: requestedContactId, p_limit: requestedLimit
      }, 'historical_batch_approved_context_failed');
      return rows.map(reviewBatch).filter(batch => batch.status === 'approved');
    },
    async review({ ownerIdentity, batch_id, decision }) {
      const ownerId = verifiedOwnerId(ownerIdentity);
      const selectedDecision = String(decision || '').toLowerCase() === 'approve' ? 'approved'
        : String(decision || '').toLowerCase() === 'reject' ? 'rejected' : '';
      if (!validBatchId(batch_id) || !selectedDecision) throw storeError('historical_batch_review_input_invalid');
      const persisted = await rpc(supabase, 'review_yarbi_historical_intelligence_batch', {
        p_owner_account_id: ownerId, p_batch_id: String(batch_id), p_decision: selectedDecision
      }, 'historical_batch_review_failed');
      return reviewBatch(persisted);
    }
  };
}

module.exports = { batchRow, claimedTask, createHistoricalIntelligenceQueue, failureCode, proposalPatch, reviewBatch, reviewProposal, validBatchId };
