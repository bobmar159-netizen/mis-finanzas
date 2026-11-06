'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createOwnerConversationState, processOwnerTurn, summarizeConversationMetrics } = require('../lib/yarbi-owner-conversation');
const { resolveCandidateReference } = require('../lib/yarbi-candidate-resolver');
const { compactUnderstandingContext } = require('../lib/yarbi-owner-understanding');

const NOW = '2026-10-31T15:00:00.000Z';
function semantic(overrides = {}) {
  const result = {
    schema: 'yarbi.owner-understanding.v1', intent: 'open_client', conversational_act: 'request', target_type: 'contact', target_reference: {}, constraints: {}, correction: {}, continuation: {}, cancel_scope: 'none', temporal_clues: [], location_clues: [], service_clues: [], confidence: 0.9, ambiguity: false, missing_information: [], ...overrides
  };
  const declaredName = result.entity_mentions ? null : (result.constraints?.name?.value || result.constraints?.name || result.target_reference?.name);
  // Los escenarios de conversación que se refieren explícitamente a una
  // persona declaran la evidencia tipada que entregaría el proveedor v3.
  // No imitamos el contrato anterior que promovía cualquier cadena a nombre.
  if (declaredName) result.entity_mentions = [{ kind: 'proper_name', value: declaredName, source: 'utterance', certainty: 'confirmed', evidence: declaredName }];
  return result;
}
function provider(utterance, ...answers) { const model=async()=>answers.shift(); model.utterance=utterance; return model; }
function client(id, name, extra = {}) { return { contact_id:id, display_name:name, phones:[`955000${String(id).padStart(3,'0')}`], last_contact_at:'2026-10-31T09:00:00.000Z', ...extra }; }
async function turn(state, model, candidates) { return processOwnerTurn({ state, utterance:model.utterance, provider:model, candidates, now:NOW, moduleOrigin:'yarbi', visualOrigin:'test' }); }

test('A: una corrección nombre + distrito resuelve sin una pregunta adicional', async () => {
  const candidates=[client(1,'Carlos Uno',{district:'Ate',service:'reparacion'}),client(2,'Carlos Dos',{district:'Comas',service:'punto_adicional'})];
  let state=createOwnerConversationState();
  const first=await turn(state,provider('Carlos.',semantic({constraints:{name:'Carlos'}})),candidates); state=first.state;
  assert.equal(first.outcome,'needs_clarification');
  const second=await turn(state,provider('No, ese no, el Carlos de Comas.',semantic({conversational_act:'correction',constraints:{name:'Carlos',district:{value:'Comas',certainty:'confirmed'}}})),candidates);
  assert.equal(second.outcome,'resolved'); assert.equal(second.selected.contact_id,2); assert.equal(second.question,undefined);
});

test('B: descartar la entidad activa mantiene la tarea y abre el candidato correcto', async () => {
  const candidates=[client(11,'Carlos',{district:'Ate'}),client(12,'Carlos',{district:'Comas'})];
  const state={...createOwnerConversationState(),active_entity:{contact_id:11,display_name:'Carlos'},selected_entity:{contact_id:11,display_name:'Carlos'}};
  const corrected=await turn(state,provider('No, ese no, el Carlos de Comas.',semantic({conversational_act:'correction',correction:{discard_active_entity:true},constraints:{name:'Carlos',district:{value:'Comas',certainty:'confirmed'}}})),candidates);
  assert.equal(corrected.outcome,'resolved'); assert.equal(corrected.selected.contact_id,12); assert.deepEqual(corrected.state.discarded_entity_ids,[11]);
});

test('C: búsqueda reciente conserva filtros y luego resuelve Ivón sin reiniciar', async () => {
  const candidates=[client(21,'Ivón',{last_contact_at:'2026-10-31T09:00:00.000Z'}),client(22,'María',{last_contact_at:'2026-10-31T10:00:00.000Z'}),client(23,'Ivón Antigua',{last_contact_at:'2026-10-20T20:00:00.000Z'})];
  let state=createOwnerConversationState();
  const morning=await turn(state,provider('El que escribió en la mañana.',semantic({constraints:{recency:{day_part:'morning',certainty:'approximate'}},temporal_clues:[{day_part:'morning',certainty:'approximate'}]})),candidates); state=morning.state;
  const ivon=await turn(state,provider('Ivón.',semantic({conversational_act:'clarification',constraints:{name:'Ivón'}})),candidates);
  assert.equal(ivon.outcome,'resolved'); assert.equal(ivon.selected.contact_id,21); assert.ok(ivon.state.active_constraints.recency);
});

test('D y E: recuerdos aproximados reducen sin eliminar un cliente de hace cinco semanas', async () => {
  const candidates=[client(31,'Ventanilla Mañana',{district:'Ventanilla',visits:[{at:'2026-09-26T09:00:00.000Z'}],last_contact_at:'2026-09-26T09:00:00.000Z'}),client(32,'Ventanilla Noche',{district:'Ventanilla',visits:[{at:'2026-09-26T21:00:00.000Z'}],last_contact_at:'2026-09-26T21:00:00.000Z'})];
  let state=createOwnerConversationState();
  const approximate=await turn(state,provider('La visita de Ventanilla de hace como un mes.',semantic({constraints:{district:{value:'Ventanilla',certainty:'confirmed'},visit:{present:true,certainty:'confirmed'},recency:{days:30,certainty:'approximate'}},temporal_clues:[{days:30,certainty:'approximate'}]})),candidates); state=approximate.state;
  assert.equal(approximate.search.candidate_count,2);
  const morning=await turn(state,provider('Fue en la mañana.',semantic({conversational_act:'clarification',temporal_clues:[{day_part:'morning',certainty:'approximate'}]})),candidates);
  assert.equal(morning.search.candidate_count,2); assert.ok(morning.search.candidates.some(item=>item.contact_id===31)); assert.equal(morning.state.active_constraints.district.value,'Ventanilla');
});

