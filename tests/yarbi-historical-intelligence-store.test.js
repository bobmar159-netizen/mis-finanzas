'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { batchRow, claimedTask, createHistoricalIntelligenceQueue, failureCode, proposalPatch } = require('../lib/yarbi-historical-intelligence-store');

const OWNER = { kind: 'validated_auth_identity', subject: '11111111-1111-4111-8111-111111111111' };
const TASK = { idempotency_key: 'a'.repeat(64), contact_id: 71, message_ids: ['m1', 'm2'], outgoing_message_ids: ['m2'], segment_index: 0, segment_count: 1, occurred_from: 1, occurred_to: 2 };
const now = () => new Date('2026-11-11T12:00:00.000Z');

test('historical queue rows bind a verified owner and prohibit commercial effects', () => {
  const row = batchRow({ ownerIdentity: OWNER, task: TASK, now });
  assert.equal(row.owner_account_id, OWNER.subject);
  assert.equal(row.status, 'ready');
  assert.equal(row.requires_owner_review, true);
  assert.equal(row.commercial_effects_allowed, false);
  assert.equal(row.proposal, null);
});

test('historical result patch requires the task and contact binding', () => {
  const result = { schema: 'yarbi.historical-intelligence-result.v1', task_key: TASK.idempotency_key, contact_id: '71', contact_context_observations: [], reply_style_patterns: [], requires_owner_review: true, commercial_effects_allowed: false, status: 'awaiting_owner_review' };
  const patch = proposalPatch({ task: TASK, result, now });
  assert.equal(patch.status, 'awaiting_owner_review');
  assert.equal(patch.commercial_effects_allowed, false);
  assert.throws(() => proposalPatch({ task: TASK, result: { ...result, contact_id: '72' }, now }), /historical_batch_result_contract_invalid/);
});

test('proposed SQL keeps the queue service-role-only and review-only', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'PROPOSED_20261111_historical_intelligence_batches.sql'), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.yarbi_historical_intelligence_batches from public, anon, authenticated, service_role/i);
  assert.match(sql, /requires_owner_review boolean not null default true check \(requires_owner_review\)/i);
  assert.match(sql, /commercial_effects_allowed boolean not null default false check \(not commercial_effects_allowed\)/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /historical_batch_claim_conflict/i);
  assert.match(sql, /historical_batch_result_binding_invalid/i);
  assert.match(sql, /fail_yarbi_historical_intelligence_batch/i);
  assert.match(sql, /list_yarbi_historical_intelligence_review_batches/i);
  assert.match(sql, /review_yarbi_historical_intelligence_batch/i);
  assert.match(sql, /historical_batch_review_conflict/i);
  assert.match(sql, /grant execute on function public\.enqueue_yarbi_historical_intelligence_batch/i);
  assert.doesNotMatch(sql, /grant select, insert, update on table public\.yarbi_historical_intelligence_batches to service_role/i);
});

test('claimed task validates immutable references before a provider could run', () => {
  const row = claimedTask({ batch_id: '11111111-1111-4111-8111-111111111111', ...TASK, attempt_count: 1 });
  assert.equal(row.attempt_count, 1);
  assert.throws(() => claimedTask({ batch_id: 'b', ...TASK, outgoing_message_ids: ['not-in-task'], attempt_count: 1 }), /historical_batch_claim_invalid/);
});

