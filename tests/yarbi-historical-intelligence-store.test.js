'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { batchRow, proposalPatch } = require('../lib/yarbi-historical-intelligence-store');

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
  assert.match(sql, /revoke all on table public\.yarbi_historical_intelligence_batches from public, anon, authenticated/i);
  assert.match(sql, /requires_owner_review boolean not null default true check \(requires_owner_review\)/i);
  assert.match(sql, /commercial_effects_allowed boolean not null default false check \(not commercial_effects_allowed\)/i);
});