test('F: “ese mismo” usa la entidad activa propuesta sin volver a buscar nombre', async () => {
  const candidates=[client(41,'Actual'),client(42,'Histórico')];
  const state={...createOwnerConversationState(),active_entity:{contact_id:41,display_name:'Actual'},selected_entity:{contact_id:41,display_name:'Actual'}};
  const result=await turn(state,provider('Ese mismo.',semantic({conversational_act:'confirmation',continuation:{use_active_entity:true}})),candidates);
  assert.equal(result.outcome,'resolved'); assert.equal(result.selected.contact_id,41);
});

test('G y H: cancelar tarea no ejecuta nada y scope ambiguo pide una sola confirmación', async () => {
  const candidates=[client(51,'Uno')];
  const cancelled=await turn(createOwnerConversationState(),provider('Cancela la tarea.',semantic({conversational_act:'cancellation',cancel_scope:'task',target_type:'none'})),candidates);
  assert.equal(cancelled.outcome,'cancelled'); assert.equal(cancelled.proposal.execute,false);
  const ambiguous=await turn(createOwnerConversationState(),provider('Cancela eso.',semantic({conversational_act:'cancellation',cancel_scope:'unknown',target_type:'unknown'})),candidates);
  assert.equal(ambiguous.outcome,'requires_confirmation'); assert.match(ambiguous.question,/cancelar/i); assert.equal(ambiguous.proposal.execute,false);
});

test('I y K: coincidencias con mismo nombre no se fusionan y generan una sola pregunta útil', async () => {
  const candidates=[client(61,'Carlos',{district:'Comas',service:'punto_adicional'}),client(62,'Carlos',{district:'Comas',service:'reparacion'})];
  const result=await turn(createOwnerConversationState(),provider('El Carlos de Comas.',semantic({constraints:{name:'Carlos',district:{value:'Comas',certainty:'confirmed'}}})),candidates);
  assert.equal(result.outcome,'needs_clarification'); assert.equal(result.search.candidates.length,2); assert.match(result.question,/punto adicional|reparacion/i); assert.notEqual(result.search.candidates[0].contact_id,result.search.candidates[1].contact_id);
});

test('J: cliente recurrente conserva un único contacto aunque tenga servicio histórico', async () => {
  const candidates=[client(71,'Carlos Recurrente',{historical_services:[{service:'instalacion_nueva',at:'2025-10-01T10:00:00Z'}],service:null})];
  const result=await turn(createOwnerConversationState(),provider('Carlos Recurrente, el de instalación nueva.',semantic({constraints:{name:'Carlos Recurrente',service:{value:'instalacion_nueva',certainty:'confirmed'}}})),candidates);
  assert.equal(result.outcome,'resolved'); assert.equal(result.selected.contact_id,71); assert.equal(result.proposal.execute,false);
});

test('L: contexto actual gana a historial amplio salvo una referencia fuerte contraria', async () => {
  const candidates=[client(81,'Actual'),client(82,'Cliente Histórico')];
  const state={...createOwnerConversationState(),active_entity:{contact_id:81,display_name:'Actual'},selected_entity:{contact_id:81,display_name:'Actual'}};
  const result=await turn(state,provider('Sí, ese.',semantic({conversational_act:'continuation',continuation:{use_active_entity:true},target_reference:{name:'Cliente Histórico'}})),candidates);
  assert.equal(result.outcome,'resolved'); assert.equal(result.selected.contact_id,81);
});

test('el adaptador mantiene privacidad acotada, no depende de Gemini real y expone métricas', async () => {
  const compact=compactUnderstandingContext({state:createOwnerConversationState(),candidates:Array.from({length:12},(_,i)=>client(100+i,`F3R ${i}`))});
  assert.equal(compact.candidates.length,8); assert.equal(JSON.stringify(compact).includes('phone'),false);
  const started=performance.now();
  const result=await turn(createOwnerConversationState(),provider('F3R 1.',semantic({constraints:{name:'F3R 1'}})),[client(101,'F3R 1')]);
  assert.equal(result.outcome,'resolved'); assert.ok(performance.now()-started<100);
  assert.deepEqual(summarizeConversationMetrics([result,{outcome:'needs_clarification'},{outcome:'cancelled'}]),{turns:3,resolved:1,needed_question:1,cancelled:1,ambiguous_cancellation:0,lost_context:0});
});

test('un contrato inválido del proveedor no puede producir propuesta ni efectos', async () => {
  const result=await processOwnerTurn({state:createOwnerConversationState(),utterance:'F3R',provider:provider('F3R',{schema:'otra.version'}),candidates:[client(91,'No usar')],now:NOW});
  assert.equal(result.outcome,'understanding_invalid'); assert.equal(result.proposal.execute,false);
});
