'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOwnerProactiveBrief } = require('../lib/yarbi-owner-proactive-orchestrator');

const NOW = '2026-10-30T15:00:00.000Z';

function priority(id, action = 'ask_for_location', level = 'high', kind = 'customer_facing') {
  return { rank: id, opportunity_id: `F3I-${id}`, contact_id: id, action, action_kind: kind, priority: level, commercial_status: level === 'low' ? 'frio' : 'caliente', recommended_now: kind !== 'wait', why_ranked: ['F3I-fixture'] };
}
function state(overrides = {}) {
  return {
    schema: 'yarbi.business-priority.v1', evaluated_at: NOW,
    business: { daily_goal: 700, confirmed_today: 430, remaining_to_goal: 270, goal_status: 'behind', currency: 'PEN' },
    summary: { open_opportunities: 2, hot: 1, warm: 1, cold: 0, actionable_now: 2, waiting: 0, needs_review: 0 },
    priorities: [priority(1), priority(2, 'prepare_quote', 'medium', 'internal')], owner_attention: [], next_review_at: '2026-10-30T19:00:00.000Z',
    ...overrides
  };
}
function brief(value, notificationState = {}, policy = {}) { return buildOwnerProactiveBrief({ businessPriority: value, previousNotificationState: notificationState, now: NOW, policy }); }

test('F3I notifies for a due quote and does not interrupt customer cooldown or customer-will-reply waits', () => {
  const quote = state({ priorities: [priority(1, 'prepare_quote', 'urgent', 'internal')], owner_attention: [{ type: 'business_commitment_due', contact_id: 1, action: 'prepare_quote' }], summary: { ...state().summary, actionable_now: 1 } });
  assert.equal(brief(quote).decision, 'escalate');
  const waits = state({ priorities: [priority(2, 'wait_for_customer', 'high', 'wait')], summary: { ...state().summary, actionable_now: 0, waiting: 1 } });
  assert.equal(brief(waits).decision, 'no_notification');
});

test('F3I escalates a near visit blocked by location only when 3H supplied it as urgent actionable', () => {
  const visit = state({ priorities: [priority(3, 'ask_for_location', 'urgent')], owner_attention: [{ type: 'visit_near_without_location', contact_id: 3, action: 'ask_for_location' }], summary: { ...state().summary, actionable_now: 1 } });
  const result = brief(visit);
  assert.deepEqual([result.decision, result.notification_mode, result.urgency], ['escalate', 'interrupt', 'urgent']);
});

test('F3I honors urgent_bypass_cooldown: false and only bypasses when policy explicitly permits it', () => {
  const urgent = state({ priorities: [priority(31, 'ask_for_location', 'urgent')], owner_attention: [{ type: 'visit_near_without_location', contact_id: 31, action: 'ask_for_location' }], summary: { ...state().summary, actionable_now: 1 } });
  const notificationState = { last_notified_at: '2026-10-30T14:30:00.000Z' };
  const blocked = brief(urgent, notificationState, { urgent_bypass_cooldown: false });
  const bypassed = brief(urgent, notificationState, { urgent_bypass_cooldown: true });
  assert.deepEqual([blocked.decision, blocked.reason], ['defer', 'owner_notification_cooldown']);
  assert.deepEqual([bypassed.decision, bypassed.reason], ['escalate', 'urgent_owner_attention']);
});

test('F3I suppresses an unchanged recent notification but allows a materially changed action fingerprint', () => {
  const first = brief(state());
  const repeated = brief(state(), { last_notified_at: NOW, last_fingerprint: first.notification_fingerprint });
  assert.deepEqual([repeated.decision, repeated.reason], ['no_notification', 'duplicate_recent_notification']);
  const changed = brief(state({ priorities: [priority(1, 'ask_for_schedule', 'high')], summary: { ...state().summary, actionable_now: 1 } }), { last_notified_at: NOW, last_fingerprint: first.notification_fingerprint });
  assert.notEqual(changed.notification_fingerprint, first.notification_fingerprint);
  assert.equal(changed.decision, 'defer');
});

test('F3I includes a goal gap only with actionable work and does not spam a goal alone', () => {
  const noWork = state({ priorities: [], summary: { ...state().summary, actionable_now: 0 } });
  assert.equal(brief(noWork).decision, 'no_notification');
  const withWork = brief(state());
  assert.equal(withWork.items.some(item => item.type === 'business_goal'), true);
});

test('F3I creates a digest for accumulated low priority work and respects item caps', () => {
  const lows = state({ priorities: [priority(1, 'ask_for_service', 'low'), priority(2, 'ask_for_district', 'low'), priority(3, 'ask_for_location', 'low')], owner_attention: [], summary: { ...state().summary, actionable_now: 3 } });
  const result = brief(lows, {}, { max_items_per_brief: 2 });
  assert.deepEqual([result.decision, result.notification_mode, result.items.length], ['notify', 'digest', 2]);
  const deduped = brief(state({ owner_attention: [{ type: 'context_conflict', contact_id: 4 }, { type: 'context_conflict', contact_id: 4 }] }));
  assert.equal(deduped.items.filter(item => item.reason === 'context_conflict').length, 1);
});

test('F3I keeps next review future, preserves 3H future review, is deterministic and does not mutate inputs', () => {
  const input = state({ next_review_at: '2026-10-30T14:00:00.000Z' });
  const previous = { last_notified_at: '2026-10-30T14:30:00.000Z' };
  const before = JSON.stringify([input, previous]);
  const first = brief(input, previous), second = brief(input, previous);
  assert.equal(JSON.stringify([input, previous]), before);
  assert.deepEqual(first, second);
  assert.ok(new Date(first.next_review_at) > new Date(NOW));
  assert.equal(first.next_review_at, '2026-10-30T19:00:00.000Z');
  const future = brief(state({ next_review_at: '2026-10-30T16:00:00.000Z' }), {}, { periodic_digest_interval_ms: 12 * 60 * 60 * 1000 });
  assert.equal(future.next_review_at, '2026-10-30T16:00:00.000Z');
});

test('F3I is pure and exposes authorization without CRM, memory, WhatsApp, Agenda, Gemini or egress', () => {
  const source = require('node:fs').readFileSync(require.resolve('../lib/yarbi-owner-proactive-orchestrator'), 'utf8');
  const result = brief(state());
  assert.equal(result.items.find(item => item.action === 'ask_for_location').requires_authorization, true);
  assert.equal(result.items.find(item => item.action === 'prepare_quote').requires_authorization, false);
  assert.equal(/fetch\s*\(|supabase|whatsapp|gemini|agenda|calendar|notion/i.test(source), false);
});
