const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const trace = require(path.join(root, 'lib', 'yarbi-trace.js'));
const SECRET = 'phase1c-test-secret-with-at-least-32-characters';

function makeEvent(operationId, stage, key, extra = {}) {
  return {
    operation_id: operationId,
    event_id: trace.eventIdFor(operationId, stage, key, SECRET),
    operation_type: extra.operation_type || 'test_operation',
    stage,
    outcome: extra.outcome || 'completed',
    started_at: extra.started_at || '2026-10-27T13:00:00.000Z',
    ended_at: extra.ended_at || '2026-10-27T13:00:01.000Z',
    component: extra.component || 'test',
    component_version: 'phase1c-test',
    message_refs: extra.message_refs || [],
    contact_refs: extra.contact_refs || [],
    causation_operation_ids: extra.causation_operation_ids || [],
    error_code: extra.error_code,
    counts: extra.counts || {},
    provider_diagnostic: extra.provider_diagnostic || null
  };
}

// Simula la semántica atómica de INSERT ... ON CONFLICT DO NOTHING de PostgREST.
// La inserción se decide dentro de una sola operación contra el Map compartido.
function atomicLedgerMock({ failInsert = false, insertDelayMs = 0 } = {}) {
  const rows = new Map();
  const metrics = { insert_calls: 0, lookup_calls: 0, conflicts: 0 };
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET') {
      metrics.lookup_calls += 1;
      const decoded = decodeURIComponent(String(url).match(/action_id=eq\.([^&]+)/)?.[1] || '');
      return { ok: true, json: async () => rows.has(decoded) ? [rows.get(decoded)] : [] };
    }
    metrics.insert_calls += 1;
    if (insertDelayMs) await new Promise(resolve => setTimeout(resolve, insertDelayMs));
    if (failInsert) return { ok: false, status: 503, json: async () => ({}) };
    const record = JSON.parse(options.body)[0];
    if (rows.has(record.action_id)) {
      metrics.conflicts += 1;
      return { ok: true, status: 201, json: async () => [] };
    }
    rows.set(record.action_id, record);
    return { ok: true, status: 201, json: async () => [record] };
  };
  return { rows, metrics, fetchImpl };
}

async function save(mock, event) {
  return trace.recordTrace({
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'service-role-is-not-recorded',
    traceSecret: SECRET,
    event,
    fetchImpl: mock.fetchImpl
  });
}

test('Fase 1A: el generador distingue artefactos, backend y no despliega', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'generate-version-manifest.js'), 'utf8');
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /version_name/);
  assert.match(source, /tracked_files/);
  assert.match(source, /deployment_id/);
  assert.match(source, /alias/);
  assert.doesNotMatch(source, /vercel\s+alias|alias\s+set|deploy\(/i);
});

test('Fase 1C: 20 escrituras concurrentes no pierden eventos ni hacen lectura previa', async () => {
  const mock = atomicLedgerMock({ insertDelayMs: 2 });
  const operationId = trace.operationIdFromReference('whatsapp', 'wamid.concurrent-001', SECRET);
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => save(mock, makeEvent(operationId, 'parallel_step', `event-${index}`, {
    message_refs: [trace.hashReference('message', 'wamid.concurrent-001', SECRET)],
    counts: { index }
  }))));
  assert.equal(mock.rows.size, 20);
  assert.equal(new Set(results.map(result => result.event_id)).size, 20);
  assert.equal(mock.metrics.insert_calls, 20);
  assert.equal(mock.metrics.lookup_calls, 0);
  const reconstructed = trace.reconstructOperation([...mock.rows.values()]);
  assert.equal(reconstructed.event_count, 20);
  assert.equal(reconstructed.failed_event_count, 0);
  assert.equal(reconstructed.global_status, 'open');
});

test('Fase 1C: 100 eventos permanecen completos, sin recorte silencioso', async () => {
  const mock = atomicLedgerMock();
  const operationId = trace.newOperationId('processing', SECRET);
  for (let index = 0; index < 100; index += 1) await save(mock, makeEvent(operationId, 'memory_checkpoint', `checkpoint-${index}`, { counts: { index } }));
  const reconstructed = trace.reconstructOperation([...mock.rows.values()]);
  assert.equal(mock.rows.size, 100);
  assert.equal(reconstructed.event_count, 100);
  assert.equal(trace.RETENTION_POLICY.automatic_deletion, false);
  assert.equal(trace.RETENTION_POLICY.minimum_days, 180);
});

