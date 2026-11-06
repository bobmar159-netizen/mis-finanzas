'use strict';

const DECISIONS = Object.freeze(['authorize', 'postpone', 'dismiss']);
const CUSTOMER_ACTIONS = Object.freeze(['ask_for_location', 'ask_for_service', 'ask_for_district', 'ask_for_schedule', 'follow_up_customer', 'confirm_visit']);
const INTERNAL_ACTIONS = Object.freeze(['prepare_quote']);

function text(value, limit = 120) { return String(value ?? '').trim().slice(0, limit); }
function validDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; }
function positiveInteger(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function ownerActionError(code) { const error = new Error(code); error.code = code; return error; }

function validateOwnerActionRequest(input = {}, now = new Date()) {
  const inboxId = positiveInteger(input.inbox_id);
  const itemIndex = Number.isInteger(Number(input.item_index ?? 0)) && Number(input.item_index ?? 0) >= 0 ? Number(input.item_index ?? 0) : null;
  const decision = text(input.decision, 32);
  if (!inboxId || itemIndex === null || !DECISIONS.includes(decision)) throw ownerActionError('owner_action_request_invalid');
  const postponeUntil = input.postpone_until == null || input.postpone_until === '' ? null : validDate(input.postpone_until);
  if (decision === 'postpone' && (!postponeUntil || postponeUntil <= now)) throw ownerActionError('owner_action_postpone_until_invalid');
  if (decision !== 'postpone' && postponeUntil) throw ownerActionError('owner_action_postpone_until_unexpected');
  return { inbox_id: inboxId, item_index: itemIndex, decision, postpone_until: postponeUntil ? postponeUntil.toISOString() : null };
}

function createOwnerActionStore({ supabase } = {}) {
  if (typeof supabase !== 'function') throw ownerActionError('owner_action_store_unavailable');
  return {
    async apply(input) {
      const result = await supabase('/rest/v1/rpc/apply_yarbi_owner_action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          p_inbox_id: input.inbox_id, p_item_index: input.item_index, p_decision: input.decision,
          p_postpone_until: input.postpone_until, p_now: input.now
        })
      });
      if (!result?.response?.ok) throw ownerActionError('owner_action_apply_failed');
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row || !text(row.outcome, 80)) throw ownerActionError('owner_action_apply_invalid_response');
      return {
        outcome: text(row.outcome, 80), decision_id: positiveInteger(row.decision_id),
        owner_status: text(row.owner_status, 32) || null, execution_state: text(row.execution_state, 80) || null
      };
    }
  };
}

async function applyOwnerAction({ store, request, now = new Date() } = {}) {
  if (!store || typeof store.apply !== 'function') throw ownerActionError('owner_action_store_unavailable');
  const normalized = validateOwnerActionRequest(request, now);
  return store.apply({ ...normalized, now: now.toISOString() });
}

module.exports = { CUSTOMER_ACTIONS, DECISIONS, INTERNAL_ACTIONS, applyOwnerAction, createOwnerActionStore, validateOwnerActionRequest };
