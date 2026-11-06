'use strict';

const assert = require('node:assert/strict');
const { CASES, validateFixtures } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures');
const { strictNormalizeProposed, hardenProposed } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal');
const { runLocalPipeline } = require('../PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-semantic-validation');

function mention(kind, value, polarity = 'affirmed', claimed_source = 'utterance', attributes) {
  return { kind, value, polarity, certainty: 'confirmed', claimed_source, ...(attributes ? { attributes } : {}) };
}
function raw({ mentions, correction = 'none', continuation = 'none', act = 'request', target = 'contact', ambiguity = false }) {
  return { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: act, target_type: target, mentions, control: { correction, continuation, cancel_scope: 'none' }, confidence: .9, ambiguity, missing_information: [] };
}
function responseFor(id) {
  switch (id) {
    case 'F3PC-01': return raw({ act: 'correction', correction: 'replace_previous', mentions: [mention('proper_name','ENTIDAD_A','negated'), mention('proper_name','ENTIDAD_B'), mention('service_reference','SERVICIO_A'), mention('temporal_reference','ayer','affirmed','utterance',{ days: 1 })] });
    case 'F3PC-02': return raw({ act: 'correction', correction: 'replace_previous', mentions: [mention('location_reference','ZONA_A','negated'), mention('location_reference','ZONA_B'), mention('service_reference','SERVICIO_B')] });
    case 'F3PC-03': return raw({ act: 'correction', correction: 'replace_previous', mentions: [mention('service_reference','SERVICIO_C','negated'), mention('service_reference','SERVICIO_D'), mention('proper_name','ENTIDAD_C')] });
    case 'F3PC-04': return raw({ act: 'correction', correction: 'replace_previous', mentions: [mention('temporal_reference','ayer','negated','utterance',{ days: 1 }), mention('temporal_reference','hoy','affirmed','utterance',{ days: 0, day_part: 'afternoon' }), mention('proper_name','ENTIDAD_D')] });
    case 'F3PC-05': return raw({ mentions: [mention('temporal_reference','ayer','affirmed','utterance',{ days: 1, day_part: 'afternoon' }), mention('proper_name','ENTIDAD_E')] });
    case 'F3PC-06': return raw({ mentions: [mention('temporal_reference','hoy','affirmed','utterance',{ days: 0, day_part: 'night' }), mention('proper_name','ENTIDAD_F')] });
    case 'F3PC-07': return raw({ act: 'clarification', ambiguity: true, mentions: [mention('proper_name','ENTIDAD_G'), mention('temporal_reference','mañana')] });
    case 'F3PC-08': return raw({ act: 'continuation', continuation: 'active_entity', mentions: [mention('proper_name','ENTIDAD_H','affirmed','conversation_state')] });
    case 'F3PC-09': return raw({ act: 'continuation', continuation: 'active_entity', mentions: [mention('service_reference','SERVICIO_E','affirmed','conversation_state')] });
    case 'F3PC-10': return raw({ act: 'continuation', continuation: 'active_entity', mentions: [mention('proper_name','ENTIDAD_I'), mention('service_reference','SERVICIO_F')] });
    case 'F3PC-11': return raw({ act: 'correction', correction: 'replace_previous', mentions: [mention('proper_name','ENTIDAD_J','negated'), mention('proper_name','ENTIDAD_K'), mention('service_reference','SERVICIO_G')] });
    case 'F3PC-12': return raw({ act: 'correction', correction: 'replace_previous', mentions: [mention('service_reference','SERVICIO_H','negated'), mention('proper_name','ENTIDAD_L'), mention('service_reference','SERVICIO_I')] });
    case 'F3PC-13': return raw({ mentions: [mention('proper_name','ENTIDAD_M'), mention('service_reference','SERVICIO_J')] });
    case 'F3PC-14': return raw({ mentions: [mention('proper_name','ENTIDAD_N'), mention('service_reference','SERVICIO_K')] });
    case 'F3PC-15': return raw({ act: 'clarification', ambiguity: true, mentions: [mention('proper_name','ENTIDAD_O'), mention('proper_name','ENTIDAD_P'), mention('service_reference','SERVICIO_L')] });
    case 'F3PC-16': return raw({ act: 'clarification', ambiguity: true, mentions: [mention('location_reference','ZONA_C'), mention('location_reference','ZONA_D')] });
    default: throw new Error('fixture_response_missing');
  }
}

const results = [];
function test(name, fn) { try { fn(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); } }

test('los 16 fixtures post-corrección tienen distribución y contexto exactos', () => {
  const value = validateFixtures(); assert.equal(value.valid, true); assert.equal(value.count, 16); assert.equal(value.reference_time, '2026-11-04T12:00:00-05:00'); assert.equal(value.time_zone, 'America/Lima');
});
for (const fixture of CASES) {
  test(`${fixture.id} completa V4→V1→V3 o abstiene con seguridad`, () => {
    const input = responseFor(fixture.id); const strict = strictNormalizeProposed(input); assert.equal(strict.ok, true);
    const hardened = hardenProposed({ understanding: strict.value, utterance: fixture.utterance, state: fixture.state }); assert.equal(hardened.ok, true);
    const outcome = runLocalPipeline(input, fixture); assert.equal(outcome.ok, true);
    assert.equal(outcome.semantic.assertions.negated_never_positive_constraint, true);
    assert.equal(outcome.semantic.assertions.may_auto_select_false, true);
    assert.equal(outcome.semantic.assertions.commercial_actions_not_executed, true);
    if (fixture.expect.continuation) assert.equal(hardened.value.control.continuation, fixture.expect.continuation);
  });
}
const failed = results.filter(item => item.status === 'FAIL');
process.stdout.write(JSON.stringify({ phase: 'yarbi_v4_post_corrections_local', result: failed.length ? 'FAIL' : 'PASS', passed: results.length - failed.length, total: results.length, failures: failed, network_calls: 0, commercial_actions: 0 }, null, 2) + '\n');
process.exitCode = failed.length ? 1 : 0;
