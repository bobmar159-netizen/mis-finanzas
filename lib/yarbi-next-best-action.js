'use strict';

const ACTIONS = Object.freeze([
  'ask_for_service', 'ask_for_district', 'ask_for_location', 'ask_for_schedule',
  'confirm_visit', 'follow_up_customer', 'prepare_quote', 'review_context_conflict',
  'wait_for_customer', 'wait_for_business', 'no_action'
]);
const DECISIONS = Object.freeze(['propose', 'wait', 'no_action', 'blocked', 'needs_review']);
const PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent']);
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PRUDENCE_POLICY = Object.freeze({
  question_cooldown_ms: DAY_MS,
  follow_up_cooldown_ms: 3 * DAY_MS,
  customer_commitment_wait_ms: DAY_MS,
  max_consecutive_follow_ups: 2,
  enforce_business_hours: false,
  business_hours: Object.freeze({ start_hour: 8, end_hour: 19, time_zone: 'America/Lima' }),
  priority_by_status: Object.freeze({ frio: 'low', tibio: 'medium', caliente: 'high' })
});

function text(value, limit = 120) {
  return String(value ?? '').trim().slice(0, limit);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function timestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function iso(value) {
  const date = timestamp(value);
  return date ? date.toISOString() : null;
}

function mergePolicy(policy = {}) {
  const input = object(policy) || {};
  const hours = object(input.business_hours) || {};
  const priority = object(input.priority_by_status) || {};
  const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  return {
    question_cooldown_ms: positive(input.question_cooldown_ms, DEFAULT_PRUDENCE_POLICY.question_cooldown_ms),
    follow_up_cooldown_ms: positive(input.follow_up_cooldown_ms, DEFAULT_PRUDENCE_POLICY.follow_up_cooldown_ms),
    customer_commitment_wait_ms: positive(input.customer_commitment_wait_ms, DEFAULT_PRUDENCE_POLICY.customer_commitment_wait_ms),
    max_consecutive_follow_ups: positive(input.max_consecutive_follow_ups, DEFAULT_PRUDENCE_POLICY.max_consecutive_follow_ups),
    enforce_business_hours: input.enforce_business_hours === true,
    business_hours: {
      start_hour: positive(hours.start_hour, DEFAULT_PRUDENCE_POLICY.business_hours.start_hour),
      end_hour: positive(hours.end_hour, DEFAULT_PRUDENCE_POLICY.business_hours.end_hour),
      time_zone: text(hours.time_zone || DEFAULT_PRUDENCE_POLICY.business_hours.time_zone, 80)
    },
    priority_by_status: {
      frio: PRIORITIES.includes(priority.frio) ? priority.frio : DEFAULT_PRUDENCE_POLICY.priority_by_status.frio,
      tibio: PRIORITIES.includes(priority.tibio) ? priority.tibio : DEFAULT_PRUDENCE_POLICY.priority_by_status.tibio,
      caliente: PRIORITIES.includes(priority.caliente) ? priority.caliente : DEFAULT_PRUDENCE_POLICY.priority_by_status.caliente
    }
  };
}

function priorityFor(context, policy) {
  const status = text(context?.commercial?.status, 32).toLowerCase();
  return policy.priority_by_status[status] || 'low';
}

function decision({ context, decision, action, reason, priority, now, notBefore = null, evidence = [], blocks = [] }) {
  const contactId = Number(context?.contact_id);
  return {
    schema: 'yarbi.next-best-action.v1',
    contact_id: Number.isSafeInteger(contactId) && contactId > 0 ? contactId : null,
    decision,
    action,
    reason,
    priority,
    timing: {
      state: decision === 'propose' ? 'allowed_now' : (decision === 'no_action' ? 'not_needed' : 'deferred'),
      not_before: iso(notBefore)
    },
    requires_owner_confirmation: decision === 'propose',
    evidence: [...new Set(evidence.filter(Boolean))],
    blocks: [...new Set(blocks.filter(Boolean))]
  };
}

function factValue(context, name) {
  return object(context?.memory?.[name]);
}

function temporalBlock({ context, action, now, policy }) {
  const pending = factValue(context, 'pending_step');
  const business = factValue(context, 'business_commitment');
  const actionAt = timestamp(pending?.requested_at || pending?.last_action_at || business?.last_action_at);
  const matchingAction = text(pending?.action || business?.action, 80);
  if (!actionAt || matchingAction !== action) return null;
  const notBefore = new Date(actionAt.getTime() + policy.question_cooldown_ms);
  if (now < notBefore) return { notBefore, block: 'cooldown_active', evidence: `${action}.asked_at=${actionAt.toISOString()}` };
  return null;
}

function businessHoursBlock(now, policy) {
  if (!policy.enforce_business_hours) return null;
  try {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: policy.business_hours.time_zone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (Number.isFinite(hour) && (hour < policy.business_hours.start_hour || hour >= policy.business_hours.end_hour)) {
      return { block: 'outside_business_hours', evidence: `business_hour=${hour}` };
    }
  } catch (_) {
    return { block: 'business_hours_unavailable', evidence: 'business_hours=unavailable' };
  }
  return null;
}

function proposed(context, action, reason, now, policy, evidence) {
  const cooldown = temporalBlock({ context, action, now, policy });
  if (cooldown) {
    return decision({ context, decision: 'wait', action: 'wait_for_customer', reason: 'cooldown_active', priority: priorityFor(context, policy), now, notBefore: cooldown.notBefore, evidence: [...evidence, cooldown.evidence], blocks: [cooldown.block] });
  }
  const hours = businessHoursBlock(now, policy);
  if (hours) {
    return decision({ context, decision: 'wait', action: 'wait_for_business', reason: 'outside_business_hours', priority: priorityFor(context, policy), now, evidence: [...evidence, hours.evidence], blocks: [hours.block] });
  }
  return decision({ context, decision: 'propose', action, reason, priority: priorityFor(context, policy), now, evidence, blocks: [] });
}

function getNextBestAction({ context, now, policy } = {}) {
  const at = timestamp(now);
  if (!object(context) || context.schema !== 'yarbi.unified-contact.v1' || !Number.isSafeInteger(Number(context.contact_id)) || Number(context.contact_id) <= 0) {
    return decision({ context: { contact_id: null }, decision: 'needs_review', action: 'review_context_conflict', reason: 'unified_context_invalid', priority: 'low', now: at, evidence: [], blocks: ['context_invalid'] });
  }
  if (!at) {
    return decision({ context, decision: 'needs_review', action: 'review_context_conflict', reason: 'time_reference_invalid', priority: 'low', now: null, evidence: [], blocks: ['time_reference_invalid'] });
  }
  const effectivePolicy = mergePolicy(policy);
  const conflicts = Array.isArray(context.diagnostics) ? context.diagnostics.filter(item => item?.code === 'context_conflict') : [];
  if (conflicts.length) {
    return decision({ context, decision: 'needs_review', action: 'review_context_conflict', reason: 'context_conflict', priority: priorityFor(context, effectivePolicy), now: at, evidence: conflicts.map(conflict => `conflict.${conflict.field}`), blocks: ['context_conflict'] });
  }
  const commercial = object(context.commercial) || {};
  const memory = object(context.memory) || {};
  const customerCommitment = factValue(context, 'customer_commitment');
  const businessCommitment = factValue(context, 'business_commitment');
  const evidenceBase = [`commercial.status=${text(commercial.status, 32) || 'unknown'}`];

  if (customerCommitment?.kind === 'customer_will_reply') {
    const explicitNotBefore = timestamp(customerCommitment.not_before || customerCommitment.expected_at);
    const commitmentAt = timestamp(customerCommitment.at || customerCommitment.occurred_at || commercial.last_contact_at);
    const notBefore = explicitNotBefore || (commitmentAt ? new Date(commitmentAt.getTime() + effectivePolicy.customer_commitment_wait_ms) : null);
    return decision({ context, decision: 'wait', action: 'wait_for_customer', reason: 'customer_committed_to_reply', priority: priorityFor(context, effectivePolicy), now: at, notBefore, evidence: [...evidenceBase, 'customer_commitment=customer_will_reply'], blocks: ['customer_commitment_active'] });
  }

  if (businessCommitment) {
    const notBefore = timestamp(businessCommitment.not_before);
    if (notBefore && at < notBefore) {
      return decision({ context, decision: 'wait', action: 'wait_for_business', reason: 'business_commitment_not_due', priority: priorityFor(context, effectivePolicy), now: at, notBefore, evidence: [...evidenceBase, 'business_commitment=active'], blocks: ['waiting_for_business'] });
    }
    if (['send_quote', 'prepare_quote'].includes(text(businessCommitment.kind, 80))) {
      return proposed(context, 'prepare_quote', 'business_commitment_quote_pending', at, effectivePolicy, [...evidenceBase, 'business_commitment=quote_pending']);
    }
    return decision({ context, decision: 'wait', action: 'wait_for_business', reason: 'business_commitment_active', priority: priorityFor(context, effectivePolicy), now: at, evidence: [...evidenceBase, 'business_commitment=active'], blocks: ['waiting_for_business'] });
  }

  const visit = factValue(context, 'visit');
  const location = factValue(context, 'location');
  const pending = factValue(context, 'pending_step');
  const service = text(commercial.service, 80);
  const district = factValue(context, 'district');
  if (text(pending?.step, 80) === 'follow_up_due') {
    const followUps = Math.max(0, Number(pending?.consecutive_follow_ups || 0));
    if (followUps >= effectivePolicy.max_consecutive_follow_ups) {
      return decision({ context, decision: 'no_action', action: 'no_action', reason: 'follow_up_limit_reached', priority: priorityFor(context, effectivePolicy), now: at, evidence: [...evidenceBase, `follow_up_count=${followUps}`], blocks: ['follow_up_limit_reached'] });
    }
    const lastContact = timestamp(commercial.last_contact_at);
    const notBefore = lastContact ? new Date(lastContact.getTime() + effectivePolicy.follow_up_cooldown_ms) : null;
    if (notBefore && at < notBefore) {
      return decision({ context, decision: 'wait', action: 'wait_for_customer', reason: 'follow_up_cooldown_active', priority: priorityFor(context, effectivePolicy), now: at, notBefore, evidence: [...evidenceBase, 'pending_step=follow_up_due'], blocks: ['cooldown_active'] });
    }
    return proposed(context, 'follow_up_customer', 'follow_up_due', at, effectivePolicy, [...evidenceBase, 'pending_step=follow_up_due']);
  }
  if (visit?.requested === true && !location) {
    return proposed(context, 'ask_for_location', 'visit_requested_without_location', at, effectivePolicy, [...evidenceBase, 'memory.visit=requested', 'memory.location=null']);
  }
  if (visit?.requested === true && location && ['schedule_required', 'waiting_for_schedule'].includes(text(pending?.step, 80))) {
    return proposed(context, 'ask_for_schedule', 'visit_requested_without_schedule', at, effectivePolicy, [...evidenceBase, 'memory.visit=requested', 'memory.location=present', `pending_step=${pending.step}`]);
  }
  if (!service) {
    return proposed(context, 'ask_for_service', 'service_unknown', at, effectivePolicy, [...evidenceBase, 'commercial.service=null']);
  }
  if (text(commercial.status, 32) === 'tibio' && !district) {
    return proposed(context, 'ask_for_district', 'service_known_without_district', at, effectivePolicy, [...evidenceBase, `commercial.service=${service}`, 'memory.district=null']);
  }
  return decision({ context, decision: 'no_action', action: 'no_action', reason: 'not_needed_yet', priority: priorityFor(context, effectivePolicy), now: at, evidence: evidenceBase, blocks: [] });
}

module.exports = { ACTIONS, DECISIONS, DEFAULT_PRUDENCE_POLICY, PRIORITIES, getNextBestAction, mergePolicy };
