'use strict';

// Crea exactamente dos recomendaciones sintéticas para el cierre manual de UI-01.
// No imprime ni escribe la clave. Solo admite el proyecto aislado autorizado.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REF = 'uevilhbstnmmdlgyshlv';
const BASE = `https://${REF}.supabase.co`;
const OWNER_KEY = 'primary';
const OUT = path.resolve(__dirname, '..', 'PREVIEW_UI01_AISLADO', 'ui01-final-fixtures-evidence.json');

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeText(value, max = 160) { return String(value ?? '').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, max); }
function rows(value) { return Array.isArray(value) ? value : []; }

function secret() {
  const value = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!value.startsWith('sb_secret_') || value.length < 32) fail('UI01_FINAL_SECRET_MISSING');
  return value;
}

async function isolatedFetch(pathname, init = {}) {
  const target = new URL(pathname, BASE);
  if (target.origin !== BASE) fail('UI01_FINAL_EGRESS_BLOCKED');
  const key = secret();
  const response = await fetch(target, {
    ...init,
    // Las secret keys sb_secret_* se envían exclusivamente como apikey, no como Bearer JWT.
    headers: { apikey: key, ...(init.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) fail(`UI01_FINAL_SUPABASE_${response.status}`);
  return data;
}

async function rpc(name, body) {
  const response = await isolatedFetch(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return rows(response)[0] || null;
}

async function createFixture(kind, action, stamp) {
  const now = new Date().toISOString();
  const label = `UI01-FINAL-${kind}-${stamp}`;
  const claimed = await rpc('claim_yarbi_proactive_run', {
    p_run_key: `${label}-RUN`, p_owner_key: OWNER_KEY, p_started_at: now
  });
  if (!claimed?.claimed || !Number.isSafeInteger(Number(claimed.run_id))) fail(`UI01_FINAL_${kind}_RUN_FAILED`);
  const complete = await rpc('complete_yarbi_proactive_run', {
    p_run_id: Number(claimed.run_id), p_status: 'no_candidates', p_completed_at: now,
    p_next_review_at: new Date(Date.now() + 86400000).toISOString(),
    p_metrics: { candidates: 0, contexts: 0, actionable: 1, synthetic: true },
    p_brief_decision: null, p_notification_fingerprint: null, p_error_code: null
  });
  if (complete?.completed !== true) fail(`UI01_FINAL_${kind}_COMPLETE_FAILED`);
  const payload = {
    schema: 'yarbi.owner-proactive-brief.v1',
    headline: { type: 'synthetic', count: 1 },
    business_snapshot: { daily_goal: 700, confirmed_today: 0, remaining_to_goal: 700, goal_status: 'synthetic', currency: 'PEN' },
    items: [{
      type: 'customer_action', action, priority: 'high', requires_authorization: true,
      contact_name: label, service: 'Prueba aislada UI-01',
      reason: `action_allowed_now:${action}`, fixture_key: label
    }]
  };
  const delivered = await rpc('deliver_yarbi_owner_brief', {
    p_run_id: Number(claimed.run_id), p_owner_key: OWNER_KEY,
    p_fingerprint: `${label}-FINGERPRINT`, p_urgency: 'high', p_notification_mode: 'interrupt',
    p_payload: payload, p_now: now
  });
  const inboxId = Number(delivered?.inbox_id);
  if (delivered?.outcome !== 'delivered' || !Number.isSafeInteger(inboxId)) fail(`UI01_FINAL_${kind}_DELIVERY_FAILED`);
  const result = rows(await isolatedFetch(`/rest/v1/yarbi_owner_inbox?id=eq.${inboxId}&owner_key=eq.${OWNER_KEY}&select=id,status,owner_decision_status,payload`))[0];
  if (!result || result.status !== 'delivered' || result.owner_decision_status !== 'pending') fail(`UI01_FINAL_${kind}_VERIFY_FAILED`);
  return { label, inbox_id: inboxId, action, status: 'pending', raw_reason: payload.items[0].reason };
}

async function main() {
  if (fs.existsSync(OUT)) {
    const prior = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (prior?.phase === 'UI01-FINAL-FIXTURES' && prior?.fixtures?.auth?.status === 'pending' && prior?.fixtures?.dismiss?.status === 'pending') fail('UI01_FINAL_FIXTURES_ALREADY_PREPARED');
  }
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const auth = await createFixture('AUTH', 'ask_for_location', stamp);
  const dismiss = await createFixture('DISMISS', 'ask_for_service', stamp);
  const evidence = {
    phase: 'UI01-FINAL-FIXTURES', project_ref: REF, owner_key: OWNER_KEY,
    created_at: new Date().toISOString(),
    fixtures: { auth, dismiss },
    allowed_hosts: [`${REF}.supabase.co`], external_egress: false,
    secrets_stored: false, pii_stored: false
  };
  const serialized = JSON.stringify(evidence, null, 2) + '\n';
  fs.writeFileSync(OUT, serialized, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ phase: evidence.phase, result: 'UI01_FINAL_FIXTURES_PREPARED', evidence: path.basename(OUT), evidence_sha256: sha(serialized), fixtures: { auth: auth.label, dismiss: dismiss.label } }));
}

main().catch(error => {
  console.log(JSON.stringify({ phase: 'UI01-FINAL-FIXTURES', result: 'FAIL', error: safeText(error?.code || error?.message || 'unknown') }));
  process.exitCode = 1;
});
