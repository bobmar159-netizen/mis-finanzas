'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { understandOwnerUtterance } = require('../lib/yarbi-owner-understanding');
const { resolveCandidateReference } = require('../lib/yarbi-candidate-resolver');
const { createOwnerConversationState, processOwnerTurn } = require('../lib/yarbi-owner-conversation');

function clue(overrides = {}) { return { value: '', certainty: 'inferred', days: null, day_part: null, present: null, ...overrides }; }
function answer(overrides = {}) {
  return {
    schema: 'yarbi.owner-understanding.v1', intent: 'reference_lookup', conversational_act: 'request', target_type: 'contact',
    target_reference: { name: '', relation: '' },
    constraints: { name: clue(), district: clue(), service: clue(), location: clue(), visit: clue(), recency: clue() },
    correction: { discard_active_entity: false, replace_previous: false, select_alternative: false },
    continuation: { use_active_entity: false, use_last_proposed_entity: false }, cancel_scope: 'none',
    temporal_clues: [], location_clues: [], service_clues: [], entity_mentions: [], confidence: 0.8, ambiguity: false, missing_information: [], ...overrides
  };
}
function provider(value) { return async () => value; }
async function understand(utterance, raw, state = {}) { return (await understandOwnerUtterance({ provider: provider(raw), utterance, state })).understanding; }

test('hallucination guard elimina nombre inventado y conserva servicio explícito con procedencia', async () => {
  const result = await understand('Era el que quería un punto adicional.', answer({
    target_reference: { name: 'Carlos', relation: '' },
    constraints: { name: clue({ value: 'Carlos' }), district: clue(), service: clue({ value: 'punto_adicional', certainty: 'confirmed' }), location: clue(), visit: clue(), recency: clue() }
  }));
  assert.equal(result.schema, 'yarbi.owner-understanding.v3');
  assert.equal(result.target_reference.name, undefined);
  assert.equal(result.constraints.name, undefined);
  assert.equal(result.constraints.service.value, 'punto_adicional');
  assert.equal(result.constraints.service.source, 'utterance');
  assert.ok(result.semantic_guard.removed_fields.includes('target_reference.name'));
});

test('cliente recurrente conserva relación y tiempo aproximado sin inventar servicio', async () => {
  const result = await understand('El Carlos al que ya le hicimos un trabajo el año pasado.', answer({
    target_reference: { name: 'Carlos', relation: 'instalacion' },
    constraints: { name: clue({ value: 'Carlos' }), district: clue(), service: clue({ value: 'instalacion_nueva' }), location: clue(), visit: clue(), recency: clue({ days: 365, certainty: 'approximate' }) },
    service_clues: [clue({ value: 'instalacion_nueva' })],
    entity_mentions: [{ kind: 'proper_name', value: 'Carlos', source: 'utterance', certainty: 'confirmed', evidence: 'Carlos' }]
  }));
  assert.equal(result.target_reference.name, 'Carlos');
  assert.equal(result.historical_relationship, true);
  assert.equal(result.constraints.service, undefined);
  assert.equal(result.service_clues.length, 0);
  assert.equal(result.constraints.recency.days, 365);
  assert.equal(result.semantic_safety, 'uncertain');
});

test('cancelación ambigua conserva intención y deja alcance unknown', async () => {
  const result = await understand('Cancela eso.', answer({ conversational_act: 'cancellation', cancel_scope: 'agenda' }));
  assert.equal(result.conversational_act, 'cancellation');
  assert.equal(result.cancel_scope, 'unknown');
  assert.equal(result.semantic_safety, 'uncertain');
});

test('normalización temporal es estable y la corrección night sustituye morning', async () => {
  const morning = await understand('Fue en la mañana.', answer({ constraints: { name: clue(), district: clue(), service: clue(), location: clue(), visit: clue(), recency: clue({ day_part: 'morning' }) } }));
  assert.equal(morning.constraints.recency.day_part, 'morning');
  const state = { ...createOwnerConversationState(), active_constraints: { recency: morning.constraints.recency } };
  const raw = answer({ conversational_act: 'correction', constraints: { name: clue(), district: clue(), service: clue(), location: clue(), visit: clue(), recency: clue({ day_part: 'night' }) }, temporal_clues: [clue({ day_part: 'night' })] });
  const turn = await processOwnerTurn({ state, utterance: 'No, fue de noche.', provider: provider(raw), candidates: [] });
  assert.equal(turn.state.active_constraints.recency.day_part, 'night');
  assert.equal(JSON.stringify(turn.state.active_constraints).includes('morning'), false);
});

