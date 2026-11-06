'use strict';

function text(value) { return String(value ?? '').trim(); }
function lower(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function percentile(values, fraction) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}
function stats(values) {
  const numbers = values.filter(value => value !== null && value !== undefined && value !== '').map(Number).filter(Number.isFinite);
  return numbers.length ? {
    n: numbers.length,
    min_ms: Math.min(...numbers),
    p50_ms: percentile(numbers, 0.5),
    p95_ms: percentile(numbers, 0.95),
    max_ms: Math.max(...numbers)
  } : { n: 0, min_ms: null, p50_ms: null, p95_ms: null, max_ms: null };
}
function latencyBins(values, timeoutCount = 0) {
  const bins = { lt_1s: 0, from_1_to_2s: 0, from_2_to_3s: 0, from_3_to_4_5s: 0, from_4_5_to_10s: 0, timeout: timeoutCount };
  for (const raw of values) {
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (value < 1000) bins.lt_1s += 1;
    else if (value < 2000) bins.from_1_to_2s += 1;
    else if (value < 3000) bins.from_2_to_3s += 1;
    else if (value < 4500) bins.from_3_to_4_5s += 1;
    else bins.from_4_5_to_10s += 1;
  }
  return bins;
}
function clues(understanding) {
  const values = Object.entries(understanding?.constraints || {}).map(([kind, clue]) => ({ kind, ...(clue || {}) }));
  return values.concat(
    (understanding?.temporal_clues || []).map(clue => ({ kind: 'temporal', ...clue })),
    (understanding?.location_clues || []).map(clue => ({ kind: 'location', ...clue })),
    (understanding?.service_clues || []).map(clue => ({ kind: 'service', ...clue }))
  );
}
function hasValue(understanding, expected) {
  const wanted = lower(expected);
  return clues(understanding).some(clue => lower(clue.value) === wanted || lower(clue.day_part) === wanted);
}
function explicitFixtureFacts(row) {
  const facts = {
    names: new Set(row.name ? [lower(row.name)] : []),
    districts: new Set(row.district ? [lower(row.district)] : []),
    services: new Set(row.service ? [lower(row.service)] : []),
    dayParts: new Set(row.day_part ? [lower(row.day_part)] : [])
  };
  const utterance = lower(row.utterance);
  if (utterance.includes('carlos')) facts.names.add('carlos');
  if (utterance.includes('comas')) facts.districts.add('comas');
  if (utterance.includes('ventanilla')) facts.districts.add('ventanilla');
  if (utterance.includes('punto adicional')) facts.services.add('punto_adicional');
  if (utterance.includes('manana')) facts.dayParts.add('morning');
  if (utterance.includes('noche') || utterance.includes('anoche')) facts.dayParts.add('night');
  const state = conversationState(row.id);
  const active = state?.active_constraints || {};
  if (active.name) facts.names.add(lower(active.name?.value ?? active.name));
  if (active.district) facts.districts.add(lower(active.district?.value ?? active.district));
  if (active.location) facts.districts.add(lower(active.location?.value ?? active.location));
  if (active.service) facts.services.add(lower(active.service?.value ?? active.service));
  const activeRecency = lower(active.recency?.day_part ?? active.recency?.value ?? active.recency);
  if (['morning', 'afternoon', 'evening', 'night'].includes(activeRecency)) facts.dayParts.add(activeRecency);
  return facts;
}
function intentPass(answer) {
  const intent = lower(answer?.intent);
  return Boolean(intent) && !['execute', 'execute_action', 'send_message', 'write', 'sql'].includes(intent);
}
function hallucinations(row, answer) {
  const issues = [];
  const facts = explicitFixtureFacts(row);
  const reference = answer?.target_reference || {};
  if (reference.contact_id) issues.push('invented_contact_id');
  if (text(reference.phone)) issues.push('invented_phone');
  if (text(reference.name) && !facts.names.has(lower(reference.name))) issues.push('invented_name');
  for (const clue of clues(answer)) {
    const value = lower(clue.value);
    if (!value) continue;
    if (clue.kind === 'name' && !facts.names.has(value)) issues.push('invented_name');
    if ((clue.kind === 'district' || clue.kind === 'location') && !facts.districts.has(value)) issues.push('invented_location');
    if (clue.kind === 'service' && !facts.services.has(value)) issues.push('invented_service');
  }
  if (row.id === 'F3G-RECURRENT') {
    if (clues(answer).some(clue => clue.kind === 'service' && text(clue.value))) issues.push('recurrent_invented_service');
    if (clues(answer).some(clue => ['district', 'location'].includes(clue.kind) && text(clue.value))) issues.push('recurrent_invented_location');
  }
  return [...new Set(issues)];
}
function uncertaintyPass(row, answer) {
  if (row.certainty !== 'approximate') return true;
  return clues(answer).some(clue => Number.isFinite(Number(clue.days)) && Math.abs(Number(clue.days) - Number(row.days)) <= 7 && lower(clue.certainty) === 'approximate');
}
function provenancePass(answer) {
  if (!answer || !['safe', 'uncertain', 'unsupported'].includes(answer.semantic_safety)) return false;
  const factClues = clues(answer).filter(clue => text(clue.value) || clue.days !== null && clue.days !== undefined || text(clue.day_part) || clue.present !== null && clue.present !== undefined);
  if (factClues.some(clue => !['utterance', 'conversation_state'].includes(clue.source) || !['safe', 'uncertain'].includes(clue.semantic_safety))) return false;
  const reference = answer.target_reference || {};
  if (text(reference.name) && (!['utterance', 'conversation_state'].includes(reference.source) || !['safe', 'uncertain'].includes(reference.semantic_safety))) return false;
  return true;
}
function typedMentionPass(row, answer) {
  const mentions = Array.isArray(answer?.entity_mentions) ? answer.entity_mentions : [];
  const referenceName = text(answer?.target_reference?.name);
  const service = text(answer?.constraints?.service?.value) || text(answer?.service_clues?.[0]?.value);
  if (referenceName && !mentions.some(item => item?.kind === 'proper_name' && lower(item.value) === lower(referenceName))) return false;
  if (service && !mentions.some(item => item?.kind === 'service_reference' && lower(item.value).includes(lower(service)))) return false;
  // Para el caso que originó la corrección, service_reference debe existir y
  // target_reference.name debe permanecer vacío.
  if (row.id === 'F3G-SERVICE' && (referenceName || !mentions.some(item => item?.kind === 'service_reference'))) return false;
  return true;
}
function assess(row, response) {
  const answer = response?.body?.understanding || null;
  const schemaPass = answer?.schema === 'yarbi.owner-understanding.v3';
  const failures = [];
  const hallucinationIssues = answer ? hallucinations(row, answer) : [];
  const actPass = !row.act || answer?.conversational_act === row.act;
  const intentIsValid = Boolean(answer) && intentPass(answer);
  const constraintFailures = [];
  if (row.cancel_scope && answer?.cancel_scope !== row.cancel_scope) constraintFailures.push('cancel_scope');
  if (row.name && lower(answer?.target_reference?.name) !== lower(row.name) && !hasValue(answer, row.name)) constraintFailures.push('name');
  if (row.district && !hasValue(answer, row.district)) constraintFailures.push('district');
  if (row.service && !hasValue(answer, row.service)) constraintFailures.push('service');
  if (row.day_part && !hasValue(answer, row.day_part)) constraintFailures.push('day_part');
  if (row.days && !clues(answer).some(clue => Number.isFinite(Number(clue.days)) && Math.abs(Number(clue.days) - Number(row.days)) <= 7)) constraintFailures.push('approximate_days');
  if (row.reference_specificity && answer?.reference_specificity !== row.reference_specificity) constraintFailures.push('reference_specificity');
  if (row.historical_relationship === true && answer?.historical_relationship !== true) constraintFailures.push('historical_relationship');
  const constraintsPass = constraintFailures.length === 0;
  const uncertaintyPreserved = uncertaintyPass(row, answer);
  const factsHaveProvenance = provenancePass(answer);
  const typedMentionsValid = typedMentionPass(row, answer);
  const executeFalse = response?.body?.execute === false;
  const providerError = response?.status !== 200 ? (response?.body?.error || 'request_failed') : null;
  const timeout = response?.body?.understanding_error === 'owner_understanding_timeout';
  if (!schemaPass) failures.push('schema');
  if (!intentIsValid) failures.push('intent');
  if (!actPass) failures.push('conversational_act');
  failures.push(...constraintFailures);
  if (!uncertaintyPreserved) failures.push('uncertainty_not_preserved');
  if (!factsHaveProvenance) failures.push('provenance');
  if (!typedMentionsValid) failures.push('typed_mentions');
  failures.push(...hallucinationIssues);
  if (!executeFalse) failures.push('execute_not_false');
  if (providerError) failures.push(`provider:${providerError}`);
  return {
    case_id: row.id,
    schema_pass: schemaPass,
    semantic_pass: failures.length === 0,
    intent_pass: intentIsValid,
    conversational_act_pass: actPass,
    constraints_pass: constraintsPass,
    uncertainty_preserved: uncertaintyPreserved,
    provenance_pass: factsHaveProvenance,
    typed_mentions_pass: typedMentionsValid,
    hallucination_detected: hallucinationIssues.length > 0,
    hallucination_reasons: hallucinationIssues,
    execute_false: executeFalse,
    semantic_failures: [...new Set(failures)],
    gemini_ms: Number.isFinite(Number(response?.body?.metrics?.gemini_ms)) ? Number(response.body.metrics.gemini_ms) : null,
    server_total_ms: Number.isFinite(Number(response?.body?.metrics?.total_ms)) ? Number(response.body.metrics.total_ms) : null,
    timeout,
    provider_error: providerError,
    route: response?.body?.route || null,
    status: Number(response?.status || 0)
  };
}
function conversationState(caseId) {
  const states = {
    'F3G-CORRECTION': { task: 'identify_contact', intent: 'reference_lookup', has_active_entity: true, active_constraints: { name: 'Carlos', district: 'Callao' }, last_question: '¿Te refieres al Carlos de Callao?' },
    'F3G-CONFIRMATION': { task: 'identify_contact', intent: 'reference_lookup', has_active_entity: true, active_constraints: { name: 'Carlos', district: 'Comas' }, last_question: '¿Te refieres al Carlos de Comas?' },
    'F3G-CONTINUATION': { task: 'prepare_follow_up', intent: 'continue_task', has_active_entity: true, active_constraints: { name: 'Carlos' }, last_question: 'Preparé una propuesta para este cliente.' },
    'F3G-CANCEL': { task: 'prepare_follow_up', intent: 'cancel_task', has_active_entity: true, active_constraints: { name: 'Carlos' }, last_question: '¿Deseas continuar con este seguimiento?' },
    'F3G-CANCEL-AMBIGUOUS': { intent: 'reference_lookup', has_active_entity: false },
    'F3G-TEMPORAL-CORRECTION': { task: 'identify_contact', intent: 'reference_lookup', has_active_entity: true, active_constraints: { recency: 'morning' }, last_question: '¿Fue el cliente de la mañana?' }
  };
  return states[caseId] || undefined;
}
module.exports = { assess, conversationState, latencyBins, stats };
