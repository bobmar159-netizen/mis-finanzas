'use strict';

/*
 * Fase 3J.1 — runner MANUAL de una sola ejecución.
 *
 * Lee los secretos únicamente desde variables de la sesión de PowerShell:
 *   SUPABASE_ACCESS_TOKEN  (PAT limitado del proyecto aislado)
 *   SUPABASE_SECRET_KEY    (clave Secret/service_role del proyecto aislado)
 *
 * Nunca imprime, persiste ni incluye las credenciales en la evidencia.
 * Si encuentra un candidato previo que no sea F3J-REMOTE, aborta antes de
 * invocar el handler para no contaminar evidencia anterior.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_REF = 'uevilhbstnmmdlgyshlv';
const SUPABASE_HOST = `${PROJECT_REF}.supabase.co`;
const SUPABASE_URL = `https://${SUPABASE_HOST}`;
const MANAGEMENT_HOST = 'api.supabase.com';
const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '20261030_f3j_proactive_loop.sql');
const HANDLER_PATH = path.join(ROOT, 'api', 'assistant', 'proactive-loop.js');
const EVIDENCE_PATH = path.join(__dirname, 'fase3j1-isolated-evidence.json');
const SHA_PATH = path.join(__dirname, 'fase3j1-isolated-evidence.sha256');

const egress = { management: [], handler: [] };
let networkPhase = 'management';

function error(code, message) { const err = new Error(message || code); err.code = code; return err; }
function fail(code, message) { throw error(code, message); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function randomSecret() { return crypto.randomBytes(32).toString('hex'); }
function text(value, limit = 160) { return String(value ?? '').trim().slice(0, limit); }
function safeError(value) {
  return {
    code: text(value?.code || 'F3J1_RUNNER_ERROR', 100),
    message: text(value?.message || value || 'unknown_error', 280)
      .replace(/(?:eyJ[a-zA-Z0-9_=-]{10,}|sb_(?:secret|publishable)_[a-zA-Z0-9_-]+)/g, '[redacted]')
  };
}
function requireSecret(name, minimum = 20) {
  const value = String(process.env[name] || '').trim();
  if (value.length < minimum) fail('F3J1_SECRET_MISSING', `Falta ${name} en la sesión de PowerShell.`);
  return value;
}
function jsonBody(init) {
  if (typeof init?.body !== 'string') return null;
  try { return JSON.parse(init.body); } catch (_) { return null; }
}

function installNetworkGuard() {
  const original = globalThis.fetch;
  if (typeof original !== 'function') fail('F3J1_FETCH_UNAVAILABLE');
  globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const host = url.hostname.toLowerCase();
    const allowed = url.protocol === 'https:' && (host === SUPABASE_HOST || (networkPhase === 'management' && host === MANAGEMENT_HOST));
    const event = { host, path: url.pathname, method: String(init.method || input?.method || 'GET').toUpperCase(), allowed };
    egress[networkPhase].push(event);
    if (!allowed) fail('F3J1_EGRESS_BLOCKED', `Salida bloqueada: ${host}`);
    return original(input, init);
  };
  return () => { globalThis.fetch = original; };
}

async function readJson(response, label) {
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
  if (!response.ok) {
    // Solo conservamos el código/mensaje de protocolo, truncado y redactado.
    // No se registra ningún encabezado ni cuerpo que pudiera contener secretos.
    const detail = text(data?.message || data?.error || data?.hint || `HTTP ${response.status}`, 220)
      .replace(/(?:eyJ[a-zA-Z0-9_=-]{10,}|sb_(?:secret|publishable)_[a-zA-Z0-9_-]+)/g, '[redacted]');
    fail(`F3J1_HTTP_${response.status}`, `${label} respondió HTTP ${response.status}: ${detail}`);
  }
  return data;
}

async function management(pathname, options = {}) {
  const accessToken = requireSecret('SUPABASE_ACCESS_TOKEN');
  const response = await fetch(`https://${MANAGEMENT_HOST}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  return readJson(response, 'Supabase Management API');
}

async function sql(query, readOnly = false) {
  const suffix = readOnly ? '/read-only' : '';
  return management(`/v1/projects/${PROJECT_REF}/database/query${suffix}`, {
    method: 'POST', body: JSON.stringify({ query })
  });
}

async function rest(pathname, options = {}) {
  const key = requireSecret('SUPABASE_SECRET_KEY', 32);
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(options.headers || {}) }
  });
  return readJson(response, 'Supabase REST');
}

function canonicalRows(data) { return Array.isArray(data) ? data : (Array.isArray(data?.result) ? data.result : []); }

async function verifyProject() {
  const project = await management(`/v1/projects/${PROJECT_REF}`, { method: 'GET' });
  const ref = text(project?.ref || project?.id || project?.project_ref, 80);
  if (ref !== PROJECT_REF) fail('F3J1_PROJECT_REF_MISMATCH', 'El proyecto remoto no coincide con el aislado autorizado.');
  return { ref };
}

async function preflight() {
  const objects = canonicalRows(await sql(`
    select c.relname as name
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname in
      ('crm_contacts','yarbi_contact_operational_memory','yarbi_proactive_runs','yarbi_owner_notification_state','yarbi_owner_inbox')
     order by c.relname;`, true)).map(row => text(row.name, 80));
  const base = objects.includes('crm_contacts') && objects.includes('yarbi_contact_operational_memory');
  const loopObjects = objects.filter(name => name.startsWith('yarbi_proactive_') || name === 'yarbi_owner_notification_state' || name === 'yarbi_owner_inbox');
  if (!base) fail('F3J1_BASE_SCHEMA_MISSING', 'Faltan los contratos 3A/3E requeridos.');
  const expected = ['yarbi_proactive_runs', 'yarbi_owner_notification_state', 'yarbi_owner_inbox'];
  const allPresent = expected.every(name => loopObjects.includes(name));
  if (loopObjects.length && !allPresent) fail('F3J1_LOOP_SCHEMA_PARTIAL', 'El esquema F3J está parcialmente presente; se requiere revisión, no corrección automática.');
  return {
    base_objects: objects.filter(name => !name.startsWith('yarbi_proactive_') && !name.startsWith('yarbi_owner_')),
    loop_objects_before: loopObjects,
    migration_state: allPresent ? 'already_applied' : 'not_applied'
  };
}

async function applyMigration(source, digest) {
  const result = await management(`/v1/projects/${PROJECT_REF}/database/migrations`, {
    method: 'POST', body: JSON.stringify({ name: '20261030_f3j_proactive_loop', query: source })
  });
  return { applied: true, migration_sha256: digest, response_shape: Array.isArray(result) ? 'array' : typeof result };
}

async function scopeFixtureCandidates(rows, prefix = 'F3J-REMOTE-') {
  const contactIds = [...new Set(canonicalRows(rows).map(row => Number(row?.contact_id)).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!contactIds.length) return { accepted: [], rejected_count: 0 };
  const markers = canonicalRows(await rest('/rest/v1/yarbi_contact_operational_memory?select=contact_id,source_event_id&state=eq.active'
    + '&contact_id=in.(' + encodeURIComponent(contactIds.join(',')) + ')'
    + '&source_event_id=like.' + encodeURIComponent(prefix + '*')));
  const acceptedIds = new Set(markers.filter(row => text(row?.source_event_id, 160).startsWith(prefix)).map(row => Number(row.contact_id)));
  const accepted = canonicalRows(rows).filter(row => acceptedIds.has(Number(row?.contact_id)));
  return { accepted, rejected_count: canonicalRows(rows).length - accepted.length };
}

async function verifyFixtureFilterBeforeCreation() {
  networkPhase = 'handler';
  const rows = await rest('/rest/v1/rpc/list_yarbi_proactive_candidates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_as_of: new Date().toISOString(), p_limit: 200 })
  });
  const scoped = await scopeFixtureCandidates(rows);
  if (scoped.accepted.length) fail('F3J1_REMOTE_FIXTURE_PREFIX_ALREADY_EXISTS', 'Ya existe un candidato F3J-REMOTE previo; se requiere revisión explícita.');
  return { general_candidates_excluded: scoped.rejected_count, eligible_f3j_remote_before: scoped.accepted.length };
}

async function createFixture() {
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const fixture = `F3J-REMOTE-${suffix}`;
  const contact = await rest('/rest/v1/crm_contacts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{ source: 'whatsapp', commercial_status: 'caliente', last_contact_at: new Date().toISOString() }])
  });
  const contactId = Number(canonicalRows(contact)[0]?.id);
  if (!Number.isSafeInteger(contactId) || contactId <= 0) fail('F3J1_FIXTURE_CONTACT_CREATE_FAILED');
  const memory = {
    contact_id: contactId, memory_type: 'visit', memory_key: `visit:${fixture}`, value: { requested: true },
    source: 'internal_event', source_event_id: fixture, occurred_at: new Date().toISOString(), state: 'active'
  };
  await rest('/rest/v1/yarbi_contact_operational_memory', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify([memory])
  });
  return { fixture, contact_id: contactId };
}

function responseCapture() {
  let resolve; const done = new Promise(ok => { resolve = ok; });
  return { done, response: { statusCode: null, payload: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; resolve(); return this; } } };
}

async function invokeRealHandler() {
  const handler = require(HANDLER_PATH);
  const cronSecret = randomSecret();
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.VERCEL_ENV = 'preview';
  process.env.YARBI_PREVIEW_PROACTIVE_LOOP_ONLY = 'true';
  process.env.YARBI_PREVIEW_SUPABASE_PROJECT_REF = PROJECT_REF;
  process.env.YARBI_F3J_REMOTE_TEST_MODE = 'true';
  process.env.YARBI_F3J_REMOTE_FIXTURE_PREFIX = 'F3J-REMOTE-';
  process.env.CRON_SECRET = cronSecret;
  process.env.YARBI_PROACTIVE_INTERVAL_MINUTES = '15';
  for (const key of ['GEMINI_API_KEY','GEMINI_KEY','META_ACCESS_TOKEN','WHATSAPP_TOKEN','YCLOUD_API_KEY','YCLOUD_KEY','NOTION_TOKEN','FNZ_NOTION_TOKEN','GOOGLE_SHEETS_URL','GOOGLE_CALENDAR_CLIENT_EMAIL','GOOGLE_CALENDAR_PRIVATE_KEY']) delete process.env[key];
  const capture = responseCapture();
  await handler({ method: 'GET', headers: { authorization: `Bearer ${cronSecret}` } }, capture.response);
  await Promise.race([capture.done, new Promise((_, reject) => setTimeout(() => reject(error('F3J1_HANDLER_TIMEOUT')), 30000))]);
  return { http_status: capture.response.statusCode, payload: capture.response.payload || null };
}

function sanitizePayload(payload) {
  return {
    ok: payload?.ok === true,
    status: text(payload?.status, 80) || null,
    reason: text(payload?.reason, 120) || null,
    has_run_key: Boolean(text(payload?.run_key, 180)),
    run_key: text(payload?.run_key, 180) || null,
    has_next_review: Boolean(text(payload?.next_review_at, 80))
  };
}

async function inspectFixture(fixture, runKey) {
  const safe = encodeURIComponent(`eq.${runKey}`);
  const rows = canonicalRows(await rest(`/rest/v1/yarbi_proactive_runs?run_key=${safe}&select=id,status,brief_decision,notification_fingerprint,evaluated_contacts,actionable_count&order=id.desc&limit=1`));
  const run = rows[0] || {};
  const inbox = canonicalRows(await rest(`/rest/v1/yarbi_owner_inbox?run_id=eq.${encodeURIComponent(String(run.id || 0))}&select=id,status,urgency,notification_mode,fingerprint&limit=2`));
  return { run: { status: text(run.status, 80), decision: text(run.brief_decision, 80), evaluated_contacts: Number(run.evaluated_contacts || 0), actionable_count: Number(run.actionable_count || 0), has_fingerprint: Boolean(text(run.notification_fingerprint, 160)) }, inbox_count: inbox.length, inbox: inbox.map(row => ({ status: text(row.status, 40), urgency: text(row.urgency, 20), mode: text(row.notification_mode, 20), has_fingerprint: Boolean(text(row.fingerprint, 160)) })) };
}

function writeEvidence(value) {
  const serialized = JSON.stringify(value, null, 2) + '\n';
  fs.writeFileSync(EVIDENCE_PATH, serialized, { encoding: 'utf8', mode: 0o600 });
  const digest = sha256(serialized);
  fs.writeFileSync(SHA_PATH, `${digest}  ${path.basename(EVIDENCE_PATH)}\n`, { encoding: 'utf8', mode: 0o600 });
  return digest;
}

async function main() {
  const evidence = { phase: 'F3J.1', project_ref: PROJECT_REF, migration: null, preflight: null, fixture: null, handler: null, fixture_result: null, egress, result: 'BLOCKED', error: null, started_at: new Date().toISOString() };
  let restoreFetch;
  try {
    requireSecret('SUPABASE_ACCESS_TOKEN'); requireSecret('SUPABASE_SECRET_KEY', 32);
    restoreFetch = installNetworkGuard();
    evidence.project = await verifyProject();
    const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
    evidence.migration = { file: path.basename(MIGRATION_PATH), sha256: sha256(migration) };
    evidence.preflight = await preflight();
    if (evidence.preflight.migration_state === 'not_applied') await applyMigration(migration, evidence.migration.sha256);
    else evidence.migration.already_applied = true;
    evidence.preflight.candidate_safety = await verifyFixtureFilterBeforeCreation();
    evidence.fixture = await createFixture();
    evidence.handler = await invokeRealHandler();
    const handlerRunKey = text(evidence.handler.payload?.run_key, 180);
    evidence.handler.payload = sanitizePayload(evidence.handler.payload);
    if (!handlerRunKey) fail('F3J1_HANDLER_RUN_KEY_MISSING');
    evidence.fixture_result = await inspectFixture(evidence.fixture, handlerRunKey);
    const permitted = egress.handler.every(event => event.allowed && event.host === SUPABASE_HOST);
    const completed = evidence.handler.http_status === 200 && evidence.handler.payload.ok && evidence.fixture_result.run.status === 'completed' && evidence.fixture_result.inbox_count === 1;
    evidence.result = completed && permitted ? 'FASE3J_LOOP_PROACTIVO_SCHEDULER_DUENO_VALIDADO_EN_AISLADO' : 'FAIL';
  } catch (caught) {
    evidence.error = safeError(caught);
    evidence.result = String(caught?.code || '').startsWith('F3J1_FOREIGN_') ? 'BLOCKED' : 'FAIL';
  } finally {
    evidence.completed_at = new Date().toISOString();
    if (restoreFetch) restoreFetch();
    const digest = writeEvidence(evidence);
    console.log(JSON.stringify({ phase: evidence.phase, result: evidence.result, evidence: path.basename(EVIDENCE_PATH), evidence_sha256: digest }));
    if (evidence.result !== 'FASE3J_LOOP_PROACTIVO_SCHEDULER_DUENO_VALIDADO_EN_AISLADO') process.exitCode = 1;
  }
}

main();
