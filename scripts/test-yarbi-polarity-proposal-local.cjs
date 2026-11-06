'use strict';

// Suite aislada: no importa handlers, SDKs ni clientes de red.
const assert = require('node:assert/strict');
const { strictNormalizeProposed, hardenProposed, upgradeLegacyV1, proposedJsonSchema } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal');
const results = [];
function test(name, fn) { try { fn(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); } }
function mention(kind, value, polarity = 'affirmed', certainty = 'confirmed', extra = {}) { return { kind, value, polarity, certainty, claimed_source: 'utterance', ...extra }; }
function base(overrides = {}) { return { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact', mentions: [], control: { correction: 'none', continuation: 'none', cancel_scope: 'none' }, confidence: 0.8, ambiguity: false, missing_information: [], ...overrides }; }
function run(input, utterance, state = {}) { const output = hardenProposed({ understanding: input, utterance, state }); assert.equal(output.ok, true, output.code); return output.value; }

test('1 No era Carlos, era Carla', () => {
  const v = run(base({ conversational_act: 'correction', mentions: [mention('proper_name', 'Carlos', 'negated'), mention('proper_name', 'Carla')], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' } }), 'No era Carlos, era Carla', { active_constraints: { name: { value: 'Carlos' } } });
  assert.equal(v.plan.query_constraints.name.value, 'Carla'); assert.equal(v.discarded_mentions[0].value, 'Carlos'); assert.equal(v.contradictions[0].status, 'resolved_by_correction');
});
test('2 No era reparación, era instalación', () => {
  const v = run(base({ target_type: 'service', conversational_act: 'correction', mentions: [mention('service_reference', 'reparación', 'negated'), mention('service_reference', 'instalación')], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' } }), 'No era reparación, era instalación', { active_constraints: { service: { value: 'reparación' } } });
  assert.equal(v.plan.query_constraints.service.value, 'instalación'); assert.equal(v.discarded_mentions[0].polarity, 'negated');
});
test('3 No canceles la cita', () => {
  const v = run(base({ intent: 'cancel', conversational_act: 'cancellation', target_type: 'agenda', control: { correction: 'none', continuation: 'none', cancel_scope: 'agenda' } }), 'No canceles la cita');
  assert.equal(v.conversational_act, 'clarification'); assert.equal(v.control.cancel_scope, 'none'); assert.equal(v.plan.may_auto_select, false); assert.ok(v.plan.blocked_reasons.includes('negated_cancellation'));
});
test('4 No era ayer, fue hoy', () => {
  const v = run(base({ conversational_act: 'correction', mentions: [mention('temporal_reference', 'ayer', 'negated'), mention('temporal_reference', 'hoy', 'affirmed', 'confirmed', { attributes: { days: 0 } })], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' } }), 'No era ayer, fue hoy', { active_constraints: { recency: { value: 'ayer' } } });
  assert.equal(v.plan.query_constraints.recency.value, 'hoy'); assert.equal(v.plan.query_constraints.recency.days, 0);
});
test('5 Carlos no era el cliente', () => {
  const v = run(base({ conversational_act: 'correction', mentions: [mention('proper_name', 'Carlos', 'negated')], control: { correction: 'discard_active_entity', continuation: 'none', cancel_scope: 'none' } }), 'Carlos no era el cliente', { active_constraints: { name: { value: 'Carlos' } } });
  assert.deepEqual(v.plan.query_constraints, {}); assert.equal(v.plan.requires_clarification, true);
});
test('6 No estoy seguro si era Carlos', () => {
  const v = run(base({ ambiguity: true, mentions: [mention('proper_name', 'Carlos', 'affirmed', 'inferred')] }), 'No estoy seguro si era Carlos');
  assert.equal(v.plan.requires_clarification, true); assert.deepEqual(v.plan.query_constraints, {});
});
test('7 Me refería al otro cliente', () => {
  const v = run(base({ conversational_act: 'correction', mentions: [mention('generic_reference', 'el otro cliente')], control: { correction: 'select_alternative', continuation: 'active_entity', cancel_scope: 'none' } }), 'Me refería al otro cliente', { active_constraints: { name: { value: 'Andrea' } } });
  assert.equal(v.control.correction, 'select_alternative'); assert.equal(v.plan.may_auto_select, false);
});
test('8 Contradicción con estado sin corrección explícita', () => {
  const v = run(base({ target_type: 'service', mentions: [mention('service_reference', 'instalación')] }), 'Necesito instalación', { active_constraints: { service: { value: 'reparación' } } });
  assert.equal(v.contradictions[0].status, 'unresolved'); assert.equal(v.plan.requires_clarification, true); assert.deepEqual(v.plan.query_constraints, {});
});
test('9 Negación de alcance ambiguo', () => {
  const v = run(base({ ambiguity: true, mentions: [mention('generic_reference', 'eso', 'negated')], control: { correction: 'none', continuation: 'active_entity', cancel_scope: 'unknown' } }), 'No, eso no', { active_constraints: { name: { value: 'Andrea' } } });
  assert.equal(v.plan.requires_clarification, true); assert.deepEqual(v.plan.query_constraints, {});
});
test('10 Continuación de entidad activa', () => {
  const v = run(base({ intent: 'continue_task', conversational_act: 'continuation', mentions: [mention('anaphoric_reference', 'ese mismo')], control: { correction: 'none', continuation: 'active_entity', cancel_scope: 'none' } }), 'Agenda a ese mismo');
  assert.equal(v.control.continuation, 'active_entity'); assert.equal(v.plan.may_auto_select, false);
});
test('11 Payload antiguo sin polarity seguro', () => {
  const legacy = { schema: 'yarbi.owner-understanding.v1', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact', entity_mentions: [ { kind: 'proper_name', value: 'Carla', source: 'utterance', certainty: 'confirmed' } ], confidence: 0.7, ambiguity: false, missing_information: [] };
  const upgraded = upgradeLegacyV1(legacy, 'Busca a Carla'); assert.equal(upgraded.ok, true); assert.equal(upgraded.value.mentions[0].polarity, 'affirmed');
});
test('12 Payload antiguo no infiere afirmación ante negación', () => {
  const legacy = { schema: 'yarbi.owner-understanding.v1', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact', entity_mentions: [], confidence: 0.7, ambiguity: false, missing_information: [] };
  const upgraded = upgradeLegacyV1(legacy, 'No era Carlos'); assert.equal(upgraded.ok, false); assert.equal(upgraded.code, 'legacy_polarity_ambiguous');
});
test('13 Mención malformada', () => { assert.equal(strictNormalizeProposed(base({ mentions: [{ kind: 'proper_name', value: 'Carla', polarity: 'affirmed', certainty: 'confirmed' }] })).code, 'proposed_mention_invalid'); });
test('14 Confianza null', () => { assert.equal(strictNormalizeProposed(base({ confidence: null })).code, 'proposed_contract_invalid'); });
test('15 Confianza booleana', () => { assert.equal(strictNormalizeProposed(base({ confidence: true })).code, 'proposed_contract_invalid'); });
test('16 Nombre con tipo incorrecto', () => { assert.equal(strictNormalizeProposed(base({ mentions: [mention('proper_name', { value: 'Carla' })] })).code, 'proposed_mention_invalid'); });
test('17 Referencia excesivamente larga', () => { assert.equal(strictNormalizeProposed(base({ mentions: [mention('proper_name', 'C'.repeat(121))] })).code, 'proposed_mention_invalid'); });
test('18 Propiedad adicional y source no verificada', () => {
  const invalid = base({ extra: 'no' }); assert.equal(strictNormalizeProposed(invalid).code, 'proposed_contract_shape_invalid');
  const v = run(base({ mentions: [mention('proper_name', 'Carla', 'affirmed', 'confirmed', { claimed_source: 'conversation_state' })] }), 'Busca a Andrea'); assert.deepEqual(v.plan.query_constraints, {}); assert.equal(v.mentions[0].provenance.verified, false);
});

const failed = results.filter(item => item.status === 'FAIL');
process.stdout.write(JSON.stringify({ phase: 'polarity_contradiction_proposal_local', result: failed.length ? 'FAIL' : 'PASS', total: results.length, passed: results.length - failed.length, failures: failed, network_calls: 0, commercial_actions: 0 }, null, 2) + '\n');
process.exitCode = failed.length ? 1 : 0;