test('queue uses RPC only and retains the owner/task binding end to end', async () => {
  const calls = [];
  const supabase = async (path, init) => {
    calls.push({ path, body: JSON.parse(init.body) });
    const name = path.split('/').at(-1);
    if (name === 'enqueue_yarbi_historical_intelligence_batch') return { response: { ok: true }, data: [{ batch_id: '11111111-1111-4111-8111-111111111111', outcome: 'created', status: 'ready', attempt_count: 0 }] };
    if (name === 'claim_yarbi_historical_intelligence_batch') return { response: { ok: true }, data: [{ batch_id: '11111111-1111-4111-8111-111111111111', ...TASK, attempt_count: 1 }] };
    if (name === 'complete_yarbi_historical_intelligence_batch') return { response: { ok: true }, data: [{ batch_id: '11111111-1111-4111-8111-111111111111', status: 'awaiting_owner_review' }] };
    if (name === 'fail_yarbi_historical_intelligence_batch') return { response: { ok: true }, data: [{ batch_id: '11111111-1111-4111-8111-111111111111', status: 'failed' }] };
    throw new Error('unexpected rpc');
  };
  const queue = createHistoricalIntelligenceQueue({ supabase, now });
  await queue.enqueue({ ownerIdentity: OWNER, task: TASK });
  const task = await queue.claim({ ownerIdentity: OWNER });
  const result = { schema: 'yarbi.historical-intelligence-result.v1', task_key: TASK.idempotency_key, contact_id: '71', contact_context_observations: [], reply_style_patterns: [], requires_owner_review: true, commercial_effects_allowed: false, status: 'awaiting_owner_review' };
  await queue.complete({ ownerIdentity: OWNER, task, result });
  assert.deepEqual(calls.map(call => call.path.split('/').at(-1)), [
    'enqueue_yarbi_historical_intelligence_batch',
    'claim_yarbi_historical_intelligence_batch',
    'complete_yarbi_historical_intelligence_batch'
  ]);
  assert.equal(calls[2].body.p_proposal.commercial_effects_allowed, false);
  assert.equal(calls[2].body.p_proposal.requires_owner_review, true);
  assert.equal(calls[2].body.p_proposal.contact_id, '71');
});

test('queue failure is tied to the same claim and stores only a sanitized code', async () => {
  const calls = [];
  const queue = createHistoricalIntelligenceQueue({ supabase: async (path, init) => {
    calls.push({ path, body: JSON.parse(init.body) });
    return { response: { ok: true }, data: [{ batch_id: '11111111-1111-4111-8111-111111111111', status: 'failed' }] };
  } });
  const task = claimedTask({ batch_id: '11111111-1111-4111-8111-111111111111', ...TASK, attempt_count: 2 });
  const failed = await queue.fail({ ownerIdentity: OWNER, task, error_code: 'Provider message contains a phone +51 999 111 222' });
  assert.equal(failed.status, 'failed');
  assert.equal(calls[0].body.p_error_code, 'provider_message_contains_a_phone_51_999_111_222');
  assert.equal(failureCode('!!!'), 'historical_batch_processing_failed');
});

test('review queue returns only owner-bound proposals and makes identical decisions idempotent', async () => {
  const proposal = { schema:'yarbi.historical-intelligence-result.v1', contact_id:'71', contact_context_observations:[], reply_style_patterns:[] };
  const calls = [];
  const queue = createHistoricalIntelligenceQueue({ supabase: async (path, init) => {
    calls.push({ path, body:JSON.parse(init.body) });
    const name = path.split('/').at(-1);
    if (name === 'list_yarbi_historical_intelligence_review_batches') return { response:{ ok:true }, data:[{ batch_id:'11111111-1111-4111-8111-111111111111', contact_id:71, status:'awaiting_owner_review', segment_index:0, segment_count:1, proposal }] };
    if (name === 'review_yarbi_historical_intelligence_batch') return { response:{ ok:true }, data:[{ batch_id:'11111111-1111-4111-8111-111111111111', contact_id:71, status:'approved', proposal }] };
    throw new Error('unexpected rpc');
  } });
  const pending = await queue.listReview({ ownerIdentity:OWNER, limit:100 });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].proposal.commercial_effects_allowed, false);
  const approved = await queue.review({ ownerIdentity:OWNER, batch_id:pending[0].batch_id, decision:'approve' });
  assert.equal(approved.status, 'approved');
  assert.equal(calls[0].body.p_limit, 50);
  assert.equal(calls[1].body.p_decision, 'approved');
  await assert.rejects(() => queue.review({ ownerIdentity:OWNER, batch_id:pending[0].batch_id, decision:'erase_everything' }), /historical_batch_review_input_invalid/);
});
