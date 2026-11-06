'use strict';

const assert = require('node:assert/strict');
const { fixtureById } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures');
const { runLocalPipeline } = require('../PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-semantic-validation');
const { createTemporalDiagnostic, providerUnavailableTemporalDiagnostic, sanitizeTemporalDiagnostic } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-temporal-diagnostics');
const { eventIdFor, eventRecord, operationIdFromReference } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-trace');

const STAGES = ['provider_input', 'v4_normalize', 'v4_hardener', 'v4_v1_adapter', 'v1_normalize', 'v3_hardener', 'semantic_evaluation'];
const cases = [];
function test(name, fn) { try { fn(); cases.push({ name, status: 'PASS' }); } catch (error) { cases.push({ name, status: 'FAIL', error: error.message }); } }
function mention(value, attributes = {}) { return { kind: 'temporal_reference', value, polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance', attributes }; }
function proposal(mentions) { return { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact', mentions, control: { correction: 'none', continuation: 'none', cancel_scope: 'none' }, confidence: 0.9, ambiguity: false, missing_information: [] }; }
function properMention(value) { return { kind: 'proper_name', value, polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance' }; }
function stages(value) { return value?.temporal_diagnostic?.stages || []; }
function assertCompleteDiagnostic(value) { assert.deepEqual(stages(value).map(item => item.stage), STAGES); assert.equal(JSON.stringify(value.temporal_diagnostic).includes('ENTIDAD'), false); }

test('observa ayer por la tarde a través de todo el pipeline', () => {
  const value = runLocalPipeline(proposal([mention('ayer', { days: 1, day_part: 'afternoon' }), properMention('ENTIDAD_E')]), fixtureById('F3PC-05'));
  assert.equal(value.ok, true); assertCompleteDiagnostic(value);
  assert.equal(stages(value)[1].temporal_mentions[0].reference_category, 'yesterday');
  assert.equal(stages(value)[1].temporal_mentions[0].day_part, 'afternoon');
  assert.equal(stages(value)[6].decision, 'accepted');
});

test('observa hoy por la noche a través de todo el pipeline', () => {
  const value = runLocalPipeline(proposal([mention('hoy', { days: 0, day_part: 'night' }), properMention('ENTIDAD_F')]), fixtureById('F3PC-06'));
  assert.equal(value.ok, true); assertCompleteDiagnostic(value);
  assert.equal(stages(value)[1].temporal_mentions[0].reference_category, 'today');
  assert.equal(stages(value)[1].temporal_mentions[0].day_part, 'night');
});

test('observa mañana por la mañana sin convertirlo en dato personal', () => {
  const value = runLocalPipeline(proposal([mention('mañana', { days: 1, day_part: 'morning' })]), fixtureById('F3PC-07'));
  assertCompleteDiagnostic(value);
  assert.equal(stages(value)[1].temporal_mentions[0].reference_category, 'tomorrow');
  assert.equal(JSON.stringify(value.temporal_diagnostic).includes('mañana'), false);
});

test('clasifica atributo temporal contradictorio y no ejecuta etapas posteriores', () => {
  const value = runLocalPipeline(proposal([mention('ayer', { days: 0, day_part: 'afternoon' })]), fixtureById('F3PC-05'));
  assert.equal(value.ok, false); assertCompleteDiagnostic(value);
  assert.equal(stages(value)[2].reason, 'TEMPORAL_ATTRIBUTE_INCONSISTENT');
  assert.equal(stages(value)[3].decision, 'rejected');
  assert.equal(stages(value)[4].reason, 'TEMPORAL_DOWNSTREAM_NOT_REACHED');
});

test('clasifica rechazo estructural de V4 sin inventar una causa concreta', () => {
  const raw = proposal([mention('hoy', { days: 0, day_part: 'night' })]); raw.unexpected_property = true;
  const value = runLocalPipeline(raw, fixtureById('F3PC-06'));
  assert.equal(value.ok, false); assertCompleteDiagnostic(value);
  assert.equal(stages(value)[1].reason, 'TEMPORAL_NORMALIZATION_REJECTED');
  assert.equal(stages(value)[2].reason, 'TEMPORAL_DOWNSTREAM_NOT_REACHED');
});

test('marca indisponibilidad del proveedor y no declara etapas ejecutadas', () => {
  const value = providerUnavailableTemporalDiagnostic();
  assert.deepEqual(value.stages.map(item => item.stage), STAGES);
  assert.equal(value.stages[0].reason, 'PROVIDER_UNAVAILABLE');
  assert.equal(value.stages.every(item => item.executed === false), true);
});

test('el sanitizador descarta contenido arbitrario y conserva solamente categorías', () => {
  const source = createTemporalDiagnostic(proposal([mention('ayer', { days: 1, day_part: 'afternoon' })]));
  const diagnostic = source.finish();
  diagnostic.stages[0].temporal_mentions[0].raw_text = 'SECRETO_PERSONAL_DE_PRUEBA';
  diagnostic.stages[0].temporal_mentions[0].jwt = 'header.payload.signature';
  const sanitized = sanitizeTemporalDiagnostic(diagnostic);
  const text = JSON.stringify(sanitized);
  assert.equal(text.includes('SECRETO_PERSONAL_DE_PRUEBA'), false);
  assert.equal(text.includes('header.payload.signature'), false);
  assert.equal(text.includes('ayer'), false);
  assert.equal(sanitized.stages[0].temporal_mentions[0].reference_category, 'yesterday');
});

test('el ledger conserva solo el diagnóstico sanitizado', () => {
  const secret = 'x'.repeat(48); const operationId = operationIdFromReference('test_temporal_diagnostic', 'fixture_synthetic', secret);
  const eventId = eventIdFor(operationId, 'temporal_stage', 'synthetic', secret);
  const diagnostic = providerUnavailableTemporalDiagnostic();
  diagnostic.stages[0].provider_message = 'NO_DEBE_PERSISTIR';
  const record = eventRecord({ operation_id: operationId, event_id: eventId, operation_type: 'test_temporal_diagnostic', stage: 'temporal_stage', outcome: 'completed', temporal_diagnostic: diagnostic }, secret);
  const text = JSON.stringify(record);
  assert.equal(text.includes('NO_DEBE_PERSISTIR'), false);
  assert.equal(record.result_payload.temporal_diagnostic.stages[0].reason, 'PROVIDER_UNAVAILABLE');
});

const failed = cases.filter(item => item.status === 'FAIL');
process.stdout.write(JSON.stringify({ phase: 'yarbi_v4_temporal_instrumentation_local', result: failed.length ? 'FAIL' : 'PASS', passed: cases.length - failed.length, total: cases.length, failures: failed, network_calls: 0, gemini_calls: 0, commercial_actions: 0 }, null, 2) + '\n');
process.exitCode = failed.length ? 1 : 0;