test('Fase 1C: un reintento idéntico es idempotente y un conflicto no se confirma', async () => {
  const mock = atomicLedgerMock();
  const operationId = trace.newOperationId('query', SECRET);
  const original = makeEvent(operationId, 'yarbi_query', 'same-request');
  const first = await save(mock, original);
  const retry = await save(mock, original);
  assert.equal(first.inserted, true);
  assert.equal(retry.duplicate, true);
  assert.equal(mock.rows.size, 1);
  const conflicting = { ...original, outcome: 'failed', error_code: 'timeout' };
  await assert.rejects(() => save(mock, conflicting), /trace_event_conflict/);
  assert.equal(mock.rows.size, 1);
});

test('Fase 1C: 20 reintentos simultáneos del mismo evento conservan una sola evidencia', async () => {
  const mock = atomicLedgerMock({ insertDelayMs: 2 });
  const operationId = trace.newOperationId('processing', SECRET);
  const event = makeEvent(operationId, 'memory_updated', 'same-delivery');
  const results = await Promise.all(Array.from({ length: 20 }, () => save(mock, event)));
  assert.equal(mock.rows.size, 1);
  assert.equal(results.filter(result => result.inserted).length, 1);
  assert.equal(results.filter(result => result.duplicate).length, 19);
  assert.equal(mock.metrics.insert_calls, 20);
  assert.equal(mock.metrics.lookup_calls, 19);
});

test('Fase 1C: error de Supabase no se reporta como escritura confirmada', async () => {
  const mock = atomicLedgerMock({ failInsert: true });
  const operationId = trace.newOperationId('processing', SECRET);
  await assert.rejects(() => save(mock, makeEvent(operationId, 'processing_failed', 'storage-error')), /trace_insert_failed/);
  assert.equal(mock.rows.size, 0);
});

test('Fase 1C: sin clave HMAC no se genera una identidad supuestamente protegida', () => {
  assert.equal(trace.traceConfigError(''), 'trace_hmac_key_missing');
  assert.equal(trace.traceSecret(''), null);
  assert.throws(() => trace.operationIdFromReference('whatsapp', 'message', ''), /trace_hmac_key_missing/);
  assert.throws(() => trace.hashReference('message', 'message', undefined), /trace_hmac_key_missing/);
});

test('Fase 1C: una cabecera externa no puede apropiarse de una operación interna', () => {
  const external = 'op1-whatsapp-0123456789abcdef0123456789abcdef';
  const derived = trace.operationIdFromReference('query', external, SECRET);
  assert.notEqual(derived, external);
  const processApi = fs.readFileSync(path.join(root, 'api', 'ai', 'process.js'), 'utf8');
  const chatApi = fs.readFileSync(path.join(root, 'api', 'assistant', 'chat.js'), 'utf8');
  assert.doesNotMatch(processApi + chatApi, /x-yarbi-correlation-id|correlationFromRequest/i);
});

test('Fase 1C: fallo parcial permanece visible después de una etapa exitosa', async () => {
  const mock = atomicLedgerMock();
  const operationId = trace.newOperationId('processing', SECRET);
  await save(mock, makeEvent(operationId, 'analysis', 'failed', { outcome: 'failed', error_code: 'timeout' }));
  await save(mock, makeEvent(operationId, 'memory_updated', 'later-success'));
  const reconstructed = trace.reconstructOperation([...mock.rows.values()]);
  assert.equal(reconstructed.failed_event_count, 1);
  assert.equal(reconstructed.global_status, 'attention_required');
  assert.equal(reconstructed.events.some(event => event.error_code === 'timeout'), true);
});

