'use strict';

const assert = require('node:assert/strict');
const { strictNormalizeProposed, hardenProposed, diagnoseProposed } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal');
const { adaptV4ToV1 } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-v1-adapter-proposal');
const { normalizeUnderstanding } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-owner-understanding');
const { hardenUnderstanding } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-semantic-hardening');

const results = [];
function test(name, fn) { try { fn(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); } }
function raw({ mentions, correction = 'none', continuation = 'none', act = 'request', target = 'contact', ambiguity = false }) { return { schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: act, target_type: target, mentions, control: { correction, continuation, cancel_scope: 'none' }, confidence: .9, ambiguity, missing_information: [] }; }
function mention(kind, value, polarity = 'affirmed', attributes) { return { kind, value, polarity, certainty: 'confirmed', claimed_source: 'utterance', ...(attributes ? { attributes } : {}) }; }
function full(rawInput, utterance, state) { const strict = strictNormalizeProposed(rawInput); assert.equal(strict.ok, true); const v4 = hardenProposed({ understanding: strict.value, utterance, state }); assert.equal(v4.ok, true); const v1 = adaptV4ToV1(v4.value); return { strict, v4: v4.value, v1, v3: v1.ok ? hardenUnderstanding({ understanding: normalizeUnderstanding(v1.value).value, utterance, state }) : null }; }

test('atributos temporales normalizados no se rechazan al entrar al hardener', () => {
  const utterance = 'No era Carlos, era Carla, la que pidió una instalación ayer.';
  const value = full(raw({ correction: 'replace_previous', mentions: [mention('proper_name','Carlos','negated'), mention('proper_name','Carla'), mention('service_reference','instalación'), mention('temporal_reference','ayer','affirmed',{ days: 1 })] }), utterance, { active_constraints: { name: { value: 'Carlos' } } });
  assert.equal(value.v4.plan.requires_clarification, false); assert.equal(value.v1.ok, true); assert.equal(value.v1.value.constraints.name.value, 'Carla'); assert.equal(value.v1.value.constraints.recency.days, 1); assert.equal(value.v3.schema, 'yarbi.owner-understanding.v3');
});
test('corrección de ubicación acepta la preposición y conserva polaridad', () => {
  const utterance = 'No era en Comas, era en Ate.';
  const value = full(raw({ correction: 'replace_previous', mentions: [mention('location_reference','Comas','negated'), mention('location_reference','Ate')] }), utterance, { active_constraints: { location: { value: 'Comas' } } });
  assert.equal(value.v4.plan.requires_clarification, false); assert.equal(value.v1.ok, true); assert.equal(value.v1.value.constraints.location.value, 'Ate'); assert.equal(value.v4.discarded_mentions[0].value, 'Comas');
});
test('corrección de servicio no confunde artículos con la entidad descartada', () => {
  const utterance = 'No era la reparación, era la conversión del artefacto.';
  const value = full(raw({ correction: 'replace_previous', mentions: [mention('service_reference','reparación','negated'), mention('service_reference','conversión del artefacto')] }), utterance, { active_constraints: { service: { value: 'reparación' } } });
  assert.equal(value.v4.plan.requires_clarification, false); assert.equal(value.v1.ok, true); assert.equal(value.v1.value.constraints.service.value, 'conversión del artefacto');
});
test('continuidad sin restricción verificable se vuelve abstención segura', () => {
  const utterance = 'Ese mismo cliente.';
  const value = full(raw({ continuation: 'active_entity', mentions: [] }), utterance, { active_constraints: { name: { value: 'Carla' } } });
  assert.equal(value.v4.plan.requires_clarification, true); assert.ok(value.v4.plan.blocked_reasons.includes('no_verified_actionable_constraint')); assert.equal(value.v1.ok, false);
});
test('diagnóstico sanitizado identifica el índice de una mención inválida', () => {
  const input = raw({ mentions: [mention('temporal_reference','ayer','affirmed',{ days: 'uno' })] });
  const diagnostic = diagnoseProposed({ understanding: input, utterance: 'ayer', state: {} });
  assert.equal(diagnostic.ok, false); assert.equal(diagnostic.code, 'proposed_mention_invalid'); assert.deepEqual(diagnostic.field_paths, ['mentions[0]']);
});
test('una negación explícita nunca pasa como restricción positiva', () => {
  const utterance = 'No es Carlos.';
  const value = full(raw({ mentions: [mention('proper_name','Carlos','negated')] }), utterance, { active_constraints: { name: { value: 'Carlos' } } });
  assert.equal(value.v4.plan.requires_clarification, true); assert.equal(Object.hasOwn(value.v4.plan.query_constraints, 'name'), false); assert.equal(value.v1.ok, false);
});

const failures = results.filter(item => item.status === 'FAIL');
process.stdout.write(JSON.stringify({ phase: 'yarbi_v4_forensic_regression_local', result: failures.length ? 'FAIL' : 'PASS', passed: results.length - failures.length, total: results.length, failures, network_calls: 0, commercial_actions: 0 }, null, 2) + '\n');
process.exitCode = failures.length ? 1 : 0;
