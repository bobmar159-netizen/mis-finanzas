'use strict';

const { getNextBestAction } = require('./yarbi-next-best-action');
const { getBusinessPriorities } = require('./yarbi-business-priority');
const { buildOwnerProactiveBrief } = require('./yarbi-owner-proactive-orchestrator');

const DEFAULT_PROACTIVE_LOOP_POLICY = Object.freeze({
  interval_ms: 15 * 60 * 1000,
  candidate_limit: 50,
  owner_key: 'primary',
  daily_goal_amount: 700,
  currency: 'PEN',
  retry_backoff_ms: 15 * 60 * 1000
});

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function text(value, limit = 160) { return String(value ?? '').trim().slice(0, limit); }
function timestamp(value) {
  if (value === null || value === undefined || text(value, 80) === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
function sanitizeError(error, fallback) {
  const code = text(error?.code || error?.name || fallback, 80).replace(/[^a-zA-Z0-9_.:-]/g, '_');
  return code || fallback;
}

function mergePolicy(policy = {}) {
  const input = object(policy) || {};
  return {
    interval_ms: positiveInteger(input.interval_ms, DEFAULT_PROACTIVE_LOOP_POLICY.interval_ms),
    candidate_limit: Math.min(200, positiveInteger(input.candidate_limit, DEFAULT_PROACTIVE_LOOP_POLICY.candidate_limit)),
    owner_key: text(input.owner_key || DEFAULT_PROACTIVE_LOOP_POLICY.owner_key, 80) || 'primary',
    daily_goal_amount: Number.isFinite(Number(input.daily_goal_amount)) && Number(input.daily_goal_amount) >= 0 ? Number(input.daily_goal_amount) : DEFAULT_PROACTIVE_LOOP_POLICY.daily_goal_amount,
    currency: text(input.currency || DEFAULT_PROACTIVE_LOOP_POLICY.currency, 12) || 'PEN',
    retry_backoff_ms: positiveInteger(input.retry_backoff_ms, DEFAULT_PROACTIVE_LOOP_POLICY.retry_backoff_ms),
    // Solo el runner aislado puede suministrar este prefijo; no es una regla de negocio.
    fixture_candidate_prefix: text(input.fixture_candidate_prefix, 80) || null,
    next_best_action_policy: object(input.next_best_action_policy) || {},
    business_priority_policy: object(input.business_priority_policy) || {},
    owner_proactive_policy: object(input.owner_proactive_policy) || {}
  };
}

function buildRunKey({ ownerKey = 'primary', now, intervalMs }) {
  const at = timestamp(now);
  if (!at) throw new Error('proactive_loop_time_invalid');
  const slot = Math.floor(at.getTime() / positiveInteger(intervalMs, DEFAULT_PROACTIVE_LOOP_POLICY.interval_ms));
  return `yarbi-proactive:${text(ownerKey, 80) || 'primary'}:${slot}`;
}

function normalizeBusinessState(value, now, policy) {
  const input = object(value) || {};
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(text(input.date, 10)) ? text(input.date, 10) : now.toISOString().slice(0, 10),
    daily_goal_amount: Number.isFinite(Number(input.daily_goal_amount)) ? Number(input.daily_goal_amount) : policy.daily_goal_amount,
    confirmed_revenue_today: input.confirmed_revenue_today !== null && input.confirmed_revenue_today !== undefined
      && Number.isFinite(Number(input.confirmed_revenue_today)) && Number(input.confirmed_revenue_today) >= 0 ? Number(input.confirmed_revenue_today) : null,
    pending_collections_today: Number.isFinite(Number(input.pending_collections_today)) && Number(input.pending_collections_today) >= 0 ? Number(input.pending_collections_today) : null,
    scheduled_jobs_today: Number.isFinite(Number(input.scheduled_jobs_today)) && Number(input.scheduled_jobs_today) >= 0 ? Number(input.scheduled_jobs_today) : 0,
    available_capacity_today: input.available_capacity_today === null || input.available_capacity_today === undefined ? null : Number(input.available_capacity_today),
    currency: text(input.currency || policy.currency, 12) || policy.currency
  };
}

function normalizeCandidates(value, limit) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter(candidate => {
    const id = Number(candidate?.contact_id);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, limit).map(candidate => ({
    contact_id: Number(candidate.contact_id),
    opportunity_id: text(candidate.opportunity_id, 120) || `contact:${candidate.contact_id}`,
    estimated_value: Number.isFinite(Number(candidate.estimated_value)) && Number(candidate.estimated_value) >= 0 ? Number(candidate.estimated_value) : null,
    scheduled_visit_at: timestamp(candidate.scheduled_visit_at)?.toISOString() || null,
    last_owner_action_at: timestamp(candidate.last_owner_action_at)?.toISOString() || null
  }));
}

function future(value, now) {
  const date = timestamp(value);
  return date && date > now ? date : null;
}

function emptyResult({ runKey, status, now, reason, metrics = {}, nextReviewAt = null, errors = [] }) {
  return {
    schema: 'yarbi.proactive-loop-run.v1', run_key: runKey, status, evaluated_at: now.toISOString(), reason,
    metrics: { candidates: 0, contexts: 0, context_errors: 0, actionable: 0, priorities: 0, ...metrics },
    brief: null, delivery: null, errors, next_review_at: nextReviewAt ? nextReviewAt.toISOString() : null
  };
}

/**
 * Orquesta componentes ya validados. El store debe encapsular toda E/S y hacer
 * atómicos el claim del run y la entrega a inbox. No hay efectos comerciales.
 */
async function runProactiveLoop({ store, now, policy, deliveryAdapter } = {}) {
  if (!object(store)) throw new Error('proactive_loop_store_required');
  const at = timestamp(now);
  if (!at) throw new Error('proactive_loop_time_invalid');
  const effectivePolicy = mergePolicy(policy);
  const runKey = buildRunKey({ ownerKey: effectivePolicy.owner_key, now: at, intervalMs: effectivePolicy.interval_ms });
  let claim;
  try {
    claim = await store.claimRun({ run_key: runKey, owner_key: effectivePolicy.owner_key, started_at: at.toISOString() });
  } catch (error) {
    return emptyResult({ runKey, status: 'failed', now: at, reason: 'run_claim_failed', errors: [{ stage: 'claim', code: sanitizeError(error, 'run_claim_failed') }] });
  }
  if (!claim?.claimed || !claim.run_id) return emptyResult({ runKey, status: 'duplicate_run', now: at, reason: 'already_claimed' });
  const runId = claim.run_id;
  const complete = async (status, patch = {}) => {
    const completed = await store.completeRun({ run_id: runId, status, completed_at: at.toISOString(), ...patch });
    if (completed?.completed !== true) throw new Error('proactive_run_completion_rejected');
  };
  try {
    const previousNotificationState = await store.getNotificationState({ owner_key: effectivePolicy.owner_key });
    const dueAt = future(previousNotificationState?.next_review_at, at);
    if (dueAt) {
      await complete('not_due_yet', { next_review_at: dueAt.toISOString(), metrics: { candidates: 0, contexts: 0, actionable: 0 } });
      return emptyResult({ runKey, status: 'not_due_yet', now: at, reason: 'next_review_not_due', nextReviewAt: dueAt });
    }
    const candidates = normalizeCandidates(await store.loadCandidates({
      now: at.toISOString(), limit: effectivePolicy.candidate_limit,
      fixture_candidate_prefix: effectivePolicy.fixture_candidate_prefix
    }), effectivePolicy.candidate_limit);
    if (!candidates.length) {
      const nextReview = new Date(at.getTime() + effectivePolicy.interval_ms);
      const persisted = await store.persistEvaluation({ run_id: runId, owner_key: effectivePolicy.owner_key, brief: null, next_review_at: nextReview.toISOString(), status: 'no_candidates' });
      if (persisted?.recorded !== true) throw new Error('proactive_evaluation_persist_rejected');
      await complete('no_candidates', { next_review_at: nextReview.toISOString(), metrics: { candidates: 0, contexts: 0, actionable: 0 } });
      return emptyResult({ runKey, status: 'no_candidates', now: at, reason: 'no_candidates', nextReviewAt: nextReview });
    }
    const businessState = normalizeBusinessState(await store.loadBusinessState({ now: at.toISOString(), policy: effectivePolicy }), at, effectivePolicy);
    const contextRows = await store.loadUnifiedContexts({ contact_ids: candidates.map(item => item.contact_id) });
    const byContact = new Map((Array.isArray(contextRows) ? contextRows : []).map(row => [Number(row?.contact_id), row]));
    const contactErrors = [];
    const opportunities = [];
    for (const candidate of candidates) {
      const row = byContact.get(candidate.contact_id);
      if (!row?.context) {
        contactErrors.push({ contact_id: candidate.contact_id, code: sanitizeError(row?.error, 'context_unavailable') });
        continue;
      }
      const next = getNextBestAction({ context: row.context, now: at.toISOString(), policy: effectivePolicy.next_best_action_policy });
      opportunities.push({ ...candidate, contact_context: row.context, next_best_action: next });
    }
    const priority = getBusinessPriorities({ opportunities, businessState, now: at.toISOString(), policy: effectivePolicy.business_priority_policy });
    const brief = buildOwnerProactiveBrief({ businessPriority: priority, previousNotificationState, now: at.toISOString(), policy: effectivePolicy.owner_proactive_policy });
    const metrics = { candidates: candidates.length, contexts: opportunities.length, context_errors: contactErrors.length, actionable: Number(priority.summary.actionable_now || 0), priorities: priority.priorities.length };
    const persisted = await store.persistEvaluation({ run_id: runId, owner_key: effectivePolicy.owner_key, brief, next_review_at: brief.next_review_at, status: brief.decision, metrics });
    if (persisted?.recorded !== true) throw new Error('proactive_evaluation_persist_rejected');
    if (!['notify', 'escalate'].includes(brief.decision)) {
      const status = brief.decision === 'defer' ? 'deferred' : 'completed';
      await complete(status, { next_review_at: brief.next_review_at, metrics, brief_decision: brief.decision, notification_fingerprint: brief.notification_fingerprint });
      return { schema: 'yarbi.proactive-loop-run.v1', run_key: runKey, status, evaluated_at: at.toISOString(), reason: brief.reason, metrics, brief, delivery: null, errors: contactErrors, next_review_at: brief.next_review_at };
    }
    const adapter = deliveryAdapter || { deliver: input => store.deliverOwnerBrief(input) };
    let delivery;
    try {
      delivery = await adapter.deliver({ run_id: runId, owner_key: effectivePolicy.owner_key, brief, now: at.toISOString() });
    } catch (error) {
      const failure = { stage: 'delivery', code: sanitizeError(error, 'delivery_failed') };
      await complete('failed', { next_review_at: brief.next_review_at, metrics, brief_decision: brief.decision, notification_fingerprint: brief.notification_fingerprint, error_code: failure.code });
      return { schema: 'yarbi.proactive-loop-run.v1', run_key: runKey, status: 'failed', evaluated_at: at.toISOString(), reason: 'delivery_failed', metrics, brief, delivery: { status: 'failed' }, errors: [...contactErrors, failure], next_review_at: brief.next_review_at };
    }
    const status = delivery?.outcome === 'delivered' ? 'completed' : 'delivery_suppressed';
    await complete(status, { next_review_at: brief.next_review_at, metrics, brief_decision: brief.decision, notification_fingerprint: brief.notification_fingerprint });
    return { schema: 'yarbi.proactive-loop-run.v1', run_key: runKey, status, evaluated_at: at.toISOString(), reason: brief.reason, metrics, brief, delivery, errors: contactErrors, next_review_at: brief.next_review_at };
  } catch (error) {
    const failure = sanitizeError(error, 'proactive_loop_failed');
    try { await complete('failed', { error_code: failure }); } catch (_) { /* primary error remains authoritative */ }
    return emptyResult({ runKey, status: 'failed', now: at, reason: 'critical_persistence_or_evaluation_failure', errors: [{ stage: 'critical', code: failure }] });
  }
}

module.exports = { DEFAULT_PROACTIVE_LOOP_POLICY, buildRunKey, mergePolicy, runProactiveLoop };
