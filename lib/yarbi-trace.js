const crypto = require('node:crypto');

// Fase 1C: eventos append-only sobre el ledger existente. Cada evento ocupa
// una fila inmutable; así no existe una actualización JSON que pueda perder
// eventos concurrentes. Este módulo no modifica CRM, agenda, memoria ni cola.
const TRACE_VERSION = 'yarbi-trace-v2';
const TRACE_ACTION_TYPE = 'observability_trace_event';
const TRACE_MODULE = 'crm'; // valor compatible con el ledger ya existente
const RETENTION_POLICY = Object.freeze({ minimum_days: 180, max_events_per_operation: 500, automatic_deletion: false });
const REF_PATTERN = /^[a-z_]+:[a-f0-9]{16,64}$/;
const OPERATION_PATTERN = /^op1-[a-z0-9_-]{4,48}-[a-f0-9]{32}$/i;
const EVENT_PATTERN = /^ev1-[a-f0-9]{32}$/i;
const PROVIDER_DIAGNOSTIC_CATEGORIES = new Set([
  'SCHEMA_UNSUPPORTED', 'SCHEMA_INVALID', 'MODEL_CONFIGURATION_INVALID',
  'GENERATION_CONFIG_INVALID', 'REQUEST_FIELD_UNSUPPORTED',
  'SDK_SERIALIZATION_ERROR', 'PROVIDER_INVALID_ARGUMENT_UNKNOWN'
]);
const PROVIDER_DIAGNOSTIC_SIGNALS = [
  'invalid_argument', 'mentions_schema', 'mentions_complexity', 'mentions_model',
  'mentions_generation_config', 'mentions_unknown_field'
];

function cleanText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function traceSecret(value = process.env.YARBI_TRACE_HMAC_KEY) {
  const secret = cleanText(value, 1024);
  return secret.length >= 32 ? secret : null;
}

function traceConfigError(value) {
  return traceSecret(value) ? null : 'trace_hmac_key_missing';
}

function requireTraceSecret(value) {
  const secret = traceSecret(value);
  if (!secret) {
    const error = new Error('trace_hmac_key_missing');
    error.code = 'trace_hmac_key_missing';
    throw error;
  }
  return secret;
}

function hmac(secret, namespace, value, length = 32) {
  return crypto.createHmac('sha256', requireTraceSecret(secret)).update(`${namespace}:${value}`).digest('hex').slice(0, length);
}

function hashReference(kind, value, secret) {
  const safeKind = cleanText(kind, 32).toLowerCase().replace(/[^a-z0-9_]/g, '') || 'ref';
  const raw = cleanText(value, 512);
  if (!raw) return null;
  return `${safeKind}:${hmac(secret, `reference:${safeKind}`, raw, 24)}`;
}

function operationIdFromReference(kind, reference, secret) {
  const safeKind = cleanText(kind, 48).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'operation';
  const raw = cleanText(reference, 512);
  if (!raw) throw new Error('trace_operation_reference_missing');
  return `op1-${safeKind}-${hmac(secret, `operation:${safeKind}`, raw)}`;
}

function newOperationId(kind, secret) {
  const safeKind = cleanText(kind, 48).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'operation';
  return `op1-${safeKind}-${hmac(secret, `operation:${safeKind}`, crypto.randomUUID())}`;
}

function eventIdFor(operationId, stage, eventKey, secret) {
  if (!OPERATION_PATTERN.test(cleanText(operationId, 160))) throw new Error('trace_operation_id_invalid');
  const safeStage = cleanText(stage, 64).toLowerCase().replace(/[^a-z0-9_.-]/g, '_') || 'unknown';
  const safeKey = cleanText(eventKey, 512);
  if (!safeKey) throw new Error('trace_event_key_missing');
  return `ev1-${hmac(secret, `event:${safeStage}`, `${operationId}:${safeKey}`)}`;
}

