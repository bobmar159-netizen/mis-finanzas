'use strict';

// Motor puro: recibe snapshots preparados por 3F + 3G. No lee ni escribe base
// de datos y nunca ejecuta una acción comercial.
const PRIORITY_LEVELS = Object.freeze({ low: 1, medium: 2, high: 3, urgent: 4 });
const COMMERCIAL_STATUSES = new Set(['frio', 'tibio', 'caliente']);
const ACTION_KINDS = Object.freeze({
  ask_for_service: 'customer_facing',
  ask_for_district: 'customer_facing',
  ask_for_location: 'customer_facing',
  ask_for_schedule: 'customer_facing',
  confirm_visit: 'customer_facing',
  follow_up_customer: 'customer_facing',
  prepare_quote: 'internal',
  review_context_conflict: 'review',
  wait_for_customer: 'wait',
  wait_for_business: 'wait',
  no_action: 'wait'
});

const DEFAULT_BUSINESS_PRIORITY_POLICY = Object.freeze({
  daily_goal_amount: 700,
  currency: 'PEN',
  max_top_priorities: 5,
  visit_urgent_window_ms: 24 * 60 * 60 * 1000,
  periodic_review_ms: 4 * 60 * 60 * 1000,
  significant_goal_gap_ratio: 0.5
});

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value, limit = 160) {
  return String(value ?? '').trim().slice(0, limit);
}

