'use strict';

// Prueba local del adaptador de propuesta. No invoca proveedores ni red.
const assert = require('node:assert/strict');
const { compactToProviderV1, compactUnderstandingJsonSchema } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-compact-understanding-adapter');
const { normalizeUnderstanding } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-owner-understanding');
const { hardenUnderstanding } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-semantic-hardening');
const { ownerUnderstandingJsonSchema } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-owner-understanding');

const cases = [];
function test(name, fn) { try { fn(); cases.push({ name, status: 'PASS' }); } catch (error) { cases.push({ name, status: 'FAIL', error: error.message }); } }
function base(overrides = {}) {
  return {
    schema: 'yarbi.owner-understanding.compact.v1', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact',
    mentions: [], control: { correction: 'none', continuation: 'none', cancel_scope: 'none' }, confidence: 0.8, ambiguity: false, missing_information: [], ...overrides
  };
}
function adaptAndHarden(value, utterance, state = {}) {
  const adapted = compactToProviderV1(value); assert.equal(adapted.ok, true, adapted.code);
  const normalized = normalizeUnderstanding(adapted.value); assert.equal(normalized.ok, true, normalized.code);
  return { adapted, normalized, hardened: hardenUnderstanding({ understanding: normalized.value, utterance, state }) };
}

test('F3C-COMPACT-NAME: proper_name explícito conserva referencia', () => {
  const { adapted, hardened } = adaptAndHarden(base({ mentions: [{ kind: 'proper_name', value: 'Andrea', source: 'utterance', certainty: 'confirmed', polarity: 'affirmed' }] }), 'Busca a Andrea que escribió hoy');
  assert.equal(adapted.value.target_reference.name, 'Andrea'); assert.equal(hardened.target_reference.name, 'Andrea');
});
test('F3C-COMPACT-SERVICE: servicio no se convierte en nombre', () => {
  const { hardened } = adaptAndHarden(base({ target_type: 'service', mentions: [{ kind: 'service_reference', value: 'reparación', source: 'utterance', certainty: 'confirmed', polarity: 'affirmed' }] }), 'Necesito una reparación');
  assert.equal(hardened.target_reference.name, undefined); assert.equal(hardened.constraints.service.value, 'reparacion');
});
test('F3C-COMPACT-LOCATION: ubicación se conserva como pista', () => {
  const { hardened } = adaptAndHarden(base({ mentions: [{ kind: 'location_reference', value: 'Comas', source: 'utterance', certainty: 'confirmed', polarity: 'affirmed' }] }), 'El cliente de Comas');
  assert.equal(hardened.constraints.location.value, 'Comas');
});
test('F3C-COMPACT-TEMPORAL: franja temporal conservada', () => {
  const { hardened } = adaptAndHarden(base({ mentions: [{ kind: 'temporal_reference', value: 'por la tarde', source: 'utterance', certainty: 'confirmed', polarity: 'affirmed', attributes: { day_part: 'afternoon' } }] }), 'El que escribió por la tarde');
  assert.equal(hardened.temporal_clues[0].day_part, 'afternoon');
});
test('F3C-COMPACT-CORRECTION: corrección queda explícita', () => {
  const { adapted } = adaptAndHarden(base({ conversational_act: 'correction', control: { correction: 'replace_previous', continuation: 'active_entity', cancel_scope: 'none' } }), 'No, me refiero al otro cliente');
  assert.equal(adapted.value.correction.replace_previous, true); assert.equal(adapted.value.continuation.use_active_entity, true);
});
test('F3C-COMPACT-CANCEL: cancelación ambigua conserva unknown', () => {
  const { hardened } = adaptAndHarden(base({ intent: 'cancel', conversational_act: 'cancellation', target_type: 'operation', control: { correction: 'none', continuation: 'none', cancel_scope: 'unknown' } }), 'Cancélalo');
  assert.equal(hardened.cancel_scope, 'unknown');
});
test('F3C-COMPACT-ANAPHORA: continuidad de entidad activa', () => {
  const { adapted } = adaptAndHarden(base({ intent: 'continue_task', conversational_act: 'continuation', mentions: [{ kind: 'anaphoric_reference', value: 'ese mismo', source: 'utterance', certainty: 'confirmed', polarity: 'affirmed' }], control: { correction: 'none', continuation: 'active_entity', cancel_scope: 'none' } }), 'Agenda a ese mismo', { active_constraints: { name: { value: 'Andrea' } } });
  assert.equal(adapted.value.continuation.use_active_entity, true);
});
test('F3C-COMPACT-AMBIGUITY: ambigüedad y faltantes permanecen', () => {
  const { adapted } = adaptAndHarden(base({ ambiguity: true, missing_information: ['distrito', 'fecha'] }), 'Agenda una visita');
  assert.equal(adapted.value.ambiguity, true); assert.deepEqual(adapted.value.missing_information, ['distrito', 'fecha']);
});
test('F3C-COMPACT-POLARITY: contradicción se rechaza sin pérdida', () => {
  const result = compactToProviderV1(base({ mentions: [{ kind: 'service_reference', value: 'reparación', source: 'utterance', certainty: 'contradiction', polarity: 'contradicted' }] }));
  assert.equal(result.ok, false); assert.equal(result.code, 'compact_polarity_not_representable_by_v1');
});
test('F3C-COMPACT-NEGATION: negación se rechaza sin inventar afirmación', () => {
  const result = compactToProviderV1(base({ mentions: [{ kind: 'service_reference', value: 'reparación', source: 'utterance', certainty: 'confirmed', polarity: 'negated' }] }));
  assert.equal(result.ok, false); assert.equal(result.code, 'compact_polarity_not_representable_by_v1');
});
test('F3C-COMPACT-MALFORMED: mención inválida no se adapta', () => {
  const result = compactToProviderV1(base({ mentions: [{ kind: 'proper_name', value: '', source: 'utterance', certainty: 'confirmed', polarity: 'affirmed' }] }));
  assert.equal(result.ok, false); assert.equal(result.code, 'compact_mention_invalid');
});
test('F3C-COMPACT-SCHEMA: contrato compacto preserva enums v1', () => {
  const compact = compactUnderstandingJsonSchema(); const full = ownerUnderstandingJsonSchema();
  assert.deepEqual(compact.properties.intent.enum, full.properties.intent.enum);
  assert.deepEqual(compact.properties.conversational_act.enum, full.properties.conversational_act.enum);
  assert.deepEqual(compact.properties.target_type.enum, full.properties.target_type.enum);
});

const failures = cases.filter(item => item.status === 'FAIL');
process.stdout.write(JSON.stringify({ phase: 'compact_understanding_local', result: failures.length ? 'FAIL' : 'PASS', total: cases.length, passed: cases.length - failures.length, failures, network_calls: 0 }, null, 2) + '\n');
process.exitCode = failures.length ? 1 : 0;
