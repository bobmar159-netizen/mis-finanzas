'use strict';

// Batería cerrada, sintética y sólo diagnóstica. Ningún texto llega desde el
// cliente HTTP: la ruta acepta exclusivamente estos identificadores.
const DEFAULT_STATE = Object.freeze({ active_constraints: {} });
const state = (active = {}) => Object.freeze({ active_constraints: active });

const CASES = Object.freeze([
  { id: 'F3V4G-01', group: 'gate', family: 'identificacion', utterance: 'Busca a Carla.', state: DEFAULT_STATE, expect: { positive: ['carla'], clarification: false, unambiguous: true } },
  { id: 'F3V4G-02', group: 'gate', family: 'correccion', utterance: 'No era Carlos, era Carla, la que pidió una instalación ayer.', state: state({ name: { value: 'Carlos' } }), expect: { positive: ['carla'], negated: ['carlos'], correction: 'replace_previous', clarification: false, unambiguous: true } },
  { id: 'F3V4G-03', group: 'gate', family: 'negacion', utterance: 'No quiero cancelar la cita.', state: DEFAULT_STATE, expect: { clarification: true, no_positive: ['cancelar'], unambiguous: true } },
  { id: 'F3V4G-04', group: 'gate', family: 'negacion', utterance: 'Carlos no es el cliente.', state: state({ name: { value: 'Carlos' } }), expect: { negated: ['carlos'], clarification: true, unambiguous: true } },
  { id: 'F3V4G-05', group: 'gate', family: 'continuidad', utterance: 'Me refería al otro servicio.', state: state({ service: { value: 'reparacion' } }), expect: { clarification: true, unambiguous: false } },
  { id: 'F3V4G-06', group: 'gate', family: 'ambiguedad', utterance: 'No estoy seguro si era el cliente de ayer.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4G-07', group: 'gate', family: 'servicio', utterance: 'La instalación sí, la reparación no.', state: DEFAULT_STATE, expect: { negated: ['reparacion'], clarification: true, unambiguous: true } },
  { id: 'F3V4G-08', group: 'gate', family: 'ubicacion', utterance: 'Busca a Andrea de Ate.', state: DEFAULT_STATE, expect: { positive: ['andrea', 'ate'], clarification: false, unambiguous: true } },
  { id: 'F3V4G-09', group: 'gate', family: 'temporal', utterance: 'La visita fue ayer por la tarde.', state: DEFAULT_STATE, expect: { positive: ['ayer'], clarification: false, unambiguous: true } },
  { id: 'F3V4G-10', group: 'gate', family: 'continuidad', utterance: 'Ese mismo cliente.', state: state({ name: { value: 'Carla' } }), expect: { clarification: true, unambiguous: false } },
  { id: 'F3V4G-11', group: 'gate', family: 'contradiccion', utterance: 'Cancela la cita anterior, no la nueva.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4G-12', group: 'gate', family: 'negacion', utterance: 'No se debe cancelar la cita.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4G-13', group: 'gate', family: 'correccion', utterance: 'Mejor dicho, Carla, no Carlos.', state: state({ name: { value: 'Carlos' } }), expect: { positive: ['carla'], negated: ['carlos'], correction: 'replace_previous', clarification: false, unambiguous: true } },
  { id: 'F3V4G-14', group: 'gate', family: 'servicio', utterance: 'Quiero una instalación nueva.', state: DEFAULT_STATE, expect: { positive: ['instalacion nueva'], clarification: false, unambiguous: true } },
  { id: 'F3V4G-15', group: 'gate', family: 'correccion', utterance: 'No era en Comas, era en Ate.', state: state({ location: { value: 'Comas' } }), expect: { positive: ['ate'], negated: ['comas'], correction: 'replace_previous', clarification: false, unambiguous: true } },
  { id: 'F3V4G-16', group: 'gate', family: 'temporal', utterance: 'Fue ayer por la mañana.', state: DEFAULT_STATE, expect: { positive: ['ayer'], clarification: false, unambiguous: true } },
  { id: 'F3V4G-17', group: 'gate', family: 'correccion', utterance: 'Carlos no, Carla sí.', state: state({ name: { value: 'Carlos' } }), expect: { positive: ['carla'], negated: ['carlos'], correction: 'replace_previous', clarification: false, unambiguous: true } },
  { id: 'F3V4G-18', group: 'gate', family: 'ambiguedad', utterance: 'No era Carlos ni Pedro, era Carla o Andrea.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4F-01', group: 'fresh', family: 'identificacion', utterance: 'Es Carlos, el de la instalación nueva.', state: DEFAULT_STATE, expect: { positive: ['carlos', 'instalacion nueva'], clarification: false, unambiguous: true } },
  { id: 'F3V4F-02', group: 'fresh', family: 'servicio', utterance: 'El de la conversión de cocina, pero no el de reparación.', state: DEFAULT_STATE, expect: { negated: ['reparacion'], clarification: true, unambiguous: true } },
  { id: 'F3V4F-03', group: 'fresh', family: 'ubicacion', utterance: 'Creo que fue en San Juan de Lurigancho, no estoy seguro.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4F-04', group: 'fresh', family: 'temporal', utterance: 'Reagenda la visita para mañana por la mañana.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: false } },
  { id: 'F3V4F-05', group: 'fresh', family: 'negacion', utterance: 'No canceles la visita de Carla.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4F-06', group: 'fresh', family: 'ambiguedad', utterance: 'La otra Carla, la de Ate.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4F-07', group: 'fresh', family: 'continuidad', utterance: 'El cliente de ayer escribió otra vez.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: false } },
  { id: 'F3V4F-08', group: 'fresh', family: 'servicio', utterance: 'Quiero cambiar la tubería, no instalar un punto.', state: DEFAULT_STATE, expect: { negated: ['instalar un punto'], clarification: true, unambiguous: true } },
  { id: 'F3V4F-09', group: 'fresh', family: 'correccion', utterance: 'No fue en la noche, fue esta mañana.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4F-10', group: 'fresh', family: 'continuidad', utterance: 'El mismo de antes, pero ya no quiere la visita.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4F-11', group: 'fresh', family: 'ambiguedad', utterance: 'Andrea o Maricielo, no estoy seguro.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: true } },
  { id: 'F3V4F-12', group: 'fresh', family: 'correccion', utterance: 'No era la reparación, era la conversión del artefacto.', state: state({ service: { value: 'reparacion' } }), expect: { positive: ['conversion del artefacto'], negated: ['reparacion'], correction: 'replace_previous', clarification: false, unambiguous: true } },
  { id: 'F3V4F-13', group: 'fresh', family: 'referencia', utterance: 'Quiero ver lo del punto, el que hablamos el lunes.', state: DEFAULT_STATE, expect: { clarification: true, unambiguous: false } },
  { id: 'F3V4F-14', group: 'fresh', family: 'identificacion', utterance: 'El cliente que escribió ayer en la tarde desde Ate.', state: DEFAULT_STATE, expect: { positive: ['ayer', 'ate'], clarification: false, unambiguous: true } }
]);

function fixtureById(id) { return CASES.find(item => item.id === id) || null; }
function validateFixtures() {
  const ids = new Set(CASES.map(item => item.id));
  const groups = CASES.reduce((out, item) => { out[item.group] = (out[item.group] || 0) + 1; return out; }, {});
  const valid = CASES.length === 32 && ids.size === 32 && groups.gate === 18 && groups.fresh === 14 && CASES.every(item => /^F3V4(?:G|F)-\d{2}$/.test(item.id) && typeof item.utterance === 'string' && item.utterance.length > 0 && item.expect && typeof item.expect === 'object');
  return { valid, count: CASES.length, groups, unique_ids: ids.size === CASES.length };
}

module.exports = { CASES, fixtureById, validateFixtures };
