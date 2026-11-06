'use strict';

// Fase 3K — ejecución MANUAL, una sola vez, contra el Supabase aislado.
// Lee secretos solo de la sesión. La evidencia no contiene claves ni datos reales.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REF = 'uevilhbstnmmdlgyshlv';
const HOST = `${REF}.supabase.co`;
const BASE = `https://${HOST}`;
const MANAGEMENT = 'api.supabase.com';
const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'migrations', '20261030_f3k_owner_authorization.sql');
const RPC_FIX = path.join(ROOT, 'migrations', '20261030_f3k_owner_authorization_rpc_fix.sql');
const RPC_FIX_V2 = path.join(ROOT, 'migrations', '20261030_f3k_owner_authorization_rpc_fix_v2.sql');
const RPC_FIX_V3 = path.join(ROOT, 'migrations', '20261030_f3k_owner_authorization_rpc_fix_v3.sql');
const EVIDENCE = path.join(__dirname, 'fase3k-isolated-evidence.json');
const SHA = path.join(__dirname, 'fase3k-isolated-evidence.sha256');
const egress = { management: [], isolated: [] };
let phase = 'management';

function clean(v, max = 180) { return String(v ?? '').trim().slice(0, max); }
function sha(v) { return crypto.createHash('sha256').update(v).digest('hex').toUpperCase(); }
function fail(code, message = code) { const e = new Error(message); e.code = code; throw e; }
function secret(name, min = 24) { const value = clean(process.env[name], 10000); if (value.length < min) fail(`F3K_${name}_MISSING`); return value; }
function rows(value) { return Array.isArray(value) ? value : (Array.isArray(value?.result) ? value.result : []); }
function sanitizedError(err) { return { code: clean(err?.code || 'F3K_RUNNER_ERROR', 100), message: clean(err?.message || 'unknown_error', 260).replace(/(?:eyJ[a-zA-Z0-9_=-]{10,}|sb_(?:secret|publishable)_[a-zA-Z0-9_-]+)/g, '[redacted]') }; }
function write(value) { const encoded = JSON.stringify(value, null, 2) + '\n'; fs.writeFileSync(EVIDENCE, encoded, { encoding: 'utf8', mode: 0o600 }); const digest = sha(encoded); fs.writeFileSync(SHA, `${digest}  ${path.basename(EVIDENCE)}\n`, { encoding: 'utf8', mode: 0o600 }); return digest; }

