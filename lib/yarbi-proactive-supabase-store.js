'use strict';

const { getUnifiedContactContexts } = require('./yarbi-unified-contact-context');

function storeError(code) { const error = new Error(code); error.code = code; return error; }
function text(value, limit = 160) { return String(value ?? '').trim().slice(0, limit); }

async function rpc(supabase, name, body, code) {
  const result = await supabase('/rest/v1/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!result?.response?.ok) throw storeError(code);
  return Array.isArray(result.data) ? result.data[0] || null : result.data || null;
}

async function rpcRows(supabase, name, body, code) {
  const result = await supabase('/rest/v1/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!result?.response?.ok) throw storeError(code);
  return Array.isArray(result.data) ? result.data : [];
}

function compactInboxPayload(brief) {
  return {
    schema: 'yarbi.owner-proactive-brief.v1',
    headline: { type: text(brief?.headline?.type, 80), count: Number(brief?.headline?.count || 0) },
    business_snapshot: {
      daily_goal: brief?.business_snapshot?.daily_goal ?? null,
      confirmed_today: brief?.business_snapshot?.confirmed_today ?? null,
      remaining_to_goal: brief?.business_snapshot?.remaining_to_goal ?? null,
      goal_status: text(brief?.business_snapshot?.goal_status, 32) || null,
      currency: text(brief?.business_snapshot?.currency, 12) || null
    },
    items: (Array.isArray(brief?.items) ? brief.items : []).map(item => ({
      type: text(item?.type, 40), contact_id: Number.isSafeInteger(Number(item?.contact_id)) ? Number(item.contact_id) : null,
      action: text(item?.action, 80) || null, priority: text(item?.priority, 32), reason: text(item?.reason, 160), requires_authorization: item?.requires_authorization === true
    }))
  };
}

function fixturePrefix(value) {
  const prefix = text(value, 80);
  // Un prefijo de test debe ser explícito: ningún prefijo parcial habilita lecturas.
  return prefix === 'F3J-REMOTE-' ? prefix : null;
}

async function restrictToFixtureCandidates(supabase, rows, prefix) {
  const safePrefix = fixturePrefix(prefix);
  if (!safePrefix) return rows;
  const ids = [...new Set((Array.isArray(rows) ? rows : []).map(row => Number(row?.contact_id)).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const encodedIds = ids.join(',');
  const path = '/rest/v1/yarbi_contact_operational_memory?select=contact_id,source_event_id&state=eq.active'
    + '&contact_id=in.(' + encodeURIComponent(encodedIds) + ')'
    + '&source_event_id=like.' + encodeURIComponent(safePrefix + '*');
  const result = await supabase(path);
  if (!result?.response?.ok) throw storeError('proactive_fixture_marker_read_failed');
  const approved = new Set((Array.isArray(result.data) ? result.data : [])
    .filter(row => text(row?.source_event_id, 160).startsWith(safePrefix))
    .map(row => Number(row.contact_id))
    .filter(id => Number.isSafeInteger(id) && id > 0));
  return rows.filter(row => approved.has(Number(row?.contact_id)));
}

// El adaptador no conoce secretos ni fetch. El caller ya autenticado entrega un
// cliente REST service_role aislado; cada mutación sensible se delega a RPC.
function createProactiveSupabaseStore({ supabase, loadBusinessState, ownerKey = 'primary', fixtureCandidatePrefix = null } = {}) {
  if (typeof supabase !== 'function') throw storeError('proactive_store_unavailable');
  return {
    claimRun: input => rpc(supabase, 'claim_yarbi_proactive_run', {
      p_run_key: input.run_key, p_owner_key: input.owner_key || ownerKey, p_started_at: input.started_at
    }, 'proactive_run_claim_failed'),
    completeRun: input => rpc(supabase, 'complete_yarbi_proactive_run', {
      p_run_id: input.run_id, p_status: input.status, p_completed_at: input.completed_at,
      p_next_review_at: input.next_review_at || null, p_metrics: input.metrics || {}, p_brief_decision: input.brief_decision || null,
      p_notification_fingerprint: input.notification_fingerprint || null, p_error_code: input.error_code || null
    }, 'proactive_run_complete_failed'),
    async getNotificationState({ owner_key }) {
      const result = await supabase('/rest/v1/yarbi_owner_notification_state?owner_key=eq.' + encodeURIComponent(owner_key || ownerKey) + '&select=last_notified_at,last_fingerprint,recent_fingerprints,last_escalated_at,next_review_at&limit=1');
      if (!result?.response?.ok) throw storeError('proactive_notification_state_read_failed');
      return Array.isArray(result.data) && result.data[0] ? result.data[0] : {};
    },
    async loadCandidates({ now, limit, fixture_candidate_prefix = null }) {
      const rows = await rpcRows(supabase, 'list_yarbi_proactive_candidates', { p_as_of: now, p_limit: limit }, 'proactive_candidates_read_failed');
      return restrictToFixtureCandidates(supabase, rows, fixture_candidate_prefix || fixtureCandidatePrefix);
    },
    async loadBusinessState({ now, policy }) {
      if (typeof loadBusinessState === 'function') return loadBusinessState({ now, policy });
      // Aún no existe una fuente financiera aprobada para este backend aislado.
      return { date: String(now).slice(0, 10), daily_goal_amount: policy.daily_goal_amount, confirmed_revenue_today: null, currency: policy.currency };
    },
    loadUnifiedContexts: ({ contact_ids }) => getUnifiedContactContexts({ supabase, contactIds: contact_ids }).then(rows => rows.map(context => ({ contact_id: context.contact_id, context }))),
    async persistEvaluation(input) {
      return rpc(supabase, 'record_yarbi_proactive_evaluation', {
        p_run_id: input.run_id, p_owner_key: input.owner_key || ownerKey, p_status: input.status,
        p_next_review_at: input.next_review_at || null, p_brief_decision: input.brief?.decision || null,
        p_notification_fingerprint: input.brief?.notification_fingerprint || null, p_metrics: input.metrics || {}
      }, 'proactive_evaluation_persist_failed');
    },
    async deliverOwnerBrief(input) {
      const row = await rpc(supabase, 'deliver_yarbi_owner_brief', {
        p_run_id: input.run_id, p_owner_key: input.owner_key || ownerKey, p_fingerprint: input.brief.notification_fingerprint,
        p_urgency: input.brief.urgency, p_notification_mode: input.brief.notification_mode,
        p_payload: compactInboxPayload(input.brief), p_now: input.now
      }, 'proactive_delivery_failed');
      return { outcome: text(row?.outcome, 80) || 'failed', inbox_id: row?.inbox_id || null };
    }
  };
}

module.exports = { compactInboxPayload, createProactiveSupabaseStore, restrictToFixtureCandidates };