test('nombre parcial no simula conocer el CRM; el resolver decide la ambigüedad', async () => {
  const understanding = await understand('El Carlos.', answer({ target_reference: { name: 'Carlos', relation: '' }, constraints: { name: clue({ value: 'Carlos', certainty: 'confirmed' }), district: clue(), service: clue(), location: clue(), visit: clue(), recency: clue() }, entity_mentions: [{ kind: 'proper_name', value: 'Carlos', source: 'utterance', certainty: 'confirmed', evidence: 'Carlos' }], ambiguity: true }));
  assert.equal(understanding.reference_specificity, 'partial');
  assert.equal(understanding.ambiguity, false);
  const resolution = resolveCandidateReference({ understanding, candidates: [
    { contact_id: 1, display_name: 'Carlos', district: 'Comas', service: 'reparacion' },
    { contact_id: 2, display_name: 'Carlos', district: 'Ate', service: 'punto_adicional' }
  ] });
  assert.equal(resolution.outcome, 'needs_clarification');
  assert.equal(resolution.search.candidate_count, 2);
});

test('hecho sin evidencia se elimina y el contrato se abstiene', async () => {
  const result = await understand('No recuerdo.', answer({ target_reference: { name: 'María', relation: '' }, constraints: { name: clue({ value: 'María' }), district: clue({ value: 'Comas' }), service: clue({ value: 'reparacion' }), location: clue(), visit: clue(), recency: clue() } }));
  assert.equal(result.target_reference.name, undefined);
  assert.deepEqual(result.constraints, {});
  assert.ok(['uncertain', 'unsupported'].includes(result.semantic_safety));
  assert.equal(result.semantic_guard.removed_fact_count >= 3, true);
});

test('arbitraje tipado: un alias de servicio no puede ocupar el nombre', async () => {
  const result = await understand('Era el que quería un punto adicional.', answer({
    target_reference: { name: 'punto adicional', relation: '' },
    constraints: { name: clue({ value: 'punto adicional' }), district: clue(), service: clue({ value: 'punto_adicional' }), location: clue(), visit: clue(), recency: clue() }
  }));
  assert.equal(result.constraints.service.value, 'punto_adicional');
  assert.equal(result.target_reference.name, undefined);
  assert.ok(result.semantic_guard.rejected_facts.some(item => item.field === 'target_reference.name' && item.reason === 'evidence_type_conflict' && item.evidence_type === 'service'));
});

test('arbitraje tipado conserva reparación e instalación como servicio, nunca como nombre', async () => {
  for (const [utterance, service] of [['El de reparación.', 'reparacion'], ['El de instalación nueva.', 'instalacion_nueva']]) {
    const result = await understand(utterance, answer({ target_reference: { name: utterance.replace(/^El de /, '').replace('.', ''), relation: '' } }));
    assert.equal(result.constraints.service.value, service);
    assert.equal(result.target_reference.name, undefined);
  }
});

test('arbitraje tipado no convierte una referencia temporal en nombre', async () => {
  const result = await understand('Fue por la mañana.', answer({ target_reference: { name: 'mañana', relation: '' } }));
  assert.equal(result.constraints.recency.day_part, 'morning');
  assert.equal(result.target_reference.name, undefined);
  assert.ok(result.semantic_guard.rejected_facts.some(item => item.evidence_type === 'temporal'));
});

test('servicio y nombre explícito independientes pueden coexistir', async () => {
  const result = await understand('Punto adicional de Carlos.', answer({
    target_reference: { name: 'Carlos', relation: '' },
    constraints: { name: clue({ value: 'Carlos' }), district: clue(), service: clue({ value: 'punto_adicional' }), location: clue(), visit: clue(), recency: clue() },
    entity_mentions: [{ kind: 'proper_name', value: 'Carlos', source: 'utterance', certainty: 'confirmed', evidence: 'Carlos' }]
  }));
  assert.equal(result.constraints.service.value, 'punto_adicional');
  assert.equal(result.target_reference.name, 'Carlos');
});

test('un nombre reservado solo se conserva si el estado conversacional lo declara explícitamente', async () => {
  const raw = answer({ target_reference: { name: 'Punto adicional', relation: '' }, constraints: { name: clue({ value: 'Punto adicional' }), district: clue(), service: clue(), location: clue(), visit: clue(), recency: clue() } });
  const withoutState = await understand('Hablemos de punto adicional.', raw);
  assert.equal(withoutState.target_reference.name, undefined);
  const withState = await understand('Hablemos de punto adicional.', raw, { active_constraints: { name: { value: 'Punto adicional' } } });
  assert.equal(withState.target_reference.name, 'Punto adicional');
  assert.equal(withState.target_reference.source, 'conversation_state');
});

