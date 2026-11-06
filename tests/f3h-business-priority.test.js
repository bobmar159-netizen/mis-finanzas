'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getBusinessPriorities } = require('../lib/yarbi-business-priority');

const NOW = '2026-10-30T15:00:00.000Z';

function context(id, status = 'frio', memory = {}) {
  return {
    schema: 'yarbi.unified-contact.v1', contact_id: id, found: true,
    identity: { display_name: `F3H ${id}`, phone: `900000${id}` },
    commercial: { status, service: 'reparacion', service_source: 'commercial_context', last_contact_at: '2026-10-29T10:00:00Z', last_contact_message_id: `F3H-${id}` },
    memory: { service: null, district: null, location: null, pending_step: null, visit: null, customer_commitment: null, business_commitment: null, objection: null, ...memory },
    missing: [], diagnostics: []
  };
}

function action(id, status, overrides = {}) {
  const ctx = context(id, status, overrides.memory || {});
  return {
    opportunity_id: `F3H-${id}`,
    contact_context: ctx,
    next_best_action: {
      schema: 'yarbi.next-best-action.v1', contact_id: id,
      decision: 'propose', action: 'ask_for_location', reason: 'visit_requested_without_location', priority: status === 'caliente' ? 'high' : (status === 'tibio' ? 'medium' : 'low'),
      timing: { state: 'allowed_now', not_before: null }, requires_owner_confirmation: true, evidence: [], blocks: [],
      ...(overrides.next || {})
    },
    estimated_value: overrides.estimated_value ?? null,
    scheduled_visit_at: overrides.scheduled_visit_at ?? null,
    last_owner_action_at: null
  };
}

function evaluate(opportunities, businessState = { date: '2026-10-30', daily_goal_amount: 700, confirmed_revenue_today: 0 }) {
  return getBusinessPriorities({ opportunities, businessState, now: NOW });
}

test('F3H ranks an allowed hot opportunity before allowed warm and cold opportunities', () => {
  const result = evaluate([action(1, 'frio'), action(2, 'tibio'), action(3, 'caliente')]);
  assert.equal(result.priorities[0].contact_id, 3);
  assert.equal(result.priorities[0].recommended_now, true);
});

test('F3H puts a due internal quote ahead of a hot customer commitment that must wait', () => {
  const hotWait = action(4, 'caliente', { next: { decision: 'wait', action: 'wait_for_customer', reason: 'customer_committed_to_reply', priority: 'high', timing: { not_before: '2026-10-31T15:00:00Z' } } });
  const quote = action(5, 'tibio', { memory: { business_commitment: { kind: 'send_quote', due_at: '2026-10-30T14:00:00Z' } }, next: { action: 'prepare_quote', reason: 'business_commitment_quote_pending', priority: 'medium' } });
  const result = evaluate([hotWait, quote]);
  assert.deepEqual([result.priorities[0].contact_id, result.priorities[0].action_kind], [5, 'internal']);
  assert.equal(result.owner_attention.some(item => item.type === 'business_commitment_due'), true);
});

test('F3H calculates a configurable daily goal without treating opportunities as revenue', () => {
  const result = evaluate([action(6, 'caliente', { estimated_value: 999 })], { date: '2026-10-30', daily_goal_amount: 700, confirmed_revenue_today: 430 });
  assert.deepEqual([result.business.confirmed_today, result.business.remaining_to_goal, result.business.goal_status], [430, 270, 'behind']);
  assert.equal(result.business.daily_goal, 700);
});

test('F3H reports goal met and unknown income honestly', () => {
  assert.deepEqual([evaluate([], { daily_goal_amount: 700, confirmed_revenue_today: 700 }).business.goal_status, evaluate([], { daily_goal_amount: 700 }).business.remaining_to_goal], ['goal_met', null]);
  assert.equal(evaluate([], { daily_goal_amount: 700 }).business.goal_status, 'unknown');
});

test('F3H uses known value only as a secondary tie breaker and does not penalize unknown value', () => {
  const lowValue = action(7, 'tibio', { estimated_value: 100 });
  const highValue = action(8, 'tibio', { estimated_value: 500 });
  const unknown = action(9, 'tibio');
  const result = evaluate([lowValue, unknown, highValue]);
  assert.deepEqual(result.priorities.slice(0, 2).map(item => item.contact_id), [8, 7]);
  assert.equal(result.priorities.some(item => item.contact_id === 9), true);
});

test('F3H never overrides 3G prudence for a low daily goal result', () => {
  const cooldown = action(10, 'caliente', { next: { decision: 'wait', action: 'wait_for_customer', reason: 'cooldown_active', priority: 'high', timing: { not_before: '2026-10-31T10:00:00Z' } } });
  const result = evaluate([cooldown], { daily_goal_amount: 700, confirmed_revenue_today: 0 });
  assert.deepEqual([result.priorities[0].recommended_now, result.priorities[0].action_kind], [false, 'wait']);
  assert.equal(result.owner_attention.some(item => item.type === 'daily_goal_significantly_behind'), true);
});

test('F3H preserves wait, review, near visit, capacity, determinism, and input immutability', () => {
  const waiting = action(11, 'caliente', { next: { decision: 'wait', action: 'wait_for_customer', reason: 'customer_committed_to_reply', priority: 'high', timing: { not_before: '2026-10-31T15:00:00Z' } } });
  const conflict = action(12, 'tibio', { next: { decision: 'needs_review', action: 'review_context_conflict', reason: 'context_conflict', priority: 'medium' } });
  const visit = action(13, 'caliente', { scheduled_visit_at: '2026-10-31T10:00:00Z' });
  const opportunities = [waiting, conflict, visit, action(14, 'frio'), action(15, 'frio'), action(16, 'frio'), action(17, 'frio'), action(18, 'frio')];
  const before = JSON.stringify(opportunities);
  const first = evaluate(opportunities);
  const second = evaluate(opportunities);
  assert.equal(JSON.stringify(opportunities), before);
  assert.deepEqual(first, second);
  assert.equal(first.summary.waiting, 1);
  assert.equal(first.summary.needs_review, 1);
  assert.equal(first.priorities.length, 5);
  assert.equal(first.priorities[0].contact_id, 13);
  assert.equal(first.priorities[0].why_ranked.includes('visit_near_without_location'), true);
});

test('F3H remains pure: it only uses supplied snapshots and has no egress or business side effects', () => {
  const fs = require('node:fs');
  const path = require.resolve('../lib/yarbi-business-priority');
  const source = fs.readFileSync(path, 'utf8');
  const output = evaluate([action(19, 'caliente')]);
  assert.equal(output.schema, 'yarbi.business-priority.v1');
  assert.equal(/fetch\s*\(|supabase|whatsapp|gemini|notion|calendar|agenda/i.test(source), false);
});
