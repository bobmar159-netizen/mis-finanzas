'use strict';

const crypto = require('node:crypto');

const DECISIONS = Object.freeze(['notify', 'defer', 'no_notification', 'escalate']);
const NOTIFICATION_MODES = Object.freeze(['interrupt', 'digest', 'none']);
const PRIORITY_LEVELS = Object.freeze({ low: 1, medium: 2, high: 3, urgent: 4 });
const OWNER_ITEM_TYPES = Object.freeze(['customer_action', 'internal_action', 'owner_review', 'business_goal', 'wait', 'informational']);

// Hours only apply when a caller supplies an explicit timezone. The module never
// infers the owner's timezone from the host machine.
const DEFAULT_OWNER_PROACTIVE_POLICY = Object.freeze({
  owner_notification_cooldown_ms: 2 * 60 * 60 * 1000,
  periodic_digest_interval_ms: 4 * 60 * 60 * 1000,
  max_items_per_brief: 5,
  urgent_bypass_cooldown: true,
  minimum_priority_to_interrupt: 'high',
  repeat_suppression_window_ms: 24 * 60 * 60 * 1000,
  digest_min_items: 2,
  notification_hours: Object.freeze({ enabled: false, start_hour: 8, end_hour: 21, time_zone: null })
});

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function text(value, limit = 160) { return String(value ?? '').trim().slice(0, limit); }
function timestamp(value) {
  if (value === null || value === undefined || text(value, 80) === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function iso(value) { const date = timestamp(value); return date ? date.toISOString() : null; }
function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
function priorityLevel(value) { return PRIORITY_LEVELS[text(value, 32)] || 0; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.keys(value).sort().reduce((result, key) => { result[key] = stable(value[key]); return result; }, {});
  return value;
}

function mergePolicy(policy = {}) {
  const input = object(policy) || {};
  const hours = object(input.notification_hours) || {};
  const minPriority = text(input.minimum_priority_to_interrupt || DEFAULT_OWNER_PROACTIVE_POLICY.minimum_priority_to_interrupt, 32);
  return {
    owner_notification_cooldown_ms: positiveInteger(input.owner_notification_cooldown_ms, DEFAULT_OWNER_PROACTIVE_POLICY.owner_notification_cooldown_ms),
    periodic_digest_interval_ms: positiveInteger(input.periodic_digest_interval_ms, DEFAULT_OWNER_PROACTIVE_POLICY.periodic_digest_interval_ms),
    max_items_per_brief: positiveInteger(input.max_items_per_brief, DEFAULT_OWNER_PROACTIVE_POLICY.max_items_per_brief),
    urgent_bypass_cooldown: input.urgent_bypass_cooldown !== false,
    minimum_priority_to_interrupt: PRIORITY_LEVELS[minPriority] ? minPriority : DEFAULT_OWNER_PROACTIVE_POLICY.minimum_priority_to_interrupt,
    repeat_suppression_window_ms: positiveInteger(input.repeat_suppression_window_ms, DEFAULT_OWNER_PROACTIVE_POLICY.repeat_suppression_window_ms),
    digest_min_items: positiveInteger(input.digest_min_items, DEFAULT_OWNER_PROACTIVE_POLICY.digest_min_items),
    notification_hours: {
      enabled: hours.enabled === true,
      start_hour: Math.min(23, positiveInteger(hours.start_hour, DEFAULT_OWNER_PROACTIVE_POLICY.notification_hours.start_hour)),
      end_hour: Math.min(24, positiveInteger(hours.end_hour, DEFAULT_OWNER_PROACTIVE_POLICY.notification_hours.end_hour)),
      time_zone: text(hours.time_zone, 80) || null
    }
  };
}

function actionToItemType(actionKind) {
  if (actionKind === 'customer_facing') return 'customer_action';
  if (actionKind === 'internal') return 'internal_action';
  if (actionKind === 'review') return 'owner_review';
  return 'wait';
}

function needsAuthorization(type, action) {
  if (type !== 'customer_action') return false;
  return ['ask_for_location', 'ask_for_service', 'ask_for_district', 'ask_for_schedule', 'follow_up_customer', 'confirm_visit'].includes(action);
}

function validBusinessPriority(value) {
  return object(value)?.schema === 'yarbi.business-priority.v1' && Array.isArray(value.priorities) && object(value.business) && object(value.summary);
}

function priorityItems(businessPriority) {
  return businessPriority.priorities
    .filter(item => object(item))
    .map(item => {
      const type = actionToItemType(text(item.action_kind, 40));
      return {
        type,
        contact_id: Number.isSafeInteger(Number(item.contact_id)) && Number(item.contact_id) > 0 ? Number(item.contact_id) : null,
        action: text(item.action, 80) || null,
        priority: PRIORITY_LEVELS[text(item.priority, 32)] ? text(item.priority, 32) : 'low',
        reason: Array.isArray(item.why_ranked) ? text(item.why_ranked[0], 160) || 'business_priority' : 'business_priority',
        requires_authorization: needsAuthorization(type, text(item.action, 80)),
        opportunity_id: text(item.opportunity_id, 120) || null
      };
    })
    .filter(item => item.type !== 'wait' || item.action === 'wait_for_customer');
}

function attentionItems(ownerAttention, actionableNow = 0) {
  return (Array.isArray(ownerAttention) ? ownerAttention : [])
    .filter(item => object(item))
    .filter(item => text(item.type, 120) !== 'daily_goal_significantly_behind' || actionableNow > 0)
    .map(item => ({
      type: 'owner_review',
      contact_id: Number.isSafeInteger(Number(item.contact_id)) && Number(item.contact_id) > 0 ? Number(item.contact_id) : null,
      action: text(item.action, 80) || null,
      priority: ['visit_near_without_location', 'business_commitment_due'].includes(text(item.type, 80)) ? 'urgent' : 'high',
      reason: text(item.type, 120) || 'owner_attention',
      requires_authorization: false,
      opportunity_id: text(item.opportunity_id, 120) || null
    }));
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = [item.type, item.contact_id || '', item.action || '', item.reason].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildGoalItem(business, actionableNow) {
  if (business?.goal_status !== 'behind' || !Number.isFinite(Number(business?.remaining_to_goal)) || actionableNow < 1) return null;
  return {
    type: 'business_goal', contact_id: null, action: 'review_business_goal', priority: 'medium',
    reason: 'goal_gap_with_actionable_opportunities', requires_authorization: false, opportunity_id: null
  };
}

function itemSort(left, right) {
  const byPriority = priorityLevel(right.priority) - priorityLevel(left.priority);
  if (byPriority) return byPriority;
  const typeRank = { owner_review: 4, internal_action: 3, customer_action: 2, business_goal: 1, wait: 0, informational: 0 };
  const byType = (typeRank[right.type] || 0) - (typeRank[left.type] || 0);
  if (byType) return byType;
  return [left.contact_id || 0, left.action || '', left.reason || ''].join('|').localeCompare([right.contact_id || 0, right.action || '', right.reason || ''].join('|'));
}

function notificationFingerprint(items, business) {
  const source = {
    items: items.map(item => ({ type: item.type, contact_id: item.contact_id, action: item.action, priority: item.priority, reason: item.reason })),
    goal: items.some(item => item.type === 'business_goal') ? { daily_goal: business.daily_goal, remaining_to_goal: business.remaining_to_goal, goal_status: business.goal_status } : null
  };
  return `f3i:${crypto.createHash('sha256').update(JSON.stringify(stable(source))).digest('hex').slice(0, 32)}`;
}

function recentFingerprintState(state, fingerprint, now, policy) {
  const source = object(state) || {};
  const recent = Array.isArray(source.recent_fingerprints) ? source.recent_fingerprints : [];
  const entries = recent.concat(source.last_fingerprint ? [{ fingerprint: source.last_fingerprint, notified_at: source.last_notified_at }] : []);
  const match = entries.find(entry => text(entry?.fingerprint, 80) === fingerprint && timestamp(entry?.notified_at));
  if (!match) return null;
  const at = timestamp(match.notified_at);
  const until = new Date(at.getTime() + policy.repeat_suppression_window_ms);
  return until > now ? { at, until } : null;
}

function inNonUrgentHours(now, policy) {
  const schedule = policy.notification_hours;
  if (!schedule.enabled) return { allowed: true };
  if (!schedule.time_zone) return { allowed: false, reason: 'notification_schedule_timezone_missing' };
  try {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: schedule.time_zone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (!Number.isFinite(hour)) return { allowed: false, reason: 'notification_schedule_unavailable' };
    const allowed = schedule.start_hour <= schedule.end_hour
      ? hour >= schedule.start_hour && hour < schedule.end_hour
      : hour >= schedule.start_hour || hour < schedule.end_hour;
    return allowed ? { allowed: true } : { allowed: false, reason: 'outside_notification_hours' };
  } catch (_) {
    return { allowed: false, reason: 'notification_schedule_unavailable' };
  }
}

function futureReview({ businessPriority, state, now, policy, extra = [], notBefore = null }) {
  const floor = timestamp(notBefore) && timestamp(notBefore) > now ? timestamp(notBefore) : now;
  const values = [timestamp(businessPriority?.next_review_at), timestamp(state?.last_notified_at), ...extra.map(timestamp)]
    .filter(date => date && date > floor);
  const fallback = new Date(Math.max(now.getTime() + policy.periodic_digest_interval_ms, floor.getTime()));
  values.push(fallback);
  values.sort((a, b) => a - b);
  return values[0].toISOString();
}

function baseBrief({ businessPriority, now, policy }) {
  const business = businessPriority.business;
  const top = priorityItems(businessPriority);
  const attention = attentionItems(businessPriority.owner_attention, Number(businessPriority.summary.actionable_now || 0));
  // Una espera prudente queda representada en 3H, pero no debe convertirse por
  // sí sola en una interrupción ni en un brief para el dueño.
  const visible = dedupeItems([...top.filter(item => item.type !== 'wait'), ...attention]);
  const goal = buildGoalItem(business, Number(businessPriority.summary.actionable_now || 0));
  if (goal) visible.push(goal);
  const sorted = dedupeItems(visible).sort(itemSort);
  const items = sorted.slice(0, policy.max_items_per_brief);
  return {
    items,
    all_items: sorted,
    business_snapshot: {
      daily_goal: business.daily_goal,
      confirmed_today: business.confirmed_today,
      remaining_to_goal: business.remaining_to_goal,
      goal_status: business.goal_status,
      currency: business.currency
    }
  };
}

function buildOwnerProactiveBrief({ businessPriority, previousNotificationState, now, policy } = {}) {
  const at = timestamp(now);
  if (!at) throw new Error('owner_proactive_time_invalid');
  const effectivePolicy = mergePolicy(policy);
  if (!validBusinessPriority(businessPriority)) {
    return {
      schema: 'yarbi.owner-proactive-brief.v1', evaluated_at: at.toISOString(), decision: 'no_notification', urgency: 'low',
      reason: 'business_priority_invalid', business_snapshot: null, headline: { type: 'no_actionable_business_brief', count: 0 }, items: [], suppressed: [],
      next_review_at: new Date(at.getTime() + effectivePolicy.periodic_digest_interval_ms).toISOString(), notification_mode: 'none', notification_fingerprint: null
    };
  }
  const state = object(previousNotificationState) || {};
  const prepared = baseBrief({ businessPriority, now: at, policy: effectivePolicy });
  const fingerprint = notificationFingerprint(prepared.items, prepared.business_snapshot);
  const hasUrgent = prepared.items.some(item => item.priority === 'urgent');
  const maxPriority = prepared.items.reduce((value, item) => Math.max(value, priorityLevel(item.priority)), 0);
  const interruptEligible = maxPriority >= priorityLevel(effectivePolicy.minimum_priority_to_interrupt);
  const hasActionable = Number(businessPriority.summary.actionable_now || 0) > 0;
  const fingerprintRecent = recentFingerprintState(state, fingerprint, at, effectivePolicy);
  const lastNotified = timestamp(state.last_notified_at);
  const cooldownUntil = lastNotified ? new Date(lastNotified.getTime() + effectivePolicy.owner_notification_cooldown_ms) : null;
  const inCooldown = cooldownUntil && cooldownUntil > at;
  const schedule = inNonUrgentHours(at, effectivePolicy);
  const suppressed = [];
  let decision = 'no_notification';
  let mode = 'none';
  let reason = 'nothing_actionable';

  if (!prepared.items.length) {
    reason = 'nothing_actionable';
  } else if (fingerprintRecent) {
    reason = 'duplicate_recent_notification';
    suppressed.push({ reason, fingerprint, until: fingerprintRecent.until.toISOString() });
  } else if (hasUrgent && (!inCooldown || effectivePolicy.urgent_bypass_cooldown)) {
    decision = 'escalate';
    mode = 'interrupt';
    reason = 'urgent_owner_attention';
  } else if (inCooldown) {
    decision = 'defer';
    reason = 'owner_notification_cooldown';
    suppressed.push({ reason, until: cooldownUntil.toISOString() });
  } else if (!schedule.allowed) {
    decision = 'defer';
    reason = schedule.reason;
    suppressed.push({ reason: schedule.reason });
  } else if (interruptEligible && hasActionable) {
    decision = 'notify';
    mode = 'interrupt';
    reason = 'actionable_business_items';
  } else if (prepared.items.length >= effectivePolicy.digest_min_items) {
    decision = 'notify';
    mode = 'digest';
    reason = 'accumulated_business_items';
  } else {
    decision = 'defer';
    reason = 'accumulate_for_digest';
  }

  const extraReview = [];
  if (fingerprintRecent) extraReview.push(fingerprintRecent.until);
  if (inCooldown) extraReview.push(cooldownUntil);
  const reviewFloor = fingerprintRecent?.until || (inCooldown ? cooldownUntil : null);
  const nextReview = futureReview({ businessPriority, state, now: at, policy: effectivePolicy, extra: extraReview, notBefore: reviewFloor });
  return {
    schema: 'yarbi.owner-proactive-brief.v1',
    evaluated_at: at.toISOString(),
    decision,
    urgency: hasUrgent ? 'urgent' : (maxPriority >= priorityLevel('high') ? 'high' : (maxPriority >= priorityLevel('medium') ? 'medium' : 'low')),
    reason,
    business_snapshot: prepared.business_snapshot,
    headline: { type: prepared.items.length ? 'business_attention_required' : 'no_actionable_business_brief', count: prepared.items.length },
    items: prepared.items,
    suppressed,
    next_review_at: nextReview,
    notification_mode: mode,
    notification_fingerprint: fingerprint
  };
}

module.exports = { DECISIONS, DEFAULT_OWNER_PROACTIVE_POLICY, NOTIFICATION_MODES, OWNER_ITEM_TYPES, buildOwnerProactiveBrief, mergePolicy };