function errorCode(error) {
  const text = cleanText(error?.message || error, 500).toLowerCase();
  if (/timeout|timed out|abort/.test(text)) return 'timeout';
  if (/unauthor|token|forbidden/.test(text)) return 'authorization_failed';
  if (/gemini|generativelanguage/.test(text)) return 'model_request_failed';
  if (/supabase|postgres|database/.test(text)) return 'storage_failed';
  if (/json|parse|schema/.test(text)) return 'invalid_payload';
  return text ? 'operation_failed' : 'unknown_failure';
}

function safeIso(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function traceVersion(env = process.env) {
  return cleanText(env.YARBI_RELEASE_ID || env.VERCEL_GIT_COMMIT_SHA || 'unversioned', 80);
}

function normalizeRefs(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .filter(value => REF_PATTERN.test(String(value || '')))
    .map(String))].slice(0, 16);
}

function normalizeOperationRefs(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .filter(value => OPERATION_PATTERN.test(String(value || '')))
    .map(String))].slice(0, 12);
}

function normalizedCounts(value) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
    .filter(([key, count]) => /^[a-z0-9_]{1,40}$/i.test(key) && Number.isFinite(Number(count)))
    .slice(0, 12)
    .map(([key, count]) => [key, Math.max(0, Math.min(Number(count), 1_000_000))]));
}

function safeProviderDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const category = cleanText(value.category, 64).toUpperCase();
  const model = cleanText(value.model, 120);
  const schemaHash = cleanText(value.schema_sha256, 64).toLowerCase();
  const status = Number(value.http_status);
  const providerStatus = cleanText(value.provider_status, 80).toUpperCase().replace(/[^A-Z0-9_.-]/g, '_');
  const provider = cleanText(value.provider, 24).toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  const signals = Object.fromEntries(PROVIDER_DIAGNOSTIC_SIGNALS.map(key => [key, value.signals?.[key] === true]));
  if (!PROVIDER_DIAGNOSTIC_CATEGORIES.has(category)) return null;
  return {
    provider: provider === 'gemini' ? provider : 'unknown',
    http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    provider_status: providerStatus || null,
    category,
    signals,
    schema_sha256: /^[a-f0-9]{64}$/.test(schemaHash) ? schemaHash : null,
    model: /^[a-z0-9._-]{1,120}$/i.test(model) ? model : null
  };
}

function safeTraceEvent(event = {}) {
  const operationId = cleanText(event.operation_id, 160);
  const eventId = cleanText(event.event_id, 160);
  if (!OPERATION_PATTERN.test(operationId)) throw new Error('trace_operation_id_invalid');
  if (!EVENT_PATTERN.test(eventId)) throw new Error('trace_event_id_invalid');
  const stage = cleanText(event.stage, 64).toLowerCase().replace(/[^a-z0-9_.-]/g, '_') || 'unknown';
  const outcome = ['started', 'completed', 'failed'].includes(event.outcome) ? event.outcome : 'completed';
  const startedAt = safeIso(event.started_at);
  const endedAt = safeIso(event.ended_at || (outcome === 'started' ? startedAt : new Date().toISOString()));
  const durationMs = Number.isFinite(Number(event.duration_ms))
    ? Math.max(0, Math.min(Number(event.duration_ms), 86_400_000))
    : Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
  return {
    operation_id: operationId,
    event_id: eventId,
    operation_type: cleanText(event.operation_type || 'operation', 48).replace(/[^a-z0-9_.-]/gi, '_'),
    stage,
    outcome,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    component: cleanText(event.component || 'backend', 48).replace(/[^a-z0-9_.-]/gi, '_'),
    component_version: cleanText(event.component_version || 'unversioned', 80),
    message_refs: normalizeRefs(event.message_refs),
    contact_refs: normalizeRefs(event.contact_refs),
    run_refs: normalizeRefs(event.run_refs),
    analysis_refs: normalizeRefs(event.analysis_refs),
    causation_operation_ids: normalizeOperationRefs(event.causation_operation_ids),
    error_code: outcome === 'failed' ? cleanText(event.error_code || 'operation_failed', 64).replace(/[^a-z0-9_.-]/gi, '_') : null,
    counts: normalizedCounts(event.counts),
    provider_diagnostic: safeProviderDiagnostic(event.provider_diagnostic)
  };
}