test('un servicio desconocido no se normaliza ni se convierte en nombre por descarte', async () => {
  const result = await understand('Era por un servicio extraordinario.', answer({
    target_reference: { name: '', relation: '' },
    constraints: { name: clue(), district: clue(), service: clue({ value: 'servicio extraordinario' }), location: clue(), visit: clue(), recency: clue() }
  }));
  assert.equal(result.constraints.service, undefined);
  assert.equal(result.target_reference.name, undefined);
});

test('menciones tipadas separan servicio, nombre, ubicación, tiempo y anáfora sin inventar identidad', async () => {
  const scenarios = [
    {
      utterance: 'Era el que quería un punto adicional.',
      raw: answer({ target_reference: { name: 'el que quería un punto adicional', relation: '' } }),
      service: 'punto_adicional'
    },
    {
      utterance: 'El cliente del punto adicional.',
      raw: answer({ target_reference: { name: 'el cliente del punto adicional', relation: '' } }),
      service: 'punto_adicional'
    },
    {
      utterance: 'El que quería reparación.',
      raw: answer({ target_reference: { name: 'el que quería reparación', relation: '' } }),
      service: 'reparacion'
    },
    {
      utterance: 'Punto adicional de Carlos.',
      raw: answer({ target_reference: { name: 'Carlos', relation: '' }, constraints: { name: clue({ value: 'Carlos' }), district: clue(), service: clue({ value: 'punto_adicional' }), location: clue(), visit: clue(), recency: clue() }, entity_mentions: [{ kind: 'proper_name', value: 'Carlos', source: 'utterance', certainty: 'confirmed', evidence: 'Carlos' }] }),
      name: 'Carlos',
      service: 'punto_adicional'
    },
    {
      utterance: 'Carlos, el del punto adicional.',
      raw: answer({ target_reference: { name: 'Carlos', relation: '' }, constraints: { name: clue({ value: 'Carlos' }), district: clue(), service: clue({ value: 'punto_adicional' }), location: clue(), visit: clue(), recency: clue() }, entity_mentions: [{ kind: 'proper_name', value: 'Carlos', source: 'utterance', certainty: 'confirmed', evidence: 'Carlos' }] }),
      name: 'Carlos',
      service: 'punto_adicional'
    },
    {
      utterance: 'El de Comas.',
      raw: answer({ target_reference: { name: 'Comas', relation: '' }, constraints: { name: clue({ value: 'Comas' }), district: clue({ value: 'Comas' }), service: clue(), location: clue(), visit: clue(), recency: clue() }, entity_mentions: [{ kind: 'location_reference', value: 'Comas', source: 'utterance', certainty: 'confirmed', evidence: 'Comas' }] })
    },
    {
      utterance: 'El de esta mañana.',
      raw: answer({ target_reference: { name: 'esta mañana', relation: '' }, constraints: { name: clue({ value: 'esta mañana' }), district: clue(), service: clue(), location: clue(), visit: clue(), recency: clue({ day_part: 'morning' }) } })
    },
    {
      utterance: 'Ese mismo.',
      raw: answer({ target_reference: { name: 'ese mismo', relation: '' } })
    },
    {
      utterance: 'El Carlos.',
      raw: answer({ target_reference: { name: 'Carlos', relation: '' }, constraints: { name: clue({ value: 'Carlos' }), district: clue(), service: clue(), location: clue(), visit: clue(), recency: clue() }, entity_mentions: [{ kind: 'proper_name', value: 'Carlos', source: 'utterance', certainty: 'confirmed', evidence: 'Carlos' }] }),
      name: 'Carlos'
    },
    {
      utterance: 'El que atendimos el año pasado.',
      raw: answer({ target_reference: { name: 'el que atendimos el año pasado', relation: '' } })
    }
  ];
  for (const scenario of scenarios) {
    const result = await understand(scenario.utterance, scenario.raw);
    assert.equal(result.target_reference.name, scenario.name, scenario.utterance);
    if (scenario.service) assert.equal(result.constraints.service.value, scenario.service, scenario.utterance);
  }
});

test('un provider v1 sin entity_mentions mantiene compatibilidad estructural, pero no promociona un nombre libre', async () => {
  const result = await understand('Carlos.', answer({ target_reference: { name: 'Carlos', relation: '' }, constraints: { name: clue({ value: 'Carlos' }), district: clue(), service: clue(), location: clue(), visit: clue(), recency: clue() } }));
  assert.equal(result.schema, 'yarbi.owner-understanding.v3');
  assert.equal(result.target_reference.name, undefined);
  assert.ok(result.semantic_guard.rejected_facts.some(item => item.reason === 'typed_proper_name_required'));
});
