'use strict';

// Recorrido local aislado hasta el plan del resolvedor: no construye cliente
// Supabase, no llama red y usa únicamente candidatos de memoria.
const assert = require('node:assert/strict');
const { hardenProposed, upgradeLegacyV1 } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal');
const { adaptV4ToV1 } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-v1-adapter-proposal');
const { normalizeUnderstanding } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-owner-understanding');
const { hardenUnderstanding } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-semantic-hardening');
const { resolveCandidateReference } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-candidate-resolver');
const results = [];
function test(name, fn) { try { fn(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); } }
function mention(kind, value, polarity = 'affirmed', certainty = 'confirmed', extra = {}) { return { kind, value, polarity, certainty, claimed_source: 'utterance', ...extra }; }
function base(overrides = {}) { return { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact', mentions: [], control: { correction: 'none', continuation: 'none', cancel_scope: 'none' }, confidence: 0.8, ambiguity: false, missing_information: [], ...overrides }; }
function pipeline(v4, utterance, state = {}, candidates = []) {
  const hardenedV4 = hardenProposed({ understanding: v4, utterance, state }); assert.equal(hardenedV4.ok, true, hardenedV4.code);
  const adapted = adaptV4ToV1(hardenedV4.value); if (!adapted.ok) return { hardenedV4: hardenedV4.value, adapted };
  const normalized = normalizeUnderstanding(adapted.value); assert.equal(normalized.ok, true, normalized.code);
  const hardenedV3 = hardenUnderstanding({ understanding: normalized.value, utterance, state });
  const resolved = resolveCandidateReference({ candidates, state, understanding: hardenedV3, now: new Date('2026-11-03T15:00:00Z') });
  return { hardenedV4: hardenedV4.value, adapted, normalized, hardenedV3, resolved };
}
const candidates = [
  { contact_id: 1, display_name: 'Carlos', service: 'reparación', district: 'Comas' },
  { contact_id: 2, display_name: 'Carla', service: 'instalación', district: 'Comas' },
  { contact_id: 3, display_name: 'Andrea', service: 'reparación', district: 'Ate' }
];

test('corrección con referencia activa coincidente llega como Carla positiva', () => {
  const r = pipeline(base({ conversational_act: 'correction', mentions: [mention('proper_name', 'Carlos', 'negated'), mention('proper_name', 'Carla')], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' } }), 'No era Carlos, era Carla', { active_constraints: { name: { value: 'Carlos' } } }, candidates);
  assert.equal(r.adapted.ok, true); assert.equal(r.adapted.value.constraints.name.value, 'Carla'); assert.equal(r.adapted.preservation.discarded_mentions[0].value, 'Carlos'); assert.equal(r.hardenedV3.constraints.name.value, 'Carla'); assert.equal(r.resolved.search.query.constraints.name.value, 'Carla'); assert.notEqual(r.resolved.selected?.contact_id, 1);
});
test('corrección con descartado distinto al estado no llega al adaptador', () => {
  const r = pipeline(base({ conversational_act: 'correction', mentions: [mention('proper_name', 'Pedro', 'negated'), mention('proper_name', 'Carla')], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' } }), 'No era Pedro, era Carla', { active_constraints: { name: { value: 'Carlos' } } }, candidates);
  assert.equal(r.adapted.ok, false); assert.deepEqual(r.hardenedV4.plan.query_constraints, {});
});
test('corrección entre dimensiones distintas se abstiene', () => {
  const r = pipeline(base({ conversational_act: 'correction', target_type: 'service', mentions: [mention('proper_name', 'Carlos', 'negated'), mention('service_reference', 'instalación')], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' } }), 'No era Carlos, era instalación', { active_constraints: { name: { value: 'Carlos' } } });
  assert.equal(r.adapted.ok, false); assert.ok(r.hardenedV4.plan.blocked_reasons.includes('correction_dimension_mismatch'));
});
test('negación sin reemplazo no genera restricciones', () => {
  const r = pipeline(base({ mentions: [mention('proper_name', 'Carlos', 'negated')], control: { correction: 'discard_active_entity', continuation: 'none', cancel_scope: 'none' } }), 'Carlos no era el cliente', { active_constraints: { name: { value: 'Carlos' } } });
  assert.equal(r.adapted.ok, false); assert.deepEqual(r.hardenedV4.plan.query_constraints, {});
});
test('contradicción no resuelta no llega al resolvedor', () => {
  const r = pipeline(base({ target_type: 'service', mentions: [mention('service_reference', 'instalación')] }), 'Necesito instalación', { active_constraints: { service: { value: 'reparación' } } });
  assert.equal(r.adapted.ok, false); assert.equal(r.hardenedV4.contradictions[0].status, 'unresolved');
});
test('servicio afirmado y nombre negado se abstiene', () => {
  const r = pipeline(base({ target_type: 'service', mentions: [mention('proper_name', 'Carlos', 'negated'), mention('service_reference', 'instalación')] }), 'No era Carlos, necesito instalación');
  assert.equal(r.adapted.ok, false); assert.equal(Object.hasOwn(r.hardenedV4.plan.query_constraints, 'name'), false); assert.equal(Object.hasOwn(r.hardenedV4.plan.query_constraints, 'service'), false);
});
test('nombre afirmado y servicio negado se abstiene', () => {
  const r = pipeline(base({ mentions: [mention('proper_name', 'Carla'), mention('service_reference', 'reparación', 'negated')] }), 'Carla no quería reparación');
  assert.equal(r.adapted.ok, false); assert.deepEqual(r.hardenedV4.plan.query_constraints, {});
});
test('atributo temporal incorrecto bloquea adaptación', () => {
  const r = pipeline(base({ mentions: [mention('temporal_reference', 'hoy', 'affirmed', 'confirmed', { attributes: { days: 3 } })] }), 'El cliente escribió hoy');
  assert.equal(r.adapted.ok, false); assert.ok(r.hardenedV4.plan.blocked_reasons.includes('attributes_not_verifiable'));
});
test('procedencia no demostrada bloquea adaptación', () => {
  const r = pipeline(base({ mentions: [mention('proper_name', 'Carla', 'affirmed', 'confirmed', { claimed_source: 'conversation_state' })] }), 'Busca a Andrea');
  assert.equal(r.adapted.ok, false); assert.equal(r.hardenedV4.mentions[0].provenance.source, 'unverified');
});
test('las cuatro formas de negación de cancelación no son acciones', () => {
  for (const utterance of ['No canceles la cita', 'No quiero cancelar la cita', 'No vayas a cancelar la cita', 'No canceles todavía']) {
    const r = pipeline(base({ intent: 'cancel', conversational_act: 'cancellation', target_type: 'agenda', control: { correction: 'none', continuation: 'none', cancel_scope: 'agenda' } }), utterance);
    assert.equal(r.adapted.ok, false); assert.equal(r.hardenedV4.control.cancel_scope, 'none'); assert.ok(r.hardenedV4.plan.blocked_reasons.includes('negated_cancellation'));
  }
});
test('acción de cancelación afirmada no ejecuta ni se adapta a consulta', () => {
  const r = pipeline(base({ intent: 'cancel', conversational_act: 'cancellation', target_type: 'agenda', control: { correction: 'none', continuation: 'none', cancel_scope: 'agenda' } }), 'Sí, cancela la cita');
  assert.equal(r.adapted.ok, false); assert.equal(r.hardenedV4.plan.may_auto_select, false);
});
test('cancelación de cita anterior frente a nueva se abstiene por alcance', () => {
  const r = pipeline(base({ intent: 'cancel', conversational_act: 'cancellation', target_type: 'agenda', control: { correction: 'none', continuation: 'none', cancel_scope: 'agenda' } }), 'Cancela la cita anterior, no la nueva');
  assert.equal(r.adapted.ok, false); assert.ok(r.hardenedV4.plan.blocked_reasons.includes('cancellation_scope_ambiguous'));
});
test('payload v1 seguro sigue por compatibilidad y no altera v1/v3', () => {
  const legacy = { schema: 'yarbi.owner-understanding.v1', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact', target_reference: {}, entity_mentions: [{ kind: 'proper_name', value: 'Carla', source: 'utterance', certainty: 'confirmed' }], constraints: {}, correction: {}, continuation: {}, cancel_scope: 'none', temporal_clues: [], location_clues: [], service_clues: [], confidence: 0.7, ambiguity: false, missing_information: [] };
  const upgraded = upgradeLegacyV1(legacy, 'Busca a Carla'); assert.equal(upgraded.ok, true);
  const r = pipeline(upgraded.value, 'Busca a Carla', {}, candidates); assert.equal(r.adapted.ok, true); assert.equal(r.normalized.value.schema, 'yarbi.owner-understanding.v1'); assert.equal(r.hardenedV3.schema, 'yarbi.owner-understanding.v3');
});
test('múltiples pares de corrección son ambiguos', () => {
  const r = pipeline(base({ conversational_act: 'correction', mentions: [mention('proper_name', 'Carlos', 'negated'), mention('proper_name', 'Pedro', 'negated'), mention('proper_name', 'Carla'), mention('proper_name', 'Andrea')], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' } }), 'No era Carlos ni Pedro, era Carla o Andrea', { active_constraints: { name: { value: 'Carlos' } } });
  assert.equal(r.adapted.ok, false); assert.ok(r.hardenedV4.plan.blocked_reasons.includes('correction_pair_missing_or_ambiguous'));
});
test('referencia genérica ambigua nunca permite selección automática', () => {
  const r = pipeline(base({ mentions: [mention('generic_reference', 'el cliente')], ambiguity: true }), 'El cliente');
  assert.equal(r.adapted.ok, false); assert.equal(r.hardenedV4.plan.may_auto_select, false);
});

const failed = results.filter(item => item.status === 'FAIL');
process.stdout.write(JSON.stringify({ phase: 'v4_v1_v3_local_integration', result: failed.length ? 'FAIL' : 'PASS', total: results.length, passed: results.length - failed.length, failures: failed, network_calls: 0, crm_queries: 0, commercial_actions: 0 }, null, 2) + '\n');
process.exitCode = failed.length ? 1 : 0;