function immutableFingerprint(event, secret) {
  const payload = JSON.stringify({
    operation_id: event.operation_id,
    event_id: event.event_id,
    operation_type: event.operation_type,
    stage: event.stage,
    outcome: event.outcome,
    message_refs: event.message_refs,
    contact_refs: event.contact_refs,
    run_refs: event.run_refs,
    analysis_refs: event.analysis_refs,
    causation_operation_ids: event.causation_operation_ids,
    error_code: event.error_code,
    counts: event.counts,
    provider_diagnostic: event.provider_diagnostic
  });
  return hmac(secret, 'event_fingerprint', payload);
}

function eventRecord(rawEvent, secret, now = new Date().toISOString()) {
  const event = safeTraceEvent(rawEvent);
  const fingerprint = immutableFingerprint(event, secret);
  const status = event.outcome === 'failed' ? 'failed' : (event.outcome === 'started' ? 'executing' : 'executed');
  return {
    action_id: `trace:${event.operation_id}:${event.event_id}`,
    module: TRACE_MODULE,
    action_type: TRACE_ACTION_TYPE,
    status,
    target_type: 'trace_operation',
    target_id: event.operation_id,
    confirmation_required: false,
    request_payload: {
      trace_version: TRACE_VERSION,
      operation_id: event.operation_id,
      event_id: event.event_id,
      operation_type: event.operation_type,
      stage: event.stage,
      started_at: event.started_at,
      component: event.component,
      component_version: event.component_version,
      retention: RETENTION_POLICY,
      fingerprint
    },
    result_payload: {
      trace_version: TRACE_VERSION,
      operation_id: event.operation_id,
      event_id: event.event_id,
      stage: event.stage,
      outcome: event.outcome,
      ended_at: event.ended_at,
      duration_ms: event.duration_ms,
      refs: {
        messages: event.message_refs,
        contacts: event.contact_refs,
        runs: event.run_refs,
        analyses: event.analysis_refs,
        causation_operations: event.causation_operation_ids
      },
      counts: event.counts,
      error_code: event.error_code,
      ...(event.provider_diagnostic ? { provider_diagnostic: event.provider_diagnostic } : {})
    },
    error_message: event.error_code || null,
    history: [{
      at: safeIso(now), stage: event.stage, outcome: event.outcome,
      started_at: event.started_at, ended_at: event.ended_at,
      duration_ms: event.duration_ms, error_code: event.error_code
    }],
    updated_at: safeIso(now),
    executed_at: event.outcome === 'completed' ? event.ended_at : null
  };
}

function storedFingerprint(row) {
  return cleanText(row?.request_payload?.fingerprint, 128);
}