function installGuard() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const host = url.hostname.toLowerCase();
    const allowed = url.protocol === 'https:' && (host === HOST || (phase === 'management' && host === MANAGEMENT));
    egress[phase === 'management' ? 'management' : 'isolated'].push({ host, path: url.pathname, method: String(init.method || input?.method || 'GET').toUpperCase(), allowed });
    if (!allowed) fail('F3K_EGRESS_BLOCKED', `Salida bloqueada: ${host}`);
    return original(input, init);
  };
  return () => { globalThis.fetch = original; };
}
async function json(response, label) {
  const raw = await response.text(); let data = null; try { data = raw ? JSON.parse(raw) : null; } catch (_) { /* protocol only */ }
  if (!response.ok) fail(`F3K_HTTP_${response.status}`, `${label}: ${clean(data?.message || data?.error || `HTTP ${response.status}`, 220)}`);
  return data;
}
async function management(pathname, init = {}) {
  const access = secret('SUPABASE_ACCESS_TOKEN');
  const response = await fetch(`https://${MANAGEMENT}${pathname}`, { ...init, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  return json(response, 'Supabase Management API');
}
async function sql(query, readOnly = false) {
  return management(`/v1/projects/${REF}/database/query${readOnly ? '/read-only' : ''}`, { method: 'POST', body: JSON.stringify({ query }) });
}
async function rest(pathname, init = {}) {
  const key = secret('SUPABASE_SECRET_KEY', 32);
  const response = await fetch(BASE + pathname, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers || {}) } });
  return json(response, 'Supabase REST');
}
async function rpc(name, body) {
  const data = await rest(`/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return rows(data)[0] || null;
}

async function verifyProjectAndSchema() {
  const project = await management(`/v1/projects/${REF}`, { method: 'GET' });
  if (clean(project?.ref || project?.id, 80) !== REF) fail('F3K_PROJECT_REF_MISMATCH');
  const present = rows(await sql(`select relname from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relname in ('yarbi_owner_inbox','yarbi_proactive_runs','yarbi_owner_notification_state','crm_contacts','yarbi_contact_operational_memory','yarbi_owner_action_decisions','yarbi_authorized_orders') order by relname`, true)).map(row => clean(row.relname, 100));
  const base = ['yarbi_owner_inbox','yarbi_proactive_runs','yarbi_owner_notification_state','crm_contacts','yarbi_contact_operational_memory'];
  if (!base.every(name => present.includes(name))) fail('F3K_BASE_SCHEMA_MISSING');
  const f3k = ['yarbi_owner_action_decisions','yarbi_authorized_orders'];
  if (f3k.some(name => present.includes(name)) && !f3k.every(name => present.includes(name))) fail('F3K_SCHEMA_PARTIAL');
  return { project_ref: REF, f3k_state: f3k.every(name => present.includes(name)) ? 'already_applied' : 'not_applied', objects: present };
}
async function migrateIfNeeded(state, migrationText) {
  if (state.f3k_state === 'already_applied') return { already_applied: true };
  await management(`/v1/projects/${REF}/database/migrations`, { method: 'POST', body: JSON.stringify({ name: '20261030_f3k_owner_authorization', query: migrationText }) });
  return { applied: true };
}
async function applyRpcFixIfNeeded() {
  const check = rows(await sql("select position('v_decision_id bigint' in pg_get_functiondef(to_regprocedure('public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz)'))) > 0 as fixed", true))[0];
  if (check?.fixed === true || check?.fixed === 't') return { already_applied: true };
  const source = fs.readFileSync(RPC_FIX, 'utf8');
  await management(`/v1/projects/${REF}/database/migrations`, { method: 'POST', body: JSON.stringify({ name: '20261030_f3k_owner_authorization_rpc_fix', query: source }) });
  return { applied: true, sha256: sha(source) };
}
async function applyRpcFixV2IfNeeded() {
  const check = rows(await sql("select position('on conflict on constraint yarbi_authorized_orders_decision_id_key do nothing' in lower(pg_get_functiondef(to_regprocedure('public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz)')))) > 0 as fixed", true))[0];
  if (check?.fixed === true || check?.fixed === 't') return { already_applied: true };
  const source = fs.readFileSync(RPC_FIX_V2, 'utf8');
  await management(`/v1/projects/${REF}/database/migrations`, { method: 'POST', body: JSON.stringify({ name: '20261030_f3k_owner_authorization_rpc_fix_v2', query: source }) });
  return { applied: true, sha256: sha(source) };
}
async function applyRpcFixV3IfNeeded() {
  const check = rows(await sql("select position('decision_row.owner_decision = ''authorize''' in pg_get_functiondef(to_regprocedure('public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz)'))) > 0 as fixed", true))[0];
  if (check?.fixed === true || check?.fixed === 't') return { already_applied: true };
  const source = fs.readFileSync(RPC_FIX_V3, 'utf8');
  await management(`/v1/projects/${REF}/database/migrations`, { method: 'POST', body: JSON.stringify({ name: '20261030_f3k_owner_authorization_rpc_fix_v3', query: source }) });
  return { applied: true, sha256: sha(source) };
}
async function makeInbox({ suffix, action, type = 'customer_action', contactId = null, requiresAuthorization = true }) {
  const owner = `F3K-owner-${suffix}`;
  const now = new Date().toISOString();
  const run = await rpc('claim_yarbi_proactive_run', { p_run_key: `F3K-run-${suffix}`, p_owner_key: owner, p_started_at: now });
  if (!run?.claimed || !Number.isSafeInteger(Number(run.run_id))) fail('F3K_RUN_CREATE_FAILED');
  const complete = await rpc('complete_yarbi_proactive_run', { p_run_id: run.run_id, p_status: 'no_candidates', p_completed_at: now, p_next_review_at: new Date(Date.now() + 60000).toISOString(), p_metrics: { candidates: 0, contexts: 0, actionable: 0 }, p_brief_decision: null, p_notification_fingerprint: null, p_error_code: null });
  if (complete?.completed !== true) fail('F3K_RUN_COMPLETE_FAILED');
  const fingerprint = `F3K-fingerprint-${suffix}`;
  const payload = { schema: 'yarbi.owner-proactive-brief.v1', headline: { type: 'synthetic', count: 1 }, business_snapshot: { daily_goal: null, confirmed_today: null, remaining_to_goal: null, goal_status: null, currency: 'PEN' }, items: [{ type, contact_id: contactId, action, priority: 'high', reason: 'F3K_synthetic', requires_authorization: requiresAuthorization }] };
  const delivery = await rpc('deliver_yarbi_owner_brief', { p_run_id: run.run_id, p_owner_key: owner, p_fingerprint: fingerprint, p_urgency: 'high', p_notification_mode: 'interrupt', p_payload: payload, p_now: now });
  if (delivery?.outcome !== 'delivered' || !Number.isSafeInteger(Number(delivery?.inbox_id))) fail('F3K_INBOX_CREATE_FAILED');
  return { owner, inbox_id: Number(delivery.inbox_id), fingerprint };
}
async function createContact(suffix) {
  const data = rows(await rest('/rest/v1/crm_contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify([{ source: 'whatsapp', commercial_status: 'tibio', last_contact_at: new Date().toISOString() }]) }));
  const id = Number(data[0]?.id); if (!Number.isSafeInteger(id) || id <= 0) fail('F3K_FIXTURE_CONTACT_FAILED');
  return id;
}
async function inspect(inboxId) {
  const inbox = rows(await rest(`/rest/v1/yarbi_owner_inbox?id=eq.${inboxId}&select=id,owner_decision_status,postpone_until,dismissed_at`))[0] || null;
  const decisions = rows(await rest(`/rest/v1/yarbi_owner_action_decisions?inbox_id=eq.${inboxId}&select=id,owner_decision,outcome,decision_version,recommended_action,operation_ref`));
  const orders = rows(await rest(`/rest/v1/yarbi_authorized_orders?inbox_id=eq.${inboxId}&select=id,authorized_action,execution_state,decision_id`));
  return { inbox, decisions, orders };
}
async function expectRpcError(body, expected) {
  try { await rpc('apply_yarbi_owner_action', body); } catch (e) { if (clean(e.code, 80) === 'F3K_HTTP_400') return expected; throw e; }
  fail('F3K_EXPECTED_RPC_ERROR_MISSING');
}

async function main() {
  const evidence = { phase: 'F3K', project_ref: REF, migration: null, fixtures: {}, checks: {}, egress, result: 'BLOCKED', error: null, started_at: new Date().toISOString() };
  let restore;
  try {
    secret('SUPABASE_ACCESS_TOKEN'); secret('SUPABASE_SECRET_KEY', 32); restore = installGuard();
    evidence.preflight = await verifyProjectAndSchema();
    const source = fs.readFileSync(MIGRATION, 'utf8'); evidence.migration = { file: path.basename(MIGRATION), sha256: sha(source), ...(await migrateIfNeeded(evidence.preflight, source)), rpc_fix: await applyRpcFixIfNeeded(), rpc_fix_v2: await applyRpcFixV2IfNeeded(), rpc_fix_v3: await applyRpcFixV3IfNeeded() };
    phase = 'isolated'; const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

    const authorized = await makeInbox({ suffix: `${suffix}-authorize`, action: 'ask_for_location' });
    const first = await rpc('apply_yarbi_owner_action', { p_inbox_id: authorized.inbox_id, p_item_index: 0, p_decision: 'authorize', p_postpone_until: null, p_now: new Date().toISOString() });
    const repeat = await rpc('apply_yarbi_owner_action', { p_inbox_id: authorized.inbox_id, p_item_index: 0, p_decision: 'authorize', p_postpone_until: null, p_now: new Date().toISOString() });
    const inspectedAuth = await inspect(authorized.inbox_id);
    evidence.fixtures.authorize = {
      inbox_id: authorized.inbox_id,
      outcomes: [clean(first?.outcome, 80), clean(repeat?.outcome, 80)],
      owner_statuses: [clean(first?.owner_status, 40), clean(repeat?.owner_status, 40)],
      decision_count: inspectedAuth.decisions.length,
      order_count: inspectedAuth.orders.length,
      execution_state: clean(inspectedAuth.orders[0]?.execution_state, 80) || null
    };
    if (first?.outcome !== 'authorized' || repeat?.outcome !== 'already_authorized' || inspectedAuth.decisions.length !== 1 || inspectedAuth.orders.length !== 1 || inspectedAuth.orders[0]?.execution_state !== 'authorized_pending_execution') fail('F3K_AUTHORIZE_IDEMPOTENCY_FAILED');

    const concurrent = await makeInbox({ suffix: `${suffix}-concurrent`, action: 'follow_up_customer' });
    const concurrentResults = await Promise.all([rpc('apply_yarbi_owner_action', { p_inbox_id: concurrent.inbox_id, p_item_index: 0, p_decision: 'authorize', p_postpone_until: null, p_now: new Date().toISOString() }), rpc('apply_yarbi_owner_action', { p_inbox_id: concurrent.inbox_id, p_item_index: 0, p_decision: 'authorize', p_postpone_until: null, p_now: new Date().toISOString() })]);
    const inspectedConcurrent = await inspect(concurrent.inbox_id);
    if (concurrentResults.filter(row => row?.outcome === 'authorized').length !== 1 || concurrentResults.filter(row => row?.outcome === 'already_authorized').length !== 1 || inspectedConcurrent.decisions.length !== 1 || inspectedConcurrent.orders.length !== 1) fail('F3K_CONCURRENT_AUTHORIZE_FAILED');
    evidence.fixtures.concurrent_authorize = { inbox_id: concurrent.inbox_id, outcomes: concurrentResults.map(row => clean(row?.outcome, 80)).sort(), decision_count: 1, order_count: 1 };

    const contested = await makeInbox({ suffix: `${suffix}-contested`, action: 'ask_for_service' });
    const contestedResults = await Promise.all([rpc('apply_yarbi_owner_action', { p_inbox_id: contested.inbox_id, p_item_index: 0, p_decision: 'authorize', p_postpone_until: null, p_now: new Date().toISOString() }), rpc('apply_yarbi_owner_action', { p_inbox_id: contested.inbox_id, p_item_index: 0, p_decision: 'dismiss', p_postpone_until: null, p_now: new Date().toISOString() })]);
    const inspectedContested = await inspect(contested.inbox_id);
    if (inspectedContested.decisions.length !== 1 || !['authorized','dismissed'].includes(inspectedContested.inbox?.owner_decision_status)) fail('F3K_CONCURRENT_TRANSITION_FAILED');
    evidence.fixtures.authorize_dismiss = { inbox_id: contested.inbox_id, outcomes: contestedResults.map(row => clean(row?.outcome, 80)).sort(), final_status: clean(inspectedContested.inbox?.owner_decision_status, 40), order_count: inspectedContested.orders.length };

    const postponed = await makeInbox({ suffix: `${suffix}-postpone`, action: 'ask_for_district' });
    const future = new Date(Date.now() + 86400000).toISOString();
    const post = await rpc('apply_yarbi_owner_action', { p_inbox_id: postponed.inbox_id, p_item_index: 0, p_decision: 'postpone', p_postpone_until: future, p_now: new Date().toISOString() });
    await expectRpcError({ p_inbox_id: postponed.inbox_id, p_item_index: 0, p_decision: 'postpone', p_postpone_until: '2000-01-01T00:00:00Z', p_now: new Date().toISOString() }, 'past_rejected');
    const inspectedPostpone = await inspect(postponed.inbox_id);
    if (post?.outcome !== 'postponed' || inspectedPostpone.inbox?.owner_decision_status !== 'postponed') fail('F3K_POSTPONE_FAILED');
    evidence.fixtures.postpone = { inbox_id: postponed.inbox_id, outcome: post.outcome, past_date_rejected: true };

    const dismissed = await makeInbox({ suffix: `${suffix}-dismiss`, action: 'ask_for_schedule' });
    const dismissFirst = await rpc('apply_yarbi_owner_action', { p_inbox_id: dismissed.inbox_id, p_item_index: 0, p_decision: 'dismiss', p_postpone_until: null, p_now: new Date().toISOString() });
    const dismissRepeat = await rpc('apply_yarbi_owner_action', { p_inbox_id: dismissed.inbox_id, p_item_index: 0, p_decision: 'dismiss', p_postpone_until: null, p_now: new Date().toISOString() });
    const inspectedDismiss = await inspect(dismissed.inbox_id);
    if (dismissFirst?.outcome !== 'dismissed' || dismissRepeat?.outcome !== 'already_dismissed' || !inspectedDismiss.inbox?.dismissed_at || inspectedDismiss.decisions.length !== 1) fail('F3K_DISMISS_FAILED');
    evidence.fixtures.dismiss = { inbox_id: dismissed.inbox_id, outcomes: [dismissFirst.outcome, dismissRepeat.outcome], evidence_retained: true };

    const staleContact = await createContact(`${suffix}-stale`);
    await rest('/rest/v1/yarbi_contact_operational_memory', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify([{ contact_id: staleContact, memory_type: 'location', memory_key: `F3K-location-${suffix}`, value: { verified: true }, source: 'internal_event', source_event_id: `F3K-${suffix}`, occurred_at: new Date().toISOString(), state: 'active' }]) });
    const stale = await makeInbox({ suffix: `${suffix}-stale`, action: 'ask_for_location', contactId: staleContact });
    const staleResult = await rpc('apply_yarbi_owner_action', { p_inbox_id: stale.inbox_id, p_item_index: 0, p_decision: 'authorize', p_postpone_until: null, p_now: new Date().toISOString() });
    const staleInspected = await inspect(stale.inbox_id);
    if (staleResult?.outcome !== 'stale_recommendation' || staleInspected.orders.length !== 0) fail('F3K_STALE_CHECK_FAILED');
    evidence.fixtures.stale = { inbox_id: stale.inbox_id, outcome: staleResult.outcome, order_count: 0 };

    const review = await makeInbox({ suffix: `${suffix}-review`, action: 'review_context_conflict', type: 'owner_review', requiresAuthorization: false });
    const reviewResult = await rpc('apply_yarbi_owner_action', { p_inbox_id: review.inbox_id, p_item_index: 0, p_decision: 'authorize', p_postpone_until: null, p_now: new Date().toISOString() });
    const reviewInspected = await inspect(review.inbox_id);
    if (reviewResult?.outcome !== 'owner_review' || reviewInspected.orders.length !== 0) fail('F3K_OWNER_REVIEW_FAILED');
    evidence.fixtures.owner_review = { inbox_id: review.inbox_id, outcome: reviewResult.outcome, order_count: 0 };

    const quote = await makeInbox({ suffix: `${suffix}-quote`, action: 'prepare_quote', type: 'internal_action', requiresAuthorization: false });
    const quoteResult = await rpc('apply_yarbi_owner_action', { p_inbox_id: quote.inbox_id, p_item_index: 0, p_decision: 'authorize', p_postpone_until: null, p_now: new Date().toISOString() });
    const quoteInspected = await inspect(quote.inbox_id);
    if (quoteResult?.outcome !== 'authorized' || quoteInspected.orders.length !== 1 || quoteInspected.orders[0]?.authorized_action !== 'prepare_quote') fail('F3K_PREPARE_QUOTE_FAILED');
    evidence.fixtures.prepare_quote = { inbox_id: quote.inbox_id, outcome: quoteResult.outcome, order_action: quoteInspected.orders[0].authorized_action, no_price_or_egress: true };

    const external = egress.isolated.filter(event => event.host !== HOST || !event.allowed);
    if (external.length) fail('F3K_EXTERNAL_EGRESS_DETECTED');
    evidence.checks = { no_external_egress: true, no_gemini: true, no_whatsapp_ycloud: true, no_maps_notion_calendar: true, production_not_used: true, no_execution_external: true, msg_id_without_stable_value: 'NOT_PROVEN' };
    evidence.result = 'FASE3K_AUTORIZACION_CONTROLADA_VALIDADA_EN_AISLADO';
  } catch (err) { evidence.error = sanitizedError(err); evidence.result = 'FAIL'; }
  finally { evidence.completed_at = new Date().toISOString(); if (restore) restore(); const digest = write(evidence); console.log(JSON.stringify({ phase: 'F3K', result: evidence.result, evidence: path.basename(EVIDENCE), evidence_sha256: digest })); if (evidence.result !== 'FASE3K_AUTORIZACION_CONTROLADA_VALIDADA_EN_AISLADO') process.exitCode = 1; }
}
main();
