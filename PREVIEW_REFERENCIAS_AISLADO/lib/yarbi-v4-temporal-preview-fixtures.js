'use strict';

// Fixtures fijos y sintéticos para una validación temporal limitada a tres
// llamadas. No son recibidos por HTTP y no representan clientes reales.
const REFERENCE_TIME = '2026-11-05T12:00:00-05:00';
const TIME_ZONE = 'America/Lima';
const CONTEXT = Object.freeze({ reference_time: REFERENCE_TIME, time_zone: TIME_ZONE });
const state = (active = {}) => Object.freeze({ active_constraints: active });

const CASES = Object.freeze([
  {
    id: 'F3TV-01', family: 'clear_temporal',
    utterance: 'La visita fue ayer por la tarde para ENTIDAD_TEST_A.', state: state(), diagnostic_context: CONTEXT,
    expect: { positive: ['ayer', 'ENTIDAD_TEST_A'], clarification: false }
  },
  {
    id: 'F3TV-02', family: 'explicit_correction',
    utterance: 'La visita fue ayer por la tarde para ENTIDAD_TEST_B. Me corrijo: no fue ayer por la tarde; fue hoy por la noche.',
    state: state({ recency: { value: 'ayer' } }), diagnostic_context: CONTEXT,
    expect: { positive: ['hoy'], negated: ['ayer'], no_positive: ['ayer'], correction: 'replace_previous', clarification: false }
  },
  {
    id: 'F3TV-03', family: 'ambiguous_temporal',
    utterance: 'La visita fue el otro día para ENTIDAD_TEST_C.', state: state(), diagnostic_context: CONTEXT,
    expect: { clarification: true }
  }
]);

function fixtureById(id) { return CASES.find(item => item.id === id) || null; }
function validateFixtures() {
  const ids = new Set(CASES.map(item => item.id));
  return {
    valid: CASES.length === 3 && ids.size === 3 && CASES.every(item => /^F3TV-0[1-3]$/.test(item.id) && item.diagnostic_context === CONTEXT),
    count: CASES.length,
    reference_time: REFERENCE_TIME,
    time_zone: TIME_ZONE
  };
}

module.exports = { CASES, fixtureById, validateFixtures, REFERENCE_TIME, TIME_ZONE };