function nonNegativeNumber(value) {
  if (value === null || value === undefined || text(value, 80) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function timestamp(value) {
  if (value === null || value === undefined || text(value, 80) === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function iso(value) {
  const date = timestamp(value);
  return date ? date.toISOString() : null;
}

function mergePolicy(policy = {}) {
  const input = object(policy) || {};
  const dailyGoal = nonNegativeNumber(input.daily_goal_amount);
  const ratio = nonNegativeNumber(input.significant_goal_gap_ratio);
  return {
    daily_goal_amount: dailyGoal === null ? DEFAULT_BUSINESS_PRIORITY_POLICY.daily_goal_amount : dailyGoal,
    currency: text(input.currency || DEFAULT_BUSINESS_PRIORITY_POLICY.currency, 12) || 'PEN',
    max_top_priorities: positiveInteger(input.max_top_priorities, DEFAULT_BUSINESS_PRIORITY_POLICY.max_top_priorities),
    visit_urgent_window_ms: positiveInteger(input.visit_urgent_window_ms, DEFAULT_BUSINESS_PRIORITY_POLICY.visit_urgent_window_ms),
    periodic_review_ms: positiveInteger(input.periodic_review_ms, DEFAULT_BUSINESS_PRIORITY_POLICY.periodic_review_ms),
    significant_goal_gap_ratio: ratio === null ? DEFAULT_BUSINESS_PRIORITY_POLICY.significant_goal_gap_ratio : Math.min(ratio, 1)
  };
}

function normalizeBusinessState(businessState, policy) {
  const source = object(businessState) || {};
  const configuredGoal = nonNegativeNumber(source.daily_goal_amount);
  const confirmed = nonNegativeNumber(source.confirmed_revenue_today);
  const pendingCollections = nonNegativeNumber(source.pending_collections_today);
  const scheduledJobs = nonNegativeNumber(source.scheduled_jobs_today);
  const capacity = source.available_capacity_today === null || source.available_capacity_today === undefined
    ? null : nonNegativeNumber(source.available_capacity_today);
  const dailyGoal = configuredGoal === null ? policy.daily_goal_amount : configuredGoal;
  const remaining = confirmed === null ? null : Math.max(0, dailyGoal - confirmed);
  // "on_track" needs a trusted trajectory, which this compact input does not
  // contain. Being below a defined daily goal is explicit; it is never used to
  // bypass the prudence result calculated in 3G.
  const goalStatus = confirmed === null ? 'unknown' : (confirmed >= dailyGoal ? 'goal_met' : 'behind');
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(text(source.date, 10)) ? text(source.date, 10) : null,
    daily_goal: dailyGoal,
    confirmed_today: confirmed,
    pending_collections_today: pendingCollections,
    scheduled_jobs_today: scheduledJobs,
    available_capacity_today: capacity,
    currency: text(source.currency || policy.currency, 12) || policy.currency,
    remaining_to_goal: remaining,
    goal_status: goalStatus
  };
}

function actionKind(action) {
  return ACTION_KINDS[text(action, 80)] || 'review';
}

function commercialStatus(context) {
  const value = text(context?.commercial?.status, 32).toLowerCase();
  return COMMERCIAL_STATUSES.has(value) ? value : 'frio';
}

function contactId(context) {
  const value = Number(context?.contact_id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isValidContext(context) {
  return object(context)?.schema === 'yarbi.unified-contact.v1' && contactId(context) !== null;
}

function isValidDecision(decision) {
  return object(decision)?.schema === 'yarbi.next-best-action.v1'
    && ['propose', 'wait', 'no_action', 'blocked', 'needs_review'].includes(text(decision.decision, 32));
}

function priorityRank(priority) {
  return PRIORITY_LEVELS[text(priority, 32)] || 0;
}

function scheduledUrgency(scheduledVisitAt, now, policy) {
  const visitAt = timestamp(scheduledVisitAt);
  if (!visitAt) return { level: 0, at: null };
  const delta = visitAt.getTime() - now.getTime();
  if (delta <= 0) return { level: 4, at: visitAt };
  if (delta <= policy.visit_urgent_window_ms) return { level: 3, at: visitAt };
  return { level: 1, at: visitAt };
}

function commitmentDue(context, now) {
  const commitment = object(context?.memory?.business_commitment);
  if (!commitment) return { due: false, dueAt: null };
  const dueAt = timestamp(commitment.not_before || commitment.due_at || commitment.expected_at);
  return { due: !dueAt || dueAt <= now, dueAt };
}

function makeCandidate(opportunity, index, now, policy) {
  const source = object(opportunity) || {};
  const context = object(source.contact_context);
  const next = object(source.next_best_action);
  const id = text(source.opportunity_id, 120) || `opportunity-${index + 1}`;
  if (!isValidContext(context) || !isValidDecision(next) || next.contact_id !== contactId(context)) {
    return {
      opportunity_id: id,
      contact_id: contactId(context),
      classification: 'review',
      recommended_now: false,
      action: 'review_context_conflict',
      action_kind: 'review',
      priority: 'low',
      why_ranked: ['opportunity_contract_invalid'],
      rank_tuple: [0, 0, 0, 0, id],
      next_review_at: null,
      owner_attention: { type: 'invalid_opportunity_snapshot', opportunity_id: id }
    };
  }

  const status = commercialStatus(context);
  const action = text(next.action, 80) || 'review_context_conflict';
  const kind = actionKind(action);
  const estimatedValue = nonNegativeNumber(source.estimated_value);
  const urgency = scheduledUrgency(source.scheduled_visit_at, now, policy);
  const commitment = commitmentDue(context, now);
  const why = [];
  const owner = [];
  let classification = kind;
  let recommendedNow = next.decision === 'propose';
  let tier = priorityRank(next.priority);
  let dueRank = 0;

  if (next.decision === 'needs_review' || kind === 'review') {
    classification = 'review';
    recommendedNow = false;
    tier = 4;
    dueRank = 4;
    why.push('context_requires_review');
    owner.push('context_conflict');
  } else if (next.decision === 'propose') {
    why.push(`action_allowed_now:${action}`);
    why.push(`commercial_status:${status}`);
    if (action === 'prepare_quote' && commitment.due) {
      tier = 4;
      dueRank = 4;
      why.push('business_commitment_due');
      owner.push('business_commitment_due');
    }
    if (action === 'ask_for_location' && urgency.level >= 3) {
      tier = 4;
      dueRank = urgency.level;
      why.push('visit_near_without_location');
      owner.push('visit_near_without_location');
    } else if (urgency.level > 0) {
      dueRank = urgency.level;
      why.push('scheduled_visit_present');
    }
  } else if (next.decision === 'wait') {
    classification = 'wait';
    recommendedNow = false;
    why.push(`prudence_wait:${next.reason || action}`);
  } else {
    classification = 'wait';
    recommendedNow = false;
    why.push(`no_action:${next.reason || action}`);
  }

  if (estimatedValue !== null) why.push('known_estimated_value');
  const timing = timestamp(next?.timing?.not_before);
  const nextReview = [timing, urgency.at, commitment.dueAt].filter(Boolean).sort((a, b) => a - b)[0] || null;
  return {
    opportunity_id: id,
    contact_id: contactId(context),
    classification,
    recommended_now: recommendedNow,
    action,
    action_kind: classification === 'review' ? 'review' : kind,
    priority: tier >= 4 ? 'urgent' : (tier >= 3 ? 'high' : (tier >= 2 ? 'medium' : 'low')),
    commercial_status: status,
    estimated_value: estimatedValue,
    scheduled_visit_at: iso(urgency.at),
    why_ranked: [...new Set(why)],
    rank_tuple: [recommendedNow ? 1 : 0, tier, dueRank, estimatedValue === null ? 0 : 1, id],
    next_review_at: iso(nextReview),
    owner_attention: owner.map(type => ({ type, opportunity_id: id, contact_id: contactId(context), action }))
  };
}

function compareCandidates(left, right) {
  const a = left.rank_tuple;
  const b = right.rank_tuple;
  for (let index = 0; index < 4; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  const leftVisit = timestamp(left.scheduled_visit_at)?.getTime() || Number.MAX_SAFE_INTEGER;
  const rightVisit = timestamp(right.scheduled_visit_at)?.getTime() || Number.MAX_SAFE_INTEGER;
  if (leftVisit !== rightVisit) return leftVisit - rightVisit;
  if ((left.estimated_value ?? -1) !== (right.estimated_value ?? -1)) return (right.estimated_value ?? -1) - (left.estimated_value ?? -1);
  return left.opportunity_id.localeCompare(right.opportunity_id);
}

function getBusinessPriorities({ opportunities, businessState, now, policy } = {}) {
  const at = timestamp(now);
  if (!at) throw new Error('business_priority_time_invalid');
  const effectivePolicy = mergePolicy(policy);
  const business = normalizeBusinessState(businessState, effectivePolicy);
  const candidates = (Array.isArray(opportunities) ? opportunities : [])
    .map((opportunity, index) => makeCandidate(opportunity, index, at, effectivePolicy));
  const ranked = candidates.slice().sort(compareCandidates);
  const actionable = ranked.filter(item => item.recommended_now);
  const ownerAttention = ranked.flatMap(item => item.owner_attention);
  if (business.goal_status === 'behind' && business.remaining_to_goal !== null
      && business.daily_goal > 0 && business.remaining_to_goal >= business.daily_goal * effectivePolicy.significant_goal_gap_ratio) {
    ownerAttention.push({ type: 'daily_goal_significantly_behind', remaining_to_goal: business.remaining_to_goal, daily_goal: business.daily_goal });
  }
  if (actionable.filter(item => item.commercial_status === 'caliente').length > effectivePolicy.max_top_priorities) {
    ownerAttention.push({ type: 'hot_opportunity_capacity_exceeded', count: actionable.filter(item => item.commercial_status === 'caliente').length });
  }

  const reviewTimes = ranked.map(item => timestamp(item.next_review_at)).filter(Boolean);
  reviewTimes.push(new Date(at.getTime() + effectivePolicy.periodic_review_ms));
  const nextReview = reviewTimes.sort((a, b) => a - b)[0];
  const summary = {
    open_opportunities: candidates.length,
    hot: candidates.filter(item => item.commercial_status === 'caliente').length,
    warm: candidates.filter(item => item.commercial_status === 'tibio').length,
    cold: candidates.filter(item => item.commercial_status === 'frio').length,
    actionable_now: actionable.length,
    waiting: candidates.filter(item => item.classification === 'wait').length,
    needs_review: candidates.filter(item => item.classification === 'review').length
  };
  return {
    schema: 'yarbi.business-priority.v1',
    evaluated_at: at.toISOString(),
    business,
    summary,
    priorities: ranked.slice(0, effectivePolicy.max_top_priorities).map((item, index) => ({
      rank: index + 1,
      opportunity_id: item.opportunity_id,
      contact_id: item.contact_id,
      action: item.action,
      action_kind: item.action_kind,
      priority: item.priority,
      commercial_status: item.commercial_status,
      estimated_value: item.estimated_value,
      scheduled_visit_at: item.scheduled_visit_at,
      recommended_now: item.recommended_now,
      why_ranked: item.why_ranked
    })),
    owner_attention: ownerAttention,
    next_review_at: nextReview.toISOString()
  };
}

module.exports = {
  ACTION_KINDS,
  DEFAULT_BUSINESS_PRIORITY_POLICY,
  getBusinessPriorities,
  mergePolicy,
  normalizeBusinessState
};