async function readStoredEvent({ supabaseUrl, supabaseKey, actionId, fetchImpl }) {
  const url = `${String(supabaseUrl).replace(/\/$/, '')}/rest/v1/yarbi_agent_actions?action_id=eq.${encodeURIComponent(actionId)}&select=action_id,request_payload,result_payload,status&limit=1`;
  const response = await fetchImpl(url, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
  if (!response.ok) throw new Error('trace_duplicate_lookup_failed');
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

// Inserción atómica por clave primaria. Un reintento solo se considera correcto
// si la fila existente tiene la misma huella inmutable; en otro caso se informa
// conflicto y nunca se confirma falsamente el evento.
async function recordTrace({ supabaseUrl, supabaseKey, traceSecret: suppliedSecret, event, fetchImpl = fetch }) {
  if (!supabaseUrl || !supabaseKey) return { ok: false, reason: 'trace_storage_unconfigured' };
  const secret = requireTraceSecret(suppliedSecret);
  const record = eventRecord(event, secret);
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' };
  const response = await fetchImpl(`${String(supabaseUrl).replace(/\/$/, '')}/rest/v1/yarbi_agent_actions`, {
    method: 'POST', headers, body: JSON.stringify([record])
  });
  if (!response.ok) throw new Error('trace_insert_failed');
  const inserted = await response.json().catch(() => []);
  if (Array.isArray(inserted) && inserted[0]?.action_id === record.action_id) {
    return { ok: true, inserted: true, duplicate: false, operation_id: event.operation_id, event_id: event.event_id, action_id: record.action_id };
  }
  const existing = await readStoredEvent({ supabaseUrl, supabaseKey, actionId: record.action_id, fetchImpl });
  if (!existing) throw new Error('trace_duplicate_unconfirmed');
  if (storedFingerprint(existing) !== record.request_payload.fingerprint) {
    const error = new Error('trace_event_conflict');
    error.code = 'trace_event_conflict';
    throw error;
  }
  return { ok: true, inserted: false, duplicate: true, operation_id: event.operation_id, event_id: event.event_id, action_id: record.action_id };
}

// El ledger es append-only: cerrar una operación no modifica su evento inicial.
// Se agrega un evento terminal idempotente con la misma operation_id, de modo que
// reconstructOperation pueda distinguir una operación completa de una aún abierta.
async function closeTraceOperation({
  supabaseUrl,
  supabaseKey,
  traceSecret: suppliedSecret,
  operationId,
  operationType,
  eventKey,
  startedAt,
  endedAt = new Date().toISOString(),
  component,
  componentVersion,
  messageRefs = [],
  contactRefs = [],
  runRefs = [],
  analysisRefs = [],
  causationOperationIds = [],
  counts = {},
  fetchImpl = fetch
}) {
  const secret = requireTraceSecret(suppliedSecret);
  const safeOperationId = cleanText(operationId, 160);
  if (!OPERATION_PATTERN.test(safeOperationId)) throw new Error('trace_operation_id_invalid');
  const key = cleanText(eventKey || 'operation_closed', 512);
  if (!key) throw new Error('trace_close_event_key_missing');
  return recordTrace({
    supabaseUrl,
    supabaseKey,
    traceSecret: secret,
    fetchImpl,
    event: {
      operation_id: safeOperationId,
      event_id: eventIdFor(safeOperationId, 'operation_closed', key, secret),
      operation_type: operationType,
      stage: 'operation_closed',
      outcome: 'completed',
      started_at: startedAt,
      ended_at: endedAt,
      component,
      component_version: componentVersion,
      message_refs: messageRefs,
      contact_refs: contactRefs,
      run_refs: runRefs,
      analysis_refs: analysisRefs,
      causation_operation_ids: causationOperationIds,
      counts
    }
  });
}

// Persiste primero el resultado comercial/técnico de una etapa terminal. Solo
// después intenta el cierre de trazabilidad. Si el cierre falla, el resultado
// original queda intacto y el llamador recibe una señal explícita para registrar
// el fallo sin declarar la operación auditada por completo.
async function recordTerminalTrace({
  supabaseUrl,
  supabaseKey,
  traceSecret,
  event,
  closeEventKey,
  fetchImpl = fetch
}) {
  const terminal = await recordTrace({ supabaseUrl, supabaseKey, traceSecret, event, fetchImpl });
  if (!terminal?.ok) return { ok: false, terminal, close: null, reason: 'terminal_trace_unrecorded' };
  try {
    const close = await closeTraceOperation({
      supabaseUrl,
      supabaseKey,
      traceSecret,
      operationId: event.operation_id,
      operationType: event.operation_type,
      eventKey: closeEventKey || `close:${event.stage || 'terminal'}`,
      startedAt: event.started_at,
      component: event.component,
      componentVersion: event.component_version,
      messageRefs: event.message_refs,
      contactRefs: event.contact_refs,
      runRefs: event.run_refs,
      analysisRefs: event.analysis_refs,
      causationOperationIds: event.causation_operation_ids,
      counts: event.counts,
      fetchImpl
    });
    return close?.ok
      ? { ok: true, terminal, close, reason: null }
      : { ok: false, terminal, close, reason: 'trace_close_unrecorded' };
  } catch (error) {
    return { ok: false, terminal, close: null, reason: 'trace_close_failed', error_code: errorCode(error) };
  }
}

function eventView(row) {
  const request = row?.request_payload || {};
  const result = row?.result_payload || {};
  return {
    operation_id: cleanText(request.operation_id || row?.target_id, 160),
    event_id: cleanText(request.event_id, 160),
    stage: cleanText(result.stage || request.stage, 64),
    outcome: cleanText(result.outcome, 32),
    started_at: request.started_at || null,
    ended_at: result.ended_at || null,
    duration_ms: Number(result.duration_ms || 0),
    error_code: result.error_code || null,
    provider_diagnostic: safeProviderDiagnostic(result.provider_diagnostic),
    refs: result.refs || {},
    operation_type: request.operation_type || 'operation'
  };
}

// No decide que una operación global fue ejecutada: solo la cierra un evento
// explícito operation_closed. Una falla sigue visible aunque existan éxitos.
function reconstructOperation(rows) {
  const events = (Array.isArray(rows) ? rows : [])
    .map(row => row?.request_payload ? eventView(row) : row)
    .filter(event => OPERATION_PATTERN.test(event?.operation_id));
  const operationId = events[0]?.operation_id || null;
  const ordered = events.sort((a, b) => String(a.ended_at || a.started_at).localeCompare(String(b.ended_at || b.started_at)));
  const failures = ordered.filter(event => event.outcome === 'failed');
  const closed = ordered.find(event => event.stage === 'operation_closed' && event.outcome === 'completed');
  return {
    operation_id: operationId,
    operation_type: ordered[0]?.operation_type || null,
    global_status: closed ? (failures.length ? 'completed_with_failures' : 'completed') : (failures.length ? 'attention_required' : 'open'),
    event_count: ordered.length,
    failed_event_count: failures.length,
    events: ordered
  };
}

function reconstructJourney(rows) {
  const events = (Array.isArray(rows) ? rows : []).map(eventView);
  const byOperation = new Map();
  for (const event of events) {
    if (!OPERATION_PATTERN.test(event.operation_id)) continue;
    if (!byOperation.has(event.operation_id)) byOperation.set(event.operation_id, []);
    byOperation.get(event.operation_id).push(event);
  }
  const operations = [...byOperation.values()].map(reconstructOperation);
  const refs = new Map();
  for (const operation of operations) {
    for (const event of operation.events) {
      const values = [...(event.refs?.messages || []), ...(event.refs?.causation_operations || [])];
      for (const ref of values) {
        if (!refs.has(ref)) refs.set(ref, new Set());
        refs.get(ref).add(operation.operation_id);
      }
    }
  }
  const links = [...refs.entries()].filter(([, ids]) => ids.size > 1).map(([ref, ids]) => ({ ref, operation_ids: [...ids].sort() }));
  return { operations, links };
}

module.exports = {
  EVENT_PATTERN,
  OPERATION_PATTERN,
  RETENTION_POLICY,
  TRACE_ACTION_TYPE,
  TRACE_VERSION,
  errorCode,
  eventIdFor,
  eventRecord,
  closeTraceOperation,
  hashReference,
  newOperationId,
  operationIdFromReference,
  recordTrace,
  recordTerminalTrace,
  reconstructJourney,
  reconstructOperation,
  safeTraceEvent,
  safeProviderDiagnostic,
  traceConfigError,
  traceSecret,
  traceVersion
};
