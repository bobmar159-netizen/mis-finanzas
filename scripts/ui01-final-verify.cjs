'use strict';

// Verifica las dos decisiones manuales UI-01 sin realizar decisiones ni efectos comerciales.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REF = 'uevilhbstnmmdlgyshlv';
const BASE = `https://${REF}.supabase.co`;
const FIXTURES = path.resolve(__dirname, '..', 'PREVIEW_UI01_AISLADO', 'ui01-final-fixtures-evidence.json');
const OUT = path.resolve(__dirname, '..', 'PREVIEW_UI01_AISLADO', 'ui01-final-verification-evidence.json');
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeText(value, max = 160) { return String(value ?? '').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, max); }
function rows(value) { return Array.isArray(value) ? value : []; }
function secret() { const value = String(process.env.SUPABASE_SECRET_KEY || '').trim(); if (!value.startsWith('sb_secret_') || value.length < 32) fail('UI01_FINAL_SECRET_MISSING'); return value; }
async function isolatedFetch(pathname) {
  const target = new URL(pathname, BASE); if (target.origin !== BASE) fail('UI01_FINAL_EGRESS_BLOCKED');
  const key = secret(); const response = await fetch(target, { headers: { apikey:key } });
  const data = await response.json().catch(() => ({})); if (!response.ok) fail(`UI01_FINAL_SUPABASE_${response.status}`); return data;
}
async function inspect(inboxId) {
  const inbox = rows(await isolatedFetch(`/rest/v1/yarbi_owner_inbox?id=eq.${inboxId}&select=id,status,owner_decision_status,dismissed_at,decision_updated_at`))[0] || null;
  const decisions = rows(await isolatedFetch(`/rest/v1/yarbi_owner_action_decisions?inbox_id=eq.${inboxId}&select=id,owner_decision,outcome,operation_ref`));
  const orders = rows(await isolatedFetch(`/rest/v1/yarbi_authorized_orders?inbox_id=eq.${inboxId}&select=id,authorized_action,execution_state,decision_id`));
  return { inbox, decisions, orders };
}
async function main() {
  if (!fs.existsSync(FIXTURES)) fail('UI01_FINAL_FIXTURES_EVIDENCE_MISSING');
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
  const auth = await inspect(Number(fixtures?.fixtures?.auth?.inbox_id));
  const dismiss = await inspect(Number(fixtures?.fixtures?.dismiss?.inbox_id));
  const authPass = auth.inbox?.owner_decision_status === 'authorized' && auth.decisions.length === 1 && auth.decisions[0]?.owner_decision === 'authorize' && auth.orders.length <= 1 && auth.orders.every(row => row.execution_state === 'authorized_pending_execution');
  const dismissPass = dismiss.inbox?.owner_decision_status === 'dismissed' && Boolean(dismiss.inbox?.dismissed_at) && dismiss.decisions.length === 1 && dismiss.decisions[0]?.owner_decision === 'dismiss' && dismiss.orders.length === 0;
  const evidence = { phase:'UI01-FINAL-VERIFY', project_ref:REF, verified_at:new Date().toISOString(), auth:{ inbox_id:Number(fixtures.fixtures.auth.inbox_id), status:auth.inbox?.owner_decision_status || null, decision_count:auth.decisions.length, order_count:auth.orders.length, execution_states:auth.orders.map(row=>row.execution_state).sort(), pass:authPass }, dismiss:{ inbox_id:Number(fixtures.fixtures.dismiss.inbox_id), status:dismiss.inbox?.owner_decision_status || null, decision_count:dismiss.decisions.length, order_count:dismiss.orders.length, pass:dismissPass }, allowed_hosts:[`${REF}.supabase.co`], external_egress:false, secrets_stored:false, pii_stored:false };
  const serialized=JSON.stringify(evidence,null,2)+'\n'; fs.writeFileSync(OUT,serialized,{encoding:'utf8',mode:0o600});
  console.log(JSON.stringify({phase:evidence.phase,result:authPass&&dismissPass?'UI01_FINAL_DECISIONS_VALIDATED':'PENDING_OR_FAILED',evidence:path.basename(OUT),evidence_sha256:sha(serialized),auth:authPass?'PASS':'PENDING_OR_FAILED',dismiss:dismissPass?'PASS':'PENDING_OR_FAILED'}));
  if (!authPass || !dismissPass) process.exitCode=2;
}
main().catch(error=>{console.log(JSON.stringify({phase:'UI01-FINAL-VERIFY',result:'FAIL',error:safeText(error?.code||error?.message||'unknown')}));process.exitCode=1;});
