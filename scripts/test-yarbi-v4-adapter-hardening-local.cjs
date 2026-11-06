'use strict';

const assert = require('node:assert/strict');
const { hardenProposed } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal');
const { adaptV4ToV1 } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-v1-adapter-proposal');
const cases = [];
function test(name, fn) { try { fn(); cases.push({ name, status: 'PASS' }); } catch (error) { cases.push({ name, status: 'FAIL', error: error.message }); } }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function mention(kind, value, polarity = 'affirmed', certainty = 'confirmed', extra = {}) { return { kind, value, polarity, certainty, claimed_source: 'utterance', ...extra }; }
function base(overrides = {}) { return { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact', mentions: [mention('proper_name', 'Carla')], control: { correction: 'none', continuation: 'none', cancel_scope: 'none' }, confidence: 0.8, ambiguity: false, missing_information: [], ...overrides }; }
function hardened(input, utterance = 'Busca a Carla', state = {}) { const result = hardenProposed({ understanding: input, utterance, state }); assert.equal(result.ok, true, result.code); return result.value; }
function valid() { const value = hardened(base()); const result = adaptV4ToV1(value); assert.equal(result.ok, true, result.code); return value; }
function rejected(mutator, expected) { const value = valid(); mutator(value); const result = adaptV4ToV1(value); assert.equal(result.ok, false); if (expected) assert.equal(result.code, expected); }

test('afirmaciones erróneas bajo negación explícita nunca generan nombre positivo', () => {
  for (const utterance of ['No fue Carlos', 'No es Carlos', 'Carlos no es el cliente', 'No quiero a Carlos', 'Nunca fue Carlos', 'No era Carlos, era Carla', 'Carlos no, Carla sí']) {
    const value = hardened(base({ mentions: [mention('proper_name', 'Carlos')] }), utterance);
    assert.deepEqual(value.plan.query_constraints, {}, utterance); assert.equal(adaptV4ToV1(value).ok, false, utterance);
  }
});
test('tres negaciones de cancelación no permiten acción', () => {
  for (const utterance of ['No quiero cancelar la cita', 'No se debe cancelar la cita', 'No quiero que canceles la cita']) {
    const value = hardened(base({ intent: 'cancel', conversational_act: 'cancellation', target_type: 'agenda', mentions: [], control: { correction: 'none', continuation: 'none', cancel_scope: 'agenda' } }), utterance);
    assert.equal(value.conversational_act, 'clarification', utterance); assert.equal(value.control.cancel_scope, 'none', utterance); assert.equal(adaptV4ToV1(value).ok, false, utterance);
  }
});
test('certainty inválida es rechazada sin degradar a inferred', () => { rejected(value => { value.mentions[0].certainty = 'contradiction'; }, 'v4_mentions_invalid'); });
test('days 365 es rechazado aunque el payload intente respaldarlo', () => {
  const value = hardened(base({ target_type: 'agenda', mentions: [mention('temporal_reference', 'hoy', 'affirmed', 'confirmed', { attributes: { days: 0 } })] }), 'Hoy');
  assert.equal(adaptV4ToV1(value).ok, true);
  value.mentions[0].days = 365; value.mentions[0].verified_attributes = { days: 365 }; value.plan.query_constraints.recency.days = 365;
  const result = adaptV4ToV1(value); assert.equal(result.ok, false); assert.equal(result.code, 'v4_mentions_invalid');
});
test('present true se rechaza como restricción', () => { rejected(value => { value.mentions[0].present = true; }, 'v4_mentions_invalid'); });
test('propiedad adicional se rechaza', () => { rejected(value => { value.extra = true; }, 'v4_hardened_contract_invalid'); });
test('contradictions ausente se rechaza', () => { rejected(value => { delete value.contradictions; }, 'v4_hardened_contract_invalid'); });
test('may_auto_select ausente se rechaza', () => { rejected(value => { delete value.plan.may_auto_select; }, 'v4_plan_invalid'); });
test('may_auto_select distinto de false se rechaza', () => { rejected(value => { value.plan.may_auto_select = true; }, 'v4_plan_invalid'); });
test('requires_clarification distinto de false se rechaza', () => { rejected(value => { value.plan.requires_clarification = true; }, 'v4_plan_invalid'); });
test('restricción sin mención positiva correspondiente se rechaza', () => { rejected(value => { value.plan.query_constraints.name.value = 'Carlos'; }, 'v4_constraint_not_backed_by_verified_affirmation'); });
test('confidence inválida no se transforma a cero', () => { rejected(value => { value.confidence = null; }, 'v4_semantic_fields_invalid'); });
test('contradicción con forma manipulada se rechaza', () => { rejected(value => { value.contradictions.push({ dimension: 'name', previous_value: 'Carlos', current_value: 'Carla', status: 'unresolved' }); }, 'v4_contradictions_invalid'); });
test('una mención negada no cruza al payload v1', () => {
  const value = hardened(base({ conversational_act: 'correction', mentions: [mention('proper_name', 'Carlos', 'negated'), mention('proper_name', 'Carla')], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' } }), 'No era Carlos, era Carla', { active_constraints: { name: { value: 'Carlos' } } });
  assert.equal(value.plan.query_constraints.name.value, 'Carla'); const result = adaptV4ToV1(value); assert.equal(result.ok, true); assert.equal(result.value.entity_mentions.some(item => item.value === 'Carlos'), false); assert.equal(result.value.constraints.name.value, 'Carla');
});

const failed = cases.filter(item => item.status === 'FAIL');
process.stdout.write(JSON.stringify({ phase: 'v4_adapter_final_hardening_local', result: failed.length ? 'FAIL' : 'PASS', total: cases.length, passed: cases.length - failed.length, failures: failed, network_calls: 0, commercial_actions: 0 }, null, 2) + '\n');
process.exitCode = failed.length ? 1 : 0;
