'use strict';

const { verifiedOwnerId } = require('./yarbi-owner-scope');

function text(value, limit = 280) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function ids(value, limit = 60) { return [...new Set((Array.isArray(value) ? value : []).map(item => String(item || '')).filter(Boolean))].slice(0, limit); }
function timestamp(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function validKey(value) { return /^[a-f0-9]{64}$/.test(String(value || '')); }

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
      contact_context_observations: Array.isArray(result.contact_context_observations) ? result.contact_context_observations.slice(0, 12) : [],
      reply_style_patterns: Array.isArray(result.reply_style_patterns) ? result.reply_style_patterns.slice(0, 8) : []
    },
    error_code: null,
    completed_at: new Date(now()).toISOString(),
    updated_at: new Date(now()).toISOString()
  };
}

module.exports = { batchRow, proposalPatch };
