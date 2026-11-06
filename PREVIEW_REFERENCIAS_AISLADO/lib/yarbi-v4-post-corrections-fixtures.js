'use strict';

// Batería nueva y exclusivamente sintética. Los identificadores no representan
// personas, servicios ni conversaciones reales. Las expectativas se usan solo
// por el evaluador local/remoto; el prompt recibe únicamente utterance, state
// y diagnostic_context, nunca `expect`.
const REFERENCE_TIME = '2026-11-04T12:00:00-05:00';
const TIME_ZONE = 'America/Lima';
const context = Object.freeze({ reference_time: REFERENCE_TIME, time_zone: TIME_ZONE });
const state = (active = {}) => Object.freeze({ active_constraints: active });

const CASES = Object.freeze([
  { id: 'F3PC-01', family: 'correction', utterance: 'No era ENTIDAD_A, era ENTIDAD_B; quería SERVICIO_A ayer.', state: state({ name: { value: 'ENTIDAD_A' } }), diagnostic_context: context, expect: { positive: ['ENTIDAD_B'], negated: ['ENTIDAD_A'], correction: 'replace_previous', clarification: false } },
  { id: 'F3PC-02', family: 'correction', utterance: 'No era en ZONA_A, era en ZONA_B para SERVICIO_B.', state: state({ location: { value: 'ZONA_A' } }), diagnostic_context: context, expect: { positive: ['ZONA_B', 'SERVICIO_B'], negated: ['ZONA_A'], correction: 'replace_previous', clarification: false } },
  { id: 'F3PC-03', family: 'correction', utterance: 'No era SERVICIO_C, era SERVICIO_D para ENTIDAD_C.', state: state({ service: { value: 'SERVICIO_C' } }), diagnostic_context: context, expect: { positive: ['SERVICIO_D', 'ENTIDAD_C'], negated: ['SERVICIO_C'], correction: 'replace_previous', clarification: false } },
  { id: 'F3PC-04', family: 'correction', utterance: 'No fue ayer, fue hoy por la tarde para ENTIDAD_D.', state: state({ recency: { value: 'ayer' } }), diagnostic_context: context, expect: { positive: ['hoy', 'ENTIDAD_D'], negated: ['ayer'], correction: 'replace_previous', clarification: false } },
  { id: 'F3PC-05', family: 'temporal', utterance: 'La visita fue ayer por la tarde para ENTIDAD_E.', state: state(), diagnostic_context: context, expect: { positive: ['ayer', 'ENTIDAD_E'], clarification: false } },
  { id: 'F3PC-06', family: 'temporal', utterance: 'La visita es hoy por la noche para ENTIDAD_F.', state: state(), diagnostic_context: context, expect: { positive: ['hoy', 'ENTIDAD_F'], clarification: false } },
  { id: 'F3PC-07', family: 'temporal', utterance: 'Reagenda la visita para mañana por la mañana de ENTIDAD_G.', state: state(), diagnostic_context: context, expect: { clarification: true } },
  { id: 'F3PC-08', family: 'continuity', utterance: 'Ese mismo cliente.', state: state({ name: { value: 'ENTIDAD_H' } }), diagnostic_context: context, expect: { positive: ['ENTIDAD_H'], continuation: 'active_entity', clarification: false } },
  { id: 'F3PC-09', family: 'continuity', utterance: 'El mismo servicio, pero por la tarde.', state: state({ service: { value: 'SERVICIO_E' } }), diagnostic_context: context, expect: { positive: ['SERVICIO_E'], continuation: 'active_entity', clarification: false } },
  { id: 'F3PC-10', family: 'continuity', utterance: 'Continúa con ENTIDAD_I y su SERVICIO_F.', state: state({ name: { value: 'ENTIDAD_I' }, service: { value: 'SERVICIO_F' } }), diagnostic_context: context, expect: { positive: ['ENTIDAD_I', 'SERVICIO_F'], continuation: 'active_entity', clarification: false } },
  { id: 'F3PC-11', family: 'independent_negation', utterance: 'No era ENTIDAD_J; ENTIDAD_K pidió SERVICIO_G.', state: state({ name: { value: 'ENTIDAD_J' } }), diagnostic_context: context, expect: { positive: ['ENTIDAD_K', 'SERVICIO_G'], negated: ['ENTIDAD_J'], correction: 'replace_previous', clarification: false } },
  { id: 'F3PC-12', family: 'independent_negation', utterance: 'No era SERVICIO_H; ENTIDAD_L pidió SERVICIO_I.', state: state({ service: { value: 'SERVICIO_H' } }), diagnostic_context: context, expect: { positive: ['ENTIDAD_L', 'SERVICIO_I'], negated: ['SERVICIO_H'], correction: 'replace_previous', clarification: false } },
  { id: 'F3PC-13', family: 'identification_service', utterance: 'Busca a ENTIDAD_M por SERVICIO_J.', state: state(), diagnostic_context: context, expect: { positive: ['ENTIDAD_M', 'SERVICIO_J'], clarification: false } },
  { id: 'F3PC-14', family: 'identification_service', utterance: 'Abre el caso de ENTIDAD_N para SERVICIO_K.', state: state(), diagnostic_context: context, expect: { positive: ['ENTIDAD_N', 'SERVICIO_K'], clarification: false } },
  { id: 'F3PC-15', family: 'ambiguity', utterance: 'ENTIDAD_O o ENTIDAD_P para SERVICIO_L.', state: state(), diagnostic_context: context, expect: { clarification: true } },
  { id: 'F3PC-16', family: 'ambiguity', utterance: 'No sé si fue ZONA_C o ZONA_D.', state: state(), diagnostic_context: context, expect: { clarification: true } }
]);

function fixtureById(id) { return CASES.find(item => item.id === id) || null; }
function validateFixtures() {
  const distribution = CASES.reduce((out, item) => { out[item.family] = (out[item.family] || 0) + 1; return out; }, {});
  const unique = new Set(CASES.map(item => item.id));
  const valid = CASES.length === 16 && unique.size === 16
    && distribution.correction === 4 && distribution.temporal === 3 && distribution.continuity === 3
    && distribution.independent_negation === 2 && distribution.identification_service === 2 && distribution.ambiguity === 2
    && CASES.every(item => /^F3PC-\d{2}$/.test(item.id) && item.diagnostic_context?.reference_time === REFERENCE_TIME && item.diagnostic_context?.time_zone === TIME_ZONE);
  return { valid, count: CASES.length, unique_ids: unique.size === CASES.length, distribution, reference_time: REFERENCE_TIME, time_zone: TIME_ZONE };
}

module.exports = { CASES, fixtureById, validateFixtures, REFERENCE_TIME, TIME_ZONE };
