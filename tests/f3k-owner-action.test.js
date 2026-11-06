'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CUSTOMER_ACTIONS, applyOwnerAction, createOwnerActionStore, validateOwnerActionRequest
} = require('../lib/yarbi-owner-action');

const NOW = new Date('2026-10-30T18:00:00.000Z');

test('F3K accepts only the closed owner-decision contract and future postponements', () => {
  assert.deepEqual(CUSTOMER_ACTIONS, ['ask_for_location', 'ask_for_service', 'ask_for_district', 'ask_for_schedule', 'follow_up_customer', 'confirm_visit']);
  assert.deepEqual(validateOwnerActionRequest({ inbox_id: 7, item_index: 0, decision: 'authorize' }, NOW), {
    inbox_id: 7, item_index: 0, decision: 'authorize', postpone_until: null
  });
  assert.equal(validateOwnerActionRequest({ inbox_id: 7, decision: 'postpone', postpone_until: '2026-10-31T18:00:00Z' }, NOW).decision, 'postpone');
  assert.throws(() => validateOwnerActionRequest({ inbox_id: 7, decision: 'send_whatsapp' }, NOW), { code: 'owner_action_request_invalid' });
  assert.throws(() => validateOwnerActionRequest({ inbox_id: 7, decision: 'postpone', postpone_until: '2026-10-29T18:00:00Z' }, NOW), { code: 'owner_action_postpone_until_invalid' });
  assert.throws(() => validateOwnerActionRequest({ inbox_id: 7, decision: 'authorize', postpone_until: '2026-10-31T18:00:00Z' }, NOW), { code: 'owner_action_postpone_until_unexpected' });
});

test('F3K adapter delegates one sanitized atomic RPC call and never performs external delivery', async () => {
  const calls = [];
  const store = createOwnerActionStore({
    supabase: async (path, options) => {
      calls.push({ path, options });
      return { response: { ok: true }, data: [{ outcome: 'authorized', decision_id: 17, owner_status: 'authorized', execution_state: 'authorized_pending_execution' }] };
    }
  });
  const result = await applyOwnerAction({ store, request: { inbox_id: 8, item_index: 0, decision: 'authorize' }, now: NOW });
  assert.deepEqual(result, { outcome: 'authorized', decision_id: 17, owner_status: 'authorized', execution_state: 'authorized_pending_execution' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/rest/v1/rpc/apply_yarbi_owner_action');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_inbox_id: 8, p_item_index: 0, p_decision: 'authorize', p_postpone_until: null, p_now: NOW.toISOString()
  });
});

test('F3K preserves the database outcome for stale, review and idempotent decisions', async () => {
  const outcomes = ['stale_recommendation', 'owner_review', 'already_authorized', 'already_dismissed'];
  for (const outcome of outcomes) {
    const store = { apply: async () => ({ outcome, decision_id: null, owner_status: 'pending', execution_state: null }) };
    const result = await applyOwnerAction({ store, request: { inbox_id: 9, decision: 'authorize' }, now: NOW });
    assert.equal(result.outcome, outcome);
  }
});
