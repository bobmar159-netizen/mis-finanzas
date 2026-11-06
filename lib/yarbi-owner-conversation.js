'use strict';

const { OWNER_UNDERSTANDING_SCHEMA, understandOwnerUtterance } = require('./yarbi-owner-understanding');
const { SEARCH_SCHEMA, resolveCandidateReference } = require('./yarbi-candidate-resolver');
const { tryFastLocalOwnerTurn } = require('./yarbi-fast-local');
const { planCrmSearchFromUnderstanding } = require('./yarbi-crm-search-conversation');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function integer(value) { const n=Number(value); return Number.isSafeInteger(n)&&n>0?n:null; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function createOwnerConversationState({ moduleOrigin = null, visualOrigin = null } = {}) {
  return { schema:'yarbi.owner-conversation.v1', intent:null, task:null, active_entity:null, selected_entity:null, discarded_entity_ids:[], active_candidates:[], active_constraints:{}, last_question:null, last_owner_response:null, corrections:[], result:null, module_origin:moduleOrigin, visual_origin:visualOrigin, status:'idle' };
}

function mergeConstraints(current, incoming, understanding) {
  const result={...object(current),...object(incoming)};
  const temporal=Array.isArray(understanding.temporal_clues)?understanding.temporal_clues:[];
  const locations=Array.isArray(understanding.location_clues)?understanding.location_clues:[];
  const services=Array.isArray(understanding.service_clues)?understanding.service_clues:[];
  if (!result.location && locations[0]) result.location=locations[0];
  if (!result.service && services[0]) result.service=services[0];
  const newestTemporal=temporal.find(item=>item?.day_part||Number.isFinite(item?.days));
  // Una corrección temporal del turno actual sustituye la pista anterior; no
  // conservamos morning + night como hechos simultáneos de la misma tarea.
  if (newestTemporal && (!result.recency || understanding.conversational_act==='correction')) result.recency=newestTemporal;
  return result;
}

function applyUnderstanding({ state, understanding, candidates, now }) {
  const previous=object(state); const next={...createOwnerConversationState({moduleOrigin:previous.module_origin,visualOrigin:previous.visual_origin}),...previous};
  next.intent=understanding.intent||next.intent; next.task=understanding.intent||next.task;
  next.last_owner_response=understanding; next.active_constraints=mergeConstraints(next.active_constraints,understanding.constraints,understanding);
  if (understanding.correction?.discard_active_entity && next.active_entity?.contact_id) {
    next.discarded_entity_ids=unique([...next.discarded_entity_ids,integer(next.active_entity.contact_id)]);
    next.corrections=[...next.corrections,{kind:'discard_active_entity',contact_id:integer(next.active_entity.contact_id),at:new Date(now).toISOString()}].slice(-12);
    next.active_entity=null; next.selected_entity=null;
  }
  if (understanding.conversational_act==='cancellation') {
    if (understanding.cancel_scope==='task') return { state:{...next,status:'cancelled',result:{kind:'task_cancelled',execute:false}}, outcome:'cancelled', proposal:{kind:'none',execute:false} };
    return { state:{...next,status:'needs_confirmation',result:{kind:'cancellation_scope_ambiguous',execute:false}}, outcome:'requires_confirmation', proposal:{kind:'none',execute:false}, question:'¿Quieres cancelar la búsqueda actual o una operación real? No haré ningún cambio hasta que lo confirmes.' };
  }
  const resolution=resolveCandidateReference({candidates,state:next,understanding,now});
  next.active_candidates=resolution.search.candidates; next.result=resolution.search;
  if (resolution.outcome==='resolved') {
    next.active_entity={contact_id:resolution.selected.contact_id,display_name:resolution.selected.display_name}; next.selected_entity=next.active_entity; next.last_question=null; next.status='resolved';
    return { state:next,outcome:'resolved',search:resolution.search,proposal:{kind:'open_contact_card',contact_id:resolution.selected.contact_id,execute:false},selected:resolution.selected };
  }
  next.last_question=resolution.search.next_question; next.status=resolution.outcome;
  return { state:next,outcome:resolution.outcome,search:resolution.search,proposal:{kind:'none',execute:false},question:resolution.search.next_question };
}

async function processOwnerTurn({ state, utterance, provider, candidates, moduleOrigin, visualOrigin, now = new Date() } = {}) {
  const base=state||createOwnerConversationState({moduleOrigin,visualOrigin});
  // FAST_LOCAL solo responde preguntas operativas inequívocas. Cualquier
  // referencia, corrección o lenguaje no determinista continúa por V4/Gemini.
  const local=tryFastLocalOwnerTurn({utterance,state:base});
  if (local.handled) return {
    schema:'yarbi.owner-conversation-result.v1', outcome:'fast_local',
    understanding_schema:OWNER_UNDERSTANDING_SCHEMA, search_schema:SEARCH_SCHEMA,
    state:base, reply:local.reply, fast_local:true, fast_local_source:local.source,
    proposal:local.proposal, commercial_effects_allowed:false
  };
  const interpreted=await understandOwnerUtterance({provider,utterance,state:base,candidates,moduleOrigin,visualOrigin});
  if (interpreted.status!=='understood') return { schema:'yarbi.owner-conversation-result.v1', outcome:'understanding_invalid', proposal:{kind:'none',execute:false}, state:base, understanding_status:interpreted.status, code:interpreted.code||null };
  const applied=applyUnderstanding({state:base,understanding:interpreted.understanding,candidates,now});
  // El plan conserva la interpretación V4 pero no consulta ni modifica CRM
  // desde este módulo. El adaptador autenticado lo ejecuta después de validar
  // el owner y su alcance canónico.
  const crm_search=planCrmSearchFromUnderstanding({understanding:interpreted.understanding,state:applied.state});
  return { schema:'yarbi.owner-conversation-result.v1', understanding_schema:OWNER_UNDERSTANDING_SCHEMA, search_schema:SEARCH_SCHEMA, understanding:interpreted.understanding, ...applied, crm_search };
}

function summarizeConversationMetrics(results = []) {
  const rows=Array.isArray(results)?results:[];
  return { turns:rows.length, resolved:rows.filter(row=>row?.outcome==='resolved').length, needed_question:rows.filter(row=>row?.outcome==='needs_clarification').length, cancelled:rows.filter(row=>row?.outcome==='cancelled').length, ambiguous_cancellation:rows.filter(row=>row?.outcome==='requires_confirmation').length, lost_context:rows.filter(row=>row?.outcome==='understanding_invalid').length };
}

module.exports = { createOwnerConversationState, processOwnerTurn, summarizeConversationMetrics };
