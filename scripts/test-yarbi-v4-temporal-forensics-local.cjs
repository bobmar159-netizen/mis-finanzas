'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { fixtureById } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures');
const { runLocalPipeline } = require('../PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-semantic-validation');
const { safeBody, semanticSummary } = require('./run-gemini-v4-post-corrections-pending.cjs');

function mention(kind, value, attributes) {
  return { kind, value, polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance', ...(attributes ? { attributes } : {}) };
}

function proposal(mentions) {
  return {
    schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact',
    mentions, control: { correction: 'none', continuation: 'none', cancel_scope: 'none' }, confidence: 0.9, ambiguity: false, missing_information: []
  };
}

const cases = [];
async function test(name, fn) { try { await fn(); cases.push({ name, status: 'PASS' }); } catch (error) { cases.push({ name, status: 'FAIL', error: error.message }); } }

async function main() {
await test('F3PC-05 admite ayer + tarde cuando la estructura temporal es válida', () => {
  const value = runLocalPipeline(proposal([mention('temporal_reference', 'ayer', { days: 1, day_part: 'afternoon' }), mention('proper_name', 'ENTIDAD_E')]), fixtureById('F3PC-05'));
  assert.equal(value.ok, true);
  assert.equal(value.semantic.assertions.must_positive, true);
});

await test('F3PC-06 admite hoy + noche cuando la estructura temporal es válida', () => {
  const value = runLocalPipeline(proposal([mention('temporal_reference', 'hoy', { days: 0, day_part: 'night' }), mention('proper_name', 'ENTIDAD_F')]), fixtureById('F3PC-06'));
  assert.equal(value.ok, true);
  assert.equal(value.semantic.assertions.must_positive, true);
});

await test('el atributo temporal contradictorio se abstiene sin crear restricción positiva', () => {
  const value = runLocalPipeline(proposal([mention('temporal_reference', 'ayer', { days: 0, day_part: 'afternoon' }), mention('proper_name', 'ENTIDAD_E')]), fixtureById('F3PC-05'));
  assert.equal(value.ok, false);
  assert.equal(value.semantic.safe_outcome, 'abstained');
  assert.equal(value.semantic.assertions.no_forbidden_positive, true);
  assert.equal(value.semantic.assertions.may_auto_select_false, true);
});

await test('una referencia temporal no verificable se abstiene sin degradar las protecciones', () => {
  const value = runLocalPipeline(proposal([mention('temporal_reference', 'tonight', { days: 0, day_part: 'night' }), mention('proper_name', 'ENTIDAD_F')]), fixtureById('F3PC-06'));
  assert.equal(value.ok, false);
  assert.equal(value.semantic.safe_outcome, 'abstained');
  assert.equal(value.semantic.assertions.negated_never_positive_constraint, true);
  assert.equal(value.semantic.assertions.commercial_actions_not_executed, true);
});

await test('la evidencia histórica no conserva la respuesta cruda de Gemini', async () => {
  const root = path.join(__dirname, '..');
  const evidence = JSON.parse(await readFile(path.join(root, 'scripts', 'gemini-v4-post-corrections-pending-evidence.json'), 'utf8'));
  for (const id of ['F3PC-05', 'F3PC-06']) {
    const row = evidence.results.find(item => item.fixture_id === id);
    assert.ok(row);
    assert.equal(Object.hasOwn(row, 'raw_provider_response'), false);
    assert.equal(row.pipeline?.assertions?.must_positive, false);
  }
});

await test('el agregador conserva semantic_pass del formato histórico sanitizado', () => {
  const historic = safeBody({ pipeline: { semantic_pass: true, critical_security_failure: false, assertions: { must_positive: true }, timings_ms: {} } });
  const current = safeBody({ pipeline: { semantic: { pass: true, critical_security_failure: false, assertions: { must_positive: true } }, timings_ms: {} } });
  assert.equal(historic.pipeline.semantic_pass, true);
  assert.equal(current.pipeline.semantic_pass, true);
});

await test('el agregador separa un 503 del proveedor de los fallos semánticos', () => {
  const summary = semanticSummary([
    { fixture_id: 'F3PC-05', provider_http_status: 200, pipeline: { semantic_pass: false } },
    { fixture_id: 'F3PC-07', provider_http_status: 503, pipeline: { semantic_pass: false } }
  ], ['F3PC-05', 'F3PC-07']);
  assert.equal(summary.semantic_fail, 1);
  assert.equal(summary.blocked_provider, 1);
  assert.equal(summary.evaluated_semantic, 1);
  assert.equal(summary.unambiguous_evaluated_semantic, 1);
});

  const failed = cases.filter(item => item.status === 'FAIL');
  process.stdout.write(JSON.stringify({ phase: 'yarbi_v4_temporal_forensics_local', result: failed.length ? 'FAIL' : 'PASS', passed: cases.length - failed.length, total: cases.length, failures: failed, network_calls: 0, commercial_actions: 0 }, null, 2) + '\n');
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(error => { process.stderr.write(String(error?.message || error)); process.exitCode = 1; });
