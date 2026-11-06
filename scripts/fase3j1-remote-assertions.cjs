'use strict';

// Fase 3J.1 — complemento físico de concurrencia y deduplicación.
// Solo usa el proyecto aislado y datos F3J-REMOTE. No imprime secretos.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REF = 'uevilhbstnmmdlgyshlv';
const HOST = `${REF}.supabase.co`;
const BASE = `https://${HOST}`;
const ROOT = path.resolve(__dirname, '..');
const PREVIOUS = path.join(__dirname, 'fase3j1-isolated-evidence.json');
const EVIDENCE = path.join(__dirname, 'fase3j1-remote-assertions-evidence.json');
const SHA = path.join(__dirname, 'fase3j1-remote-assertions-evidence.sha256');
const egress = [];

function fail(code, message = code) { const error = new Error(message); error.code = code; throw error; }
function clean(value, limit = 180) { return String(value ?? '').trim().slice(0, limit); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function secret() {
  const value = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (value.length < 32) fail('F3J1_SECRET_MISSING');
  return value;
}
function installGuard() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const allowed = url.protocol === 'https:' && url.hostname.toLowerCase() === HOST;
    egress.push({ host: url.hostname.toLowerCase(), path: url.pathname, method: String(init.method || 'GET').toUpperCase(), allowed });
    if (!allowed) fail('F3J1_EGRESS_BLOCKED', `Salida no autorizada: ${url.hostname}`);
    return original(input, init);
  };
  return () => { globalThis.fetch = original; };
}
async function rest(pathname, options = {}) {
  const key = secret();
  const response = await fetch(BASE + pathname, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...(options.headers || {}) } });
  const raw = await response.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch (_) { /* sanitized below */ }
  if (!response.ok) {
    const detail = clean(data?.message || data?.error || `HTTP ${response.status}`, 180)
      .replace(/(?:eyJ[a-zA-Z0-9_=-]{10,}|sb_(?:secret|publishable)_[a-zA-Z0-9_-]+)/g, '[redacted]');
    fail(`F3J1_HTTP_${response.status}`, `Supabase aislado respondió HTTP ${response.status}: ${detail}`);
  }
  return data;
}
function rows(value) { return Array.isArray(value) ? value : []; }
async function rpc(name, body) {
  const result = await rest(`/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return rows(result)[0] || null;
}
function write(value) {
  const encoded = JSON.stringify(value, null, 2) + '\n';
  fs.writeFileSync(EVIDENCE, encoded, { encoding: 'utf8', mode: 0o600 });
  const hash = digest(encoded);
  fs.writeFileSync(SHA, `${hash}  ${path.basename(EVIDENCE)}\n`, { encoding: 'utf8', mode: 0o600 });
  return hash;
}
function safeError(error) { return { code: clean(error?.code || 'F3J1_ASSERTION_ERROR', 100), message: clean(error?.message || 'unknown', 240) }; }

async function main() {
  const evidence = { phase: 'F3J.1-remote-assertions', project_ref: REF, source_fixture: null, concurrent_claim: null, same_fingerprint: null, material_change: null, deferred_without_delivery: null, egress, result: 'FAIL', error: null, started_at: new Date().toISOString() };
  let restore;
  try {
    const prior = JSON.parse(fs.readFileSync(PREVIOUS, 'utf8'));
    if (prior?.project_ref !== REF || !clean(prior?.fixture?.fixture).startsWith('F3J-REMOTE-')) fail('F3J1_PREVIOUS_FIXTURE_INVALID');
    evidence.source_fixture = clean(prior.fixture.fixture);
    restore = installGuard();
    const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const owner = `F3J-REMOTE-owner-${suffix}`;
    const now = new Date().toISOString();

    const claimKey = `F3J-REMOTE-RUN-${suffix}`;
    const [left, right] = await Promise.all([
      rpc('claim_yarbi_proactive_run', { p_run_key: claimKey, p_owner_key: owner, p_started_at: now }),
      rpc('claim_yarbi_proactive_run', { p_run_key: claimKey, p_owner_key: owner, p_started_at: now })
    ]);
    const claimed = [left, right].filter(row => row?.claimed === true);
    if (claimed.length !== 1 || !Number.isSafeInteger(Number(claimed[0].run_id))) fail('F3J1_CONCURRENT_CLAIM_INVALID');
    const runId = Number(claimed[0].run_id);
    const completion = await rpc('complete_yarbi_proactive_run', { p_run_id: runId, p_status: 'no_candidates', p_completed_at: now, p_next_review_at: new Date(Date.now() + 60000).toISOString(), p_metrics: { candidates: 0, contexts: 0, actionable: 0 }, p_brief_decision: null, p_notification_fingerprint: null, p_error_code: null });
    if (completion?.completed !== true) fail('F3J1_CONCURRENT_RUN_CLOSE_FAILED');
    evidence.concurrent_claim = { run_key_prefix: 'F3J-REMOTE-RUN-', claims: [Boolean(left?.claimed), Boolean(right?.claimed)], completed: true };

    const fingerprint = `F3J-REMOTE-FP-${suffix}`;
    const payload = { schema: 'yarbi.owner-proactive-brief.v1', headline: { type: 'synthetic', count: 1 }, business_snapshot: { daily_goal: null, confirmed_today: null, remaining_to_goal: null, goal_status: null, currency: 'PEN' }, items: [{ type: 'owner_review', contact_id: null, action: 'review', priority: 'high', reason: 'F3J-REMOTE', requires_authorization: false }] };
    const deliveryBody = { p_run_id: runId, p_owner_key: owner, p_fingerprint: fingerprint, p_urgency: 'high', p_notification_mode: 'interrupt', p_payload: payload, p_now: now };
    const [first, retry] = await Promise.all([rpc('deliver_yarbi_owner_brief', deliveryBody), rpc('deliver_yarbi_owner_brief', deliveryBody)]);
    const deliveryOutcomes = [clean(first?.outcome, 80), clean(retry?.outcome, 80)].sort();
    if (deliveryOutcomes.join('|') !== 'delivered|duplicate_recent_notification') fail('F3J1_FINGERPRINT_DEDUPE_INVALID');
    evidence.same_fingerprint = { outcomes: deliveryOutcomes };

    const changed = await rpc('deliver_yarbi_owner_brief', { ...deliveryBody, p_fingerprint: `${fingerprint}-changed`, p_now: new Date(Date.now() + 1000).toISOString() });
    if (changed?.outcome !== 'delivered') fail('F3J1_MATERIAL_CHANGE_INVALID');
    evidence.material_change = { outcome: clean(changed.outcome, 80) };

    const inboxBefore = rows(await rest(`/rest/v1/yarbi_owner_inbox?owner_key=eq.${encodeURIComponent(owner)}&select=id`)).length;
    const deferKey = `F3J-REMOTE-DEFER-${suffix}`;
    const deferredClaim = await rpc('claim_yarbi_proactive_run', { p_run_key: deferKey, p_owner_key: owner, p_started_at: now });
    if (deferredClaim?.claimed !== true) fail('F3J1_DEFER_CLAIM_INVALID');
    const recorded = await rpc('record_yarbi_proactive_evaluation', { p_run_id: deferredClaim.run_id, p_owner_key: owner, p_status: 'defer', p_next_review_at: new Date(Date.now() + 60000).toISOString(), p_brief_decision: 'defer', p_notification_fingerprint: `F3J-REMOTE-DEFER-FP-${suffix}`, p_metrics: { candidates: 1, contexts: 1, actionable: 0 } });
    const deferredComplete = await rpc('complete_yarbi_proactive_run', { p_run_id: deferredClaim.run_id, p_status: 'deferred', p_completed_at: now, p_next_review_at: new Date(Date.now() + 60000).toISOString(), p_metrics: { candidates: 1, contexts: 1, actionable: 0 }, p_brief_decision: 'defer', p_notification_fingerprint: `F3J-REMOTE-DEFER-FP-${suffix}`, p_error_code: null });
    const inboxAfter = rows(await rest(`/rest/v1/yarbi_owner_inbox?owner_key=eq.${encodeURIComponent(owner)}&select=id`)).length;
    if (recorded?.recorded !== true || deferredComplete?.completed !== true || inboxAfter !== inboxBefore) fail('F3J1_DEFER_DELIVERY_INVALID');
    evidence.deferred_without_delivery = { inbox_before: inboxBefore, inbox_after: inboxAfter, recorded: true, completed: true };

    evidence.result = 'F3J1_REMOTE_ASSERTIONS_VALIDATED_IN_ISOLATION';
  } catch (caught) {
    evidence.error = safeError(caught);
  } finally {
    evidence.completed_at = new Date().toISOString();
    if (restore) restore();
    const hash = write(evidence);
    console.log(JSON.stringify({ phase: evidence.phase, result: evidence.result, evidence: path.basename(EVIDENCE), evidence_sha256: hash }));
    if (evidence.result !== 'F3J1_REMOTE_ASSERTIONS_VALIDATED_IN_ISOLATION') process.exitCode = 1;
  }
}

main();
