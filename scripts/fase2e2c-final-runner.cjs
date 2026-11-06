'use strict';

/*
 * Fase 2E2C — runner manual, de una sola ejecución.
 *
 * Nunca ejecutes este archivo desde un entorno con credenciales de producción.
 * La única credencial admitida es SUPABASE_SECRET_KEY suministrada por process.env.
 * El runner no la imprime, serializa ni escribe en archivos.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PROJECT_REF = 'uevilhbstnmmdlgyshlv';
const SUPABASE_HOST = `${PROJECT_REF}.supabase.co`;
const SUPABASE_URL = `https://${SUPABASE_HOST}`;
const ROOT = path.resolve(__dirname, '..');
const HANDLER_PATH = path.join(ROOT, 'api', 'ai', 'process.js');
const EVIDENCE_PATH = path.join(__dirname, 'fase2e2c-final-evidence.json');
const SHA_PATH = path.join(__dirname, 'fase2e2c-final-evidence.sha256');

const egress = [];
const deferred = [];
const traceEvents = [];
let expectedFixtureId = null;
let observedClaimIds = [];

function fail(code, message) {
  const error = new Error(message || code);
  error.code = code;
  throw error;
}

function randomSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function redactError(error) {
  return {
    code: String(error?.code || 'F2E2C_RUNNER_ERROR').slice(0, 120),
    message: String(error?.message || error || 'unknown_error')
      .replace(/(?:eyJ[a-zA-Z0-9_=-]{10,}|sb_(?:secret|publishable)_[a-zA-Z0-9_-]+)/g, '[redacted]')
      .slice(0, 300)
  };
}

function asUrl(input) {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  if (input && typeof input.url === 'string') return new URL(input.url);
  fail('F2E2C_INVALID_FETCH_URL', 'La guardia recibió una URL de red no reconocible.');
}

function bodyJson(init) {
  if (!init?.body || typeof init.body !== 'string') return null;
  try { return JSON.parse(init.body); } catch (_) { return null; }
}

function installNetworkGuard() {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') fail('F2E2C_FETCH_UNAVAILABLE', 'Este Node no ofrece fetch nativo.');

  globalThis.fetch = async (input, init = {}) => {
    const url = asUrl(input);
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const allowed = url.protocol === 'https:' && url.hostname.toLowerCase() === SUPABASE_HOST;
    const entry = { host: url.hostname.toLowerCase(), path: url.pathname, method, allowed };
    egress.push(entry);
    if (!allowed) fail('F2E2C_EGRESS_BLOCKED', `Salida bloqueada hacia ${entry.host}`);

    const response = await originalFetch(input, init);
    if (url.pathname === '/rest/v1/rpc/claim_yarbi_message_analysis') {
      const rows = await response.clone().json().catch(() => []);
      observedClaimIds = Array.isArray(rows) ? rows.map(row => String(row?.message_id || '')).filter(Boolean) : [];
      if (!expectedFixtureId || observedClaimIds.length !== 1 || observedClaimIds[0] !== expectedFixtureId) {
        fail('F2E2C_UNEXPECTED_CLAIM', 'La RPC devolvió un trabajo distinto del fixture final; se abortó antes de procesarlo.');
      }
    }
    if (url.pathname === '/rest/v1/yarbi_agent_actions' && method === 'POST') {
      const payload = bodyJson(init);
      const event = Array.isArray(payload) ? payload[0] : null;
      if (event?.request_payload?.operation_id && event?.result_payload?.stage) {
        traceEvents.push({
          operation_id: String(event.request_payload.operation_id).slice(0, 160),
          stage: String(event.result_payload.stage).slice(0, 80),
          outcome: String(event.result_payload.outcome || '').slice(0, 40)
        });
      }
    }
    return response;
  };
  return () => { globalThis.fetch = originalFetch; };
}

function configureSyntheticEnvironment() {
  if (!String(process.env.SUPABASE_SECRET_KEY || '').trim()) {
    fail('F2E2C_SECRET_MISSING', 'Falta SUPABASE_SECRET_KEY en process.env.');
  }
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.VERCEL_ENV = 'preview';
  process.env.YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY = 'true';
  process.env.YARBI_PREVIEW_SUPABASE_PROJECT_REF = PROJECT_REF;
  process.env.YARBI_PREVIEW_AUDIT_ONLY = 'false';
  process.env.YARBI_PREVIEW_DEPLOYMENT_HOST = 'f2e2c-runner.vercel.app';
  process.env.AI_PROCESSOR_URL = 'https://f2e2c-runner.vercel.app';
  process.env.YARBI_TRACE_HMAC_KEY = randomSecret();
  process.env.ASSISTANT_API_TOKEN = randomSecret();
  process.env.YARBI_PREVIEW_SYNTHETIC_TOKEN = randomSecret();
  delete process.env.VERCEL_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.ENABLE_LEGACY_WEBHOOK_EXTRACTION;
  for (const name of [
    'GEMINI_API_KEY', 'GEMINI_KEY', 'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN',
    'YCLOUD_API_KEY', 'YCLOUD_KEY', 'NOTION_TOKEN', 'FNZ_NOTION_TOKEN',
    'GOOGLE_SHEETS_URL', 'GOOGLE_CALENDAR_CLIENT_EMAIL',
    'GOOGLE_CALENDAR_PRIVATE_KEY', 'VERIFY_TOKEN', 'CRON_SECRET'
  ]) delete process.env[name];
}

function loadSourceHandler() {
  const source = fs.readFileSync(HANDLER_PATH, 'utf8');
  const marker = 'export default async function handler(req, res) {';
  if (!source.includes(marker)) fail('F2E2C_HANDLER_EXPORT_UNEXPECTED', 'La exportación fuente del handler cambió.');
  const transformed = source.replace(marker, 'async function handler(req, res) {') + '\nmodule.exports = handler;\n';
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@vercel/functions') return { waitUntil: promise => deferred.push(Promise.resolve(promise)) };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const isolated = new Module(HANDLER_PATH, module);
    isolated.filename = HANDLER_PATH;
    isolated.paths = Module._nodeModulePaths(path.dirname(HANDLER_PATH));
    isolated._compile(transformed, HANDLER_PATH);
    if (typeof isolated.exports !== 'function') fail('F2E2C_HANDLER_LOAD_INVALID', 'El handler fuente no se pudo cargar.');
    return isolated.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function responseCapture() {
  let resolve;
  const done = new Promise(doneResolve => { resolve = doneResolve; });
  const response = {
    statusCode: null,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    status(code) { this.statusCode = Number(code); return this; },
    json(payload) { this.payload = payload; resolve(); return this; },
    end() { resolve(); return this; }
  };
  return { response, done };
}

function sanitizeHandlerPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const numeric = name => Number.isFinite(Number(payload[name])) ? Number(payload[name]) : null;
  return {
    status: typeof payload.status === 'string' ? payload.status.slice(0, 80) : null,
    run_id: Number.isFinite(Number(payload.run_id)) ? Number(payload.run_id) : null,
    messages_scanned: numeric('messages_scanned'),
    messages_processed: numeric('messages_processed'),
    contacts_affected: numeric('contacts_affected'),
    agenda_events_created: numeric('agenda_events_created'),
    intelligent_alerts_created: numeric('intelligent_alerts_created'),
    error_code: typeof payload.error === 'string' ? payload.error.slice(0, 120) : null,
    errors_count: Array.isArray(payload.errors) ? payload.errors.length : 0
  };
}

async function rest(pathname, options = {}) {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    ...(options.headers || {})
  };
  const response = await fetch(`${SUPABASE_URL}${pathname}`, { ...options, headers });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  if (!response.ok) {
    const error = new Error(`Supabase respondió HTTP ${response.status}`);
    error.code = `F2E2C_SUPABASE_${response.status}`;
    throw error;
  }
  return { response, data };
}

async function syntheticQueueBefore() {
  const result = await rest('/rest/v1/ai_message_analysis?message_id=like.F2%25&select=message_id,status,attempt_count,locked_at,next_retry_at&order=id.asc');
  return (Array.isArray(result.data) ? result.data : []).map(row => ({
    message_id: String(row.message_id || ''), status: String(row.status || ''),
    attempt_count: Number(row.attempt_count || 0), locked: Boolean(row.locked_at), retry_scheduled: Boolean(row.next_retry_at)
  }));
}

async function createFixture() {
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
  const id = `F2E2C-FINAL-${suffix}`;
  const payload = [{
    id,
    text: 'Mensaje sintético de auditoría sin identidad telefónica.',
    phone: null,
    title: 'F2E2C synthetic',
    app_name: 'audit',
    timestamp: Date.now(),
    metadata: { synthetic: true, audit_phase: 'F2E2C-FINAL', direction: 'incoming' }
  }];
  await rest('/rest/v1/whatsapp_messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
  return id;
}

async function readFixture(id) {
  const safe = encodeURIComponent(`eq.${id}`);
  const [message, analysis] = await Promise.all([
    rest(`/rest/v1/whatsapp_messages?id=${safe}&select=id,phone,contact_id`),
    rest(`/rest/v1/ai_message_analysis?message_id=${safe}&select=id,message_id,status,attempt_count,requires_review,contact_id,processing_run_id,error_message,lock_token,completed_at`)
  ]);
  return {
    message: (Array.isArray(message.data) ? message.data : []).map(row => ({
      id: String(row.id || ''), phone_is_null: row.phone == null, contact_id: row.contact_id == null ? null : Number(row.contact_id)
    })),
    analysis: (Array.isArray(analysis.data) ? analysis.data : []).map(row => ({
      id: Number(row.id), message_id: String(row.message_id || ''), status: String(row.status || ''),
      attempt_count: Number(row.attempt_count || 0), requires_review: Boolean(row.requires_review),
      contact_id: row.contact_id == null ? null : Number(row.contact_id),
      processing_run_id: row.processing_run_id == null ? null : Number(row.processing_run_id),
      has_error_code: Boolean(row.error_message), lock_cleared: row.lock_token == null,
      completed_at_present: Boolean(row.completed_at)
    }))
  };
}

function writeEvidence(evidence) {
  const sanitized = JSON.stringify(evidence, null, 2) + '\n';
  fs.writeFileSync(EVIDENCE_PATH, sanitized, { encoding: 'utf8', mode: 0o600 });
  const digest = crypto.createHash('sha256').update(sanitized, 'utf8').digest('hex');
  fs.writeFileSync(SHA_PATH, `${digest}  ${path.basename(EVIDENCE_PATH)}\n`, { encoding: 'utf8', mode: 0o600 });
  return digest;
}

async function main() {
  const startedAt = new Date().toISOString();
  const evidence = {
    phase: 'F2E2C-FINAL', project_ref: PROJECT_REF, started_at: startedAt,
    handler_source: 'api/ai/process.js', fixture: null, preexisting_synthetic_queue: [],
    claimed_message_ids: [], handler_response: null, fixture_after: null,
    trace_events_observed: [], egress: [], result: 'BLOCKED', error: null
  };
  let restoreFetch = null;
  try {
    configureSyntheticEnvironment();
    restoreFetch = installNetworkGuard();
    evidence.preexisting_synthetic_queue = await syntheticQueueBefore();
    const handler = loadSourceHandler();
    expectedFixtureId = await createFixture();
    evidence.fixture = expectedFixtureId;
    const capture = responseCapture();
    const request = {
      method: 'POST',
      headers: { 'x-assistant-token': process.env.ASSISTANT_API_TOKEN },
      body: { limit: 1, priority_message_id: expectedFixtureId, continuation_depth: 2, requested_by: 'F2E2C-FINAL' }
    };
    await handler(request, capture.response);
    await Promise.race([
      capture.done,
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('El handler no respondió a tiempo.'), { code: 'F2E2C_HANDLER_TIMEOUT' })), 20000))
    ]);
    await Promise.allSettled(deferred);
    evidence.claimed_message_ids = observedClaimIds;
    evidence.handler_response = { status: capture.response.statusCode, payload: sanitizeHandlerPayload(capture.response.payload) };
    evidence.fixture_after = await readFixture(expectedFixtureId);
    const analysis = evidence.fixture_after.analysis[0] || {};
    const correct = observedClaimIds.length === 1 && observedClaimIds[0] === expectedFixtureId
      && analysis.status === 'identity_pending'
      && analysis.requires_review === true
      && analysis.contact_id == null;
    evidence.result = correct ? 'BASE_CANONICA_Y_PROCESAMIENTO_MINIMO_VALIDADO_EN_AISLADO' : 'FAIL';
  } catch (error) {
    evidence.claimed_message_ids = observedClaimIds;
    evidence.error = redactError(error);
    evidence.result = error?.code === 'F2E2C_UNEXPECTED_CLAIM' ? 'BLOCKED' : 'FAIL';
  } finally {
    evidence.trace_events_observed = traceEvents;
    evidence.egress = egress;
    evidence.completed_at = new Date().toISOString();
    if (restoreFetch) restoreFetch();
    const hash = writeEvidence(evidence);
    console.log(JSON.stringify({ phase: evidence.phase, result: evidence.result, fixture: evidence.fixture, evidence_sha256: hash, evidence: path.basename(EVIDENCE_PATH) }));
    if (evidence.result !== 'BASE_CANONICA_Y_PROCESAMIENTO_MINIMO_VALIDADO_EN_AISLADO') process.exitCode = 1;
  }
}

main();
