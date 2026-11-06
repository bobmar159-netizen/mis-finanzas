'use strict';

const SEARCH_SCHEMA = 'yarbi.candidate-search-state.v1';
function text(value, limit = 160) { return String(value ?? '').trim().slice(0, limit); }
function normalize(value) { return text(value, 160).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function integer(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function timestamp(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clue(value) { const source = object(value); return { value: text(source.value, 120), certainty: ['confirmed','approximate','inferred','contradiction'].includes(text(source.certainty,20)) ? text(source.certainty,20) : 'inferred', days: Number.isFinite(Number(source.days)) ? Number(source.days) : null, day_part: text(source.day_part,20).toLowerCase(), present: typeof source.present === 'boolean' ? source.present : null }; }
function dayPart(value) { const hour = timestamp(value)?.getUTCHours(); if (!Number.isInteger(hour)) return ''; return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'night'; }
function candidate(raw) {
  const source = object(raw); const id = integer(source.contact_id || source.id);
  return {
    contact_id: id, display_name: text(source.display_name || source.name, 160) || null,
    phones: (Array.isArray(source.phones) ? source.phones : [source.phone]).map(item => text(item,40).replace(/\D/g,'')).filter(item => item.length >= 6),
    district: text(source.district, 100) || null, service: text(source.service, 100) || null,
    location_label: text(source.location_label || source.location, 160) || null, has_location: source.has_location === true,
    last_contact_at: timestamp(source.last_contact_at)?.toISOString() || null,
    visits: Array.isArray(source.visits) ? source.visits.map(object) : [],
    historical_services: Array.isArray(source.historical_services) ? source.historical_services.map(object) : []
  };
}
function evidence(field, expected, actual, certainty, weight, detail) { return { field, expected, actual, certainty, weight, detail }; }
function matchesText(actual, wanted) { const left=normalize(actual), right=normalize(wanted); return Boolean(left && right && (left===right || left.includes(right) || right.includes(left))); }
function addTextMatch(matches, field, actual, wanted, weight) {
  if (!wanted?.value || !matchesText(actual, wanted.value)) return;
  // Una coincidencia exacta de nombre es más fuerte que una coincidencia parcial;
  // la diferencia queda visible en la explicación, no escondida en un score opaco.
  const exact = normalize(actual) === normalize(wanted.value);
  matches.push(evidence(field, wanted.value, actual, wanted.certainty, exact ? weight + 20 : Math.max(1, weight - 120), exact ? field + '_exact' : field + '_partial'));
}
function hasService(row, wanted) { return matchesText(row.service,wanted) || row.historical_services.some(item=>matchesText(item.service,wanted)); }
function hasVisit(row) { return row.visits.length > 0; }
function hasConstraintValue(constraints, key) { return constraints && Object.hasOwn(constraints,key) ? clue(constraints[key]) : null; }
function reasonText(row) { return [row.display_name, row.district && `de ${row.district}`, row.service && `por ${row.service.replace(/_/g,' ')}`].filter(Boolean).join(', '); }

function resolveCandidateReference({ candidates = [], state = {}, understanding = {}, now = new Date() } = {}) {
  // Las restricciones de la tarea sobreviven a frases elípticas del siguiente
  // turno; la comprensión nueva solo agrega/corrige pistas.
  const constraints = { ...object(state.active_constraints), ...object(understanding.constraints) }; const ref = object(understanding.target_reference);
  const discarded = new Set((Array.isArray(state.discarded_entity_ids) ? state.discarded_entity_ids : []).map(integer).filter(Boolean));
  const activeId = integer(state.active_entity?.contact_id); const selectedId = integer(state.selected_entity?.contact_id);
  const clues = {
    id: integer(ref.contact_id || constraints.contact_id), phone: text(ref.phone || constraints.phone,40).replace(/\D/g,''),
    name: hasConstraintValue(constraints,'name') || (ref.name ? { value: ref.name, certainty:'inferred' } : null),
    district: hasConstraintValue(constraints,'district'), service: hasConstraintValue(constraints,'service'), location: hasConstraintValue(constraints,'location'),
    visit: hasConstraintValue(constraints,'visit'), recency: hasConstraintValue(constraints,'recency')
  };
  const temporal = Array.isArray(understanding.temporal_clues) ? understanding.temporal_clues.map(clue) : [];
  const day = temporal.find(item=>item.day_part) || (clues.recency?.day_part ? clues.recency : null);
  const relative = temporal.find(item=>Number.isFinite(item.days)) || clues.recency;
  const ranked = [];
  for (const input of candidates) {
    const row = candidate(input); if (!row.contact_id || discarded.has(row.contact_id)) continue;
    const matches=[];
    if (clues.id && row.contact_id === clues.id) matches.push(evidence('contact_id',String(clues.id),String(row.contact_id),'confirmed',1000,'explicit_id'));
    if (clues.phone && row.phones.includes(clues.phone)) matches.push(evidence('phone','exact', 'exact','confirmed',900,'exact_phone'));
    if ((understanding.continuation?.use_active_entity || understanding.continuation?.use_last_proposed_entity) && (row.contact_id===activeId || row.contact_id===selectedId)) matches.push(evidence('active_entity','current','current','confirmed',700,'active_entity'));
    addTextMatch(matches,'name',row.display_name,clues.name,300);
    addTextMatch(matches,'district',row.district,clues.district,180);
    if (clues.service?.value && hasService(row,clues.service.value)) matches.push(evidence('service',clues.service.value,row.service || 'historical',clues.service.certainty,130,'service_match'));
    if (clues.location?.value && matchesText(row.location_label,clues.location.value)) matches.push(evidence('location',clues.location.value,row.location_label,clues.location.certainty,100,'location_match'));
    if (clues.location?.present === true && row.has_location) matches.push(evidence('location','present','present',clues.location.certainty,80,'location_present'));
    if (clues.visit?.present === true && hasVisit(row)) matches.push(evidence('visit','present','present',clues.visit.certainty,90,'visit_history'));
    if (relative && Number.isFinite(relative.days) && row.last_contact_at) {
      const age = Math.abs(new Date(now).getTime() - new Date(row.last_contact_at).getTime()) / 86400000;
      const tolerance = relative.certainty === 'approximate' ? 21 : 3;
      if (Math.abs(age-relative.days) <= tolerance) matches.push(evidence('recency',`${relative.days}d`,`${Math.round(age)}d`,relative.certainty,relative.certainty==='approximate'?35:70,'relative_time'));
    }
    if (day?.day_part && dayPart(row.last_contact_at)===day.day_part) matches.push(evidence('day_part',day.day_part,day.day_part,day.certainty,25,'time_of_day'));
    const contradictions=[];
    for (const [key, current] of [['district',clues.district],['service',clues.service]]) if (current?.certainty==='confirmed' && current.value && !matches.some(item=>item.field===key)) contradictions.push({field:key, expected:current.value, actual:key==='district'?row.district:row.service});
    const score = matches.reduce((sum,item)=>sum+item.weight,0) - contradictions.length*25;
    if (score>0) ranked.push({ contact_id:row.contact_id, display_name:row.display_name, score, reasons:matches, contradictions, summary:reasonText(row), candidate:row });
  }
  ranked.sort((a,b)=>b.score-a.score || String(b.candidate.last_contact_at||'').localeCompare(String(a.candidate.last_contact_at||'')) || a.contact_id-b.contact_id);
  const top=ranked[0]||null, next=ranked[1]||null;
  const uniqueStrong = top && (!next || top.score-next.score>=120) && (top.score>=430 || (top.score>=325 && (!next || top.score-next.score>=120)) || (!next && top.score>=300) || top.reasons.some(item=>item.weight>=700));
  const activeConstraints = Object.fromEntries(Object.entries(constraints).filter(([,value])=>value && typeof value==='object').map(([key,value])=>[key,{value:value.value||null,certainty:value.certainty||'inferred'}]));
  const search = { schema:SEARCH_SCHEMA, query: { intent:text(understanding.intent,80)||'general', target_reference:ref, constraints:activeConstraints }, candidate_count:ranked.length, candidates:ranked.slice(0,8).map(item=>({contact_id:item.contact_id,display_name:item.display_name,score:item.score,reasons:item.reasons,contradictions:item.contradictions,summary:item.summary})), highlighted_contact_id:uniqueStrong?top.contact_id:null, discarded_contact_ids:[...discarded], next_question:null };
  if (uniqueStrong) return { outcome:'resolved', selected:top, search };
  if (!top) { search.next_question='No encontré una coincidencia confiable. ¿Recuerdas el nombre, distrito, servicio o una fecha aproximada?'; return { outcome:'no_match', selected:null, search }; }
  const alternatives=ranked.slice(0,2).map(item=>item.summary || `cliente ${item.contact_id}`);
  search.next_question = alternatives.length>1 ? `¿Te refieres a ${alternatives[0]}, o a ${alternatives[1]}?` : '¿Qué detalle recuerdas para identificarlo mejor: distrito, servicio, ubicación o fecha aproximada?';
  return { outcome:'needs_clarification', selected:null, search };
}

module.exports = { SEARCH_SCHEMA, resolveCandidateReference };
