const {
  eventIdFor,
  hashReference,
  operationIdFromReference,
  reconstructOperation
} = require('./yarbi-trace');

function syntheticEvents(secret, runId = 'phase1d-synthetic-run') {
  const operationId = operationIdFromReference('audit', `synthetic:${runId}`, secret);
  const messageRef = hashReference('message', `audit-synthetic:${runId}`, secret);
  const startedAt = new Date().toISOString();
  const events = Array.from({ length: 20 }, (_, index) => ({
    operation_id: operationId,
    event_id: eventIdFor(operationId, 'synthetic_checkpoint', `checkpoint:${index}`, secret),
    operation_type: 'audit_synthetic_trace',
    stage: 'synthetic_checkpoint',
    outcome: 'completed',
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    component: 'preview_audit',
    component_version: 'phase1d-local',
    message_refs: [messageRef],
    counts: { synthetic_event_index: index + 1 }
  }));
  return { operationId, events };
}

async function executeSyntheticTrace({ secret, record, runId, now = () => performance.now() }) {
  if (typeof record !== 'function') throw new Error('audit_record_function_required');
  const { operationId, events } = syntheticEvents(secret, runId);
  const started = now();
  const results = await Promise.all(events.map(event => record(event)));
  const duplicate = await record(events[0]);
  const durationMs = Math.max(0, now() - started);
  const reconstruction = reconstructOperation(events);
  return {
    operation_id: operationId,
    requested_event_count: events.length,
    completed_event_count: results.filter(result => result?.ok).length,
    duplicate,
    duration_ms: durationMs,
    reconstruction,
    events
  };
}

module.exports = { executeSyntheticTrace, syntheticEvents };