test('Fase 1C: reconstruye WhatsApp, procesamiento y consulta como operaciones independientes relacionadas', async () => {
  const mock = atomicLedgerMock();
  const messageRef = trace.hashReference('message', 'wamid.journey-001', SECRET);
  const whatsappOperation = trace.operationIdFromReference('whatsapp', 'wamid.journey-001', SECRET);
  const processingOperation = trace.newOperationId('processing', SECRET);
  const queryOperation = trace.newOperationId('query', SECRET);
  await save(mock, makeEvent(whatsappOperation, 'whatsapp_stored', 'stored', { operation_type: 'whatsapp_receive', message_refs: [messageRef] }));
  await save(mock, makeEvent(processingOperation, 'memory_updated', 'run-1', { operation_type: 'message_processing', message_refs: [messageRef], causation_operation_ids: [whatsappOperation] }));
  await save(mock, makeEvent(queryOperation, 'yarbi_query', 'request-1', { operation_type: 'yarbi_query', message_refs: [messageRef] }));
  const journey = trace.reconstructJourney([...mock.rows.values()]);
  assert.equal(new Set(journey.operations.map(operation => operation.operation_id)).size, 3);
  assert.notEqual(whatsappOperation, processingOperation);
  assert.notEqual(processingOperation, queryOperation);
  assert.equal(journey.links.some(link => link.ref === messageRef && link.operation_ids.length === 3), true);
});

test('Fase 1C: la fila registrada no expone conversación, teléfono, clave ni texto de error', () => {
  const operationId = trace.newOperationId('query', SECRET);
  const record = trace.eventRecord(makeEvent(operationId, 'yarbi_query', 'privacy', {
    outcome: 'failed',
    error_code: trace.errorCode(new Error('Gemini timeout for hola 51999999999')),
    message_refs: [trace.hashReference('message', 'raw-message-with-conversation', SECRET)],
    contact_refs: [trace.hashReference('contact', '51999999999', SECRET)]
  }), SECRET);
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /hola|51999999999|raw-message-with-conversation|phase1c-test-secret|AIza|Bearer/i);
  assert.match(serialized, /timeout/);
});

test('el ledger conserva únicamente el diagnóstico Gemini allowlisted', () => {
  const operationId = trace.newOperationId('query', SECRET);
  const record = trace.eventRecord(makeEvent(operationId, 'understanding_unavailable', 'gemini-400', {
    provider_diagnostic: {
      provider: 'gemini', http_status: 400, provider_status: 'INVALID_ARGUMENT', category: 'SCHEMA_UNSUPPORTED',
      schema_sha256: 'a'.repeat(64), model: 'gemini-3.5-flash-lite',
      signals: { invalid_argument: true, mentions_schema: true, mentions_complexity: true },
      message: 'responseJsonSchema too complex secret=AIza-SENSITIVE', prompt: 'cliente privado'
    }
  }), SECRET);
  const diagnostic = record.result_payload.provider_diagnostic;
  assert.deepEqual(Object.keys(diagnostic).sort(), ['category', 'http_status', 'model', 'provider', 'provider_status', 'schema_sha256', 'signals']);
  assert.equal(diagnostic.category, 'SCHEMA_UNSUPPORTED');
  assert.equal(diagnostic.signals.invalid_argument, true);
  assert.equal(diagnostic.signals.mentions_schema, true);
  assert.equal(diagnostic.signals.mentions_complexity, true);
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /AIza-SENSITIVE|cliente privado|responseJsonSchema too complex/);
});

test('el ledger rechaza categorías, modelos y hashes no permitidos', () => {
  const diagnostic = trace.safeProviderDiagnostic({
    provider: 'gemini<script>', http_status: 999, provider_status: 'INVALID ARGUMENT<script>', category: 'RAW_PROVIDER_MESSAGE',
    schema_sha256: 'not-a-hash', model: 'gemini 3.5; secret', signals: { invalid_argument: true }
  });
  assert.equal(diagnostic, null);
});

test('Fase 1C: las rutas usan una escritura por evento, no agregan Gemini ni contratos públicos', () => {
  const webhook = fs.readFileSync(path.join(root, 'api', 'webhook.js'), 'utf8');
  const processApi = fs.readFileSync(path.join(root, 'api', 'ai', 'process.js'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'api', 'assistant', 'chat.js'), 'utf8');
  for (const source of [webhook, processApi, chat]) assert.match(source, /traceSecret\(TRACE_HMAC_KEY\)/);
  const traceSource = fs.readFileSync(path.join(root, 'lib', 'yarbi-trace.js'), 'utf8');
  assert.doesNotMatch(traceSource, /generativelanguage\.googleapis\.com/i);
  assert.match(traceSource, /resolution=ignore-duplicates/);
  assert.doesNotMatch(traceSource, /history\.slice\(-24\)/);
});
