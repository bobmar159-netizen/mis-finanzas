'use strict';

// v3 conserva el contrato endurecido v2, pero convierte la salida del
// proveedor en menciones lingüísticas tipadas antes de derivar un nombre. Una
// mención nunca es por sí sola una identidad CRM.
const HARDENED_SCHEMA = 'yarbi.owner-understanding.v3';
const PREVIOUS_HARDENED_SCHEMA = 'yarbi.owner-understanding.v2';
const SOURCES = new Set(['utterance', 'conversation_state', 'unknown']);
const MENTION_KINDS = new Set(['proper_name', 'service_reference', 'location_reference', 'temporal_reference', 'generic_reference', 'anaphoric_reference', 'unknown']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value, limit = 180) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function normalized(value) { return text(value, 400).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function phrasePresent(haystack, needle) { const left = ` ${normalized(haystack)} `; const right = normalized(needle); return Boolean(right && left.includes(` ${right} `)); }
function stateClue(state, key) { const raw = object(state).active_constraints?.[key]; return typeof raw === 'string' ? { value: raw } : object(raw); }
function evidence(source, evidenceText, safety = 'safe') { return { source: SOURCES.has(source) ? source : 'unknown', evidence_text: text(evidenceText, 120) || null, semantic_safety: safety }; }

const SERVICE_ALIASES = [
  ['punto_adicional', ['punto adicional', 'otro punto']],
  ['instalacion_nueva', ['instalacion nueva', 'nueva instalacion']],
  ['modificacion_tuberia', ['modificacion de tuberia', 'modificar tuberia']],
  ['conversion_artefacto', ['conversion de artefacto', 'convertir artefacto']],
  ['reparacion', ['reparacion', 'reparar']],
  ['otro', ['otro servicio']]
];

function canonicalService(value) {
  const candidate = normalized(value);
  for (const [canonical, aliases] of SERVICE_ALIASES) if (normalized(canonical) === candidate || aliases.some(alias => normalized(alias) === candidate)) return canonical;
  return null;
}
function serviceFromSpan(value) {
  for (const [canonical, aliases] of SERVICE_ALIASES) {
    const alias = aliases.find(item => phrasePresent(value, item));
    if (alias) return { value: canonical, evidence_text: alias };
  }
  return null;
}
function serviceFromUtterance(utterance) { return serviceFromSpan(utterance); }
function dayPartFromUtterance(utterance) {
  const value = normalized(utterance);
  if (/\b(anoche|de noche|por la noche|en la noche)\b/.test(value)) return { day_part: 'night', ...(value.includes('anoche') ? { days: 1 } : {}), evidence_text: value.includes('anoche') ? 'anoche' : 'de noche' };
  if (/\b(esta manana|por la manana|en la manana|de manana)\b/.test(value)) return { day_part: 'morning', evidence_text: 'por la mañana' };
  if (/\b(esta tarde|por la tarde|en la tarde|de tarde)\b/.test(value)) return { day_part: 'afternoon', evidence_text: 'por la tarde' };
  return null;
}
function relativeTimeFromUtterance(utterance) {
  const value = normalized(utterance);
  if (/\b(hace\s+(como\s+)?(un|1)\s+mes|hace\s+aproximadamente\s+un\s+mes)\b/.test(value)) return { days: 30, certainty: 'approximate', evidence_text: 'hace aproximadamente un mes' };
  if (/\b(el\s+ano\s+pasado|hace\s+(como\s+)?un\s+ano)\b/.test(value)) return { days: 365, certainty: 'approximate', evidence_text: 'el año pasado' };
  return null;
}
function historicalRelationshipFromUtterance(utterance) { return /\b(ya\s+le\s+hicimos|al\s+que\s+le\s+hicimos|trabajo\s+el\s+ano\s+pasado|cliente\s+recurrente)\b/.test(normalized(utterance)); }

function genericReferenceKind(value) {
  const candidate = normalized(value);
  if (/^(ese|esa|ese mismo|esa misma|el otro|la otra)\b/.test(candidate)) return 'anaphoric_reference';
  if (/^(el|la)\s+(que|cliente|de|del|que queria|que atendimos)\b/.test(candidate)) return 'generic_reference';
  return null;
}
function temporalReference(value) {
  const candidate = normalized(value);
  return /^(manana|tarde|noche|anoche|hoy|ayer|esta manana|esta tarde|el ano pasado)$/.test(candidate);
}
function classifyEvidenceType(value, utterance) {
  const raw = text(value, 120); const candidate = normalized(raw);
  if (!candidate) return { type: 'unknown' };
  const service = serviceFromSpan(raw);
  if (service) return { type: 'service', canonical: service.value };
  if (temporalReference(raw) && phrasePresent(utterance, raw)) return { type: 'temporal' };
  const generic = genericReferenceKind(raw);
  if (generic) return { type: generic };
  return { type: 'unknown' };
}
function mentionKind(value, proposedKind) {
  const service = serviceFromSpan(value); if (service) return { kind: 'service_reference', service };
  if (temporalReference(value)) return { kind: 'temporal_reference' };
  const generic = genericReferenceKind(value); if (generic) return { kind: generic };
  const proposed = text(proposedKind, 40).toLowerCase();
  return { kind: MENTION_KINDS.has(proposed) ? proposed : 'unknown' };
}
function explicitStateName(state, value) { const active = stateClue(state, 'name').value; return Boolean(active && normalized(active) === normalized(value)); }
function mentionSource(value, requested, utterance, state, kind) {
  if (kind === 'proper_name' && explicitStateName(state, value)) return 'conversation_state';
  if (phrasePresent(utterance, value)) return 'utterance';
  return SOURCES.has(requested) ? requested : 'unknown';
}
function normalizeEntityMention(raw, utterance, state) {
  const input = object(raw); const value = text(input.value, 120); if (!value) return null;
  const classified = mentionKind(value, input.kind); const kind = classified.kind;
  const source = mentionSource(value, text(input.source, 32), utterance, state, kind);
  if (kind === 'proper_name' && !['utterance', 'conversation_state'].includes(source)) return null;
  if (kind !== 'proper_name' && source === 'unknown') return null;
  return { kind, value, source, certainty: ['confirmed', 'approximate', 'inferred'].includes(text(input.certainty, 20)) ? text(input.certainty, 20) : 'inferred', evidence_text: value };
}
function inferredReferenceMention(utterance) {
  const value = normalized(utterance);
  if (/^ese mismo\b/.test(value)) return { kind: 'anaphoric_reference', value: 'ese mismo', source: 'utterance', certainty: 'confirmed', evidence_text: 'ese mismo' };
  if (/^(el|la)\s+que\b/.test(value)) return { kind: 'generic_reference', value: 'el que', source: 'utterance', certainty: 'confirmed', evidence_text: 'el que' };
  if (/^(el|la)\s+cliente\b/.test(value)) return { kind: 'generic_reference', value: 'el cliente', source: 'utterance', certainty: 'confirmed', evidence_text: 'el cliente' };
  return null;
}
function uniqueMentions(items) {
  const seen = new Set(); const out = [];
  for (const item of items.filter(Boolean)) {
    const key = `${item.kind}:${normalized(item.value)}`;
    if (!seen.has(key)) { seen.add(key); out.push(item); }
  }
  return out;
}
function typedMentions(source, utterance, state) {
  const raw = object(source); const references = object(raw.target_reference); const constraints = object(raw.constraints);
  const values = Array.isArray(raw.entity_mentions) ? raw.entity_mentions.slice(0, 12) : [];
  // Los campos históricos se tratan como menciones no tipadas: sirven para
  // detectar conflicto, pero nunca para promover un nombre por compatibilidad.
  if (text(references.name)) values.push({ kind: 'unknown', value: references.name, source: references.source, certainty: references.certainty });
  if (text(object(constraints.name).value)) values.push({ kind: 'unknown', value: object(constraints.name).value, source: object(constraints.name).source, certainty: object(constraints.name).certainty });
  const output = values.map(item => normalizeEntityMention(item, utterance, state)).filter(Boolean);
  const service = serviceFromUtterance(utterance);
  if (service) output.push({ kind: 'service_reference', value: service.value, source: 'utterance', certainty: 'confirmed', evidence_text: service.evidence_text });
  const dayPart = dayPartFromUtterance(utterance); const relative = relativeTimeFromUtterance(utterance);
  if (dayPart || relative) output.push({ kind: 'temporal_reference', value: dayPart?.evidence_text || relative?.evidence_text || 'relative_time', source: 'utterance', certainty: relative ? 'approximate' : 'confirmed', evidence_text: dayPart?.evidence_text || relative?.evidence_text || null });
  output.push(inferredReferenceMention(utterance));
  return uniqueMentions(output).slice(0, 12);
}
function properNameMention(value, mentions, utterance, state) {
  const raw = text(value, 120); if (!raw) return null;
  if (explicitStateName(state, raw)) return { value: raw, ...evidence('conversation_state', stateClue(state, 'name').value) };
  const mention = mentions.find(item => item.kind === 'proper_name' && normalized(item.value) === normalized(raw) && item.source === 'utterance' && phrasePresent(utterance, item.value));
  return mention ? { value: mention.value, ...evidence('utterance', mention.evidence_text) } : null;
}
function supportedTextFact(kind, value, utterance, state, mentions = []) {
  const raw = text(value, 120); if (!raw) return null;
  if (kind === 'name') return properNameMention(raw, mentions, utterance, state);
  if (kind === 'service') {
    const canonical = canonicalService(raw); const explicit = serviceFromUtterance(utterance);
    if (canonical && explicit?.value === canonical) return { value: canonical, ...evidence('utterance', explicit.evidence_text) };
    const active = canonicalService(stateClue(state, 'service').value);
    if (canonical && active === canonical) return { value: canonical, ...evidence('conversation_state', canonical) };
    return null;
  }
  if (phrasePresent(utterance, raw)) return { value: raw, ...evidence('utterance', raw) };
  const active = text(stateClue(state, kind).value, 120);
  if (active && normalized(active) === normalized(raw)) return { value: raw, ...evidence('conversation_state', active) };
  return null;
}
function meaningfulClue(clue) { return Boolean(clue && (text(clue.value) || clue.days !== undefined || text(clue.day_part) || clue.present !== undefined)); }
function validateClue(kind, raw, utterance, state, removed, mentions) {
  const input = object(raw); const output = {}; const supportedValue = supportedTextFact(kind, input.value, utterance, state, mentions);
  if (supportedValue) Object.assign(output, supportedValue); else if (text(input.value)) removed.push(`${kind}.value`);
  const currentDayPart = dayPartFromUtterance(utterance);
  const activeDayPart = text(stateClue(state, kind).day_part || (kind === 'recency' ? stateClue(state, 'recency').value : ''), 20).toLowerCase();
  if (input.day_part) {
    const proposed = text(input.day_part, 20).toLowerCase();
    if (currentDayPart?.day_part === proposed) Object.assign(output, { day_part: proposed, ...evidence('utterance', currentDayPart.evidence_text) });
    else if (activeDayPart === proposed) Object.assign(output, { day_part: proposed, ...evidence('conversation_state', proposed) });
    else removed.push(`${kind}.day_part`);
  }
  const relative = relativeTimeFromUtterance(utterance);
  if (input.days !== undefined) {
    const proposed = Number(input.days); const activeDays = Number(stateClue(state, kind).days);
    if (relative && Math.abs(proposed - relative.days) <= 7) Object.assign(output, { days: relative.days, certainty: relative.certainty, ...evidence('utterance', relative.evidence_text, 'uncertain') });
    else if (Number.isFinite(activeDays) && proposed === activeDays) Object.assign(output, { days: proposed, ...evidence('conversation_state', String(proposed), input.certainty === 'approximate' ? 'uncertain' : 'safe') });
    else removed.push(`${kind}.days`);
  }
  if (typeof input.present === 'boolean') {
    const terms = kind === 'visit' ? ['visita', 'visitado'] : kind === 'location' ? ['ubicacion', 'direccion'] : [];
    if (terms.some(term => phrasePresent(utterance, term))) Object.assign(output, { present: input.present, ...evidence('utterance', terms.find(term => phrasePresent(utterance, term))) });
    else if (stateClue(state, kind).present === input.present) Object.assign(output, { present: input.present, ...evidence('conversation_state', kind) });
    else removed.push(`${kind}.present`);
  }
  if (!meaningfulClue(output)) return null;
  output.certainty = output.certainty || (text(input.certainty, 20) === 'approximate' ? 'approximate' : 'confirmed');
  if (!output.source) Object.assign(output, evidence('unknown', null, 'unsupported'));
  return output;
}
function uniqueClues(values) {
  const seen = new Set(); const result = [];
  for (const clue of values.filter(Boolean)) {
    const key = JSON.stringify([clue.value || null, clue.days ?? null, clue.day_part || null, clue.present ?? null]);
    if (!seen.has(key)) { seen.add(key); result.push(clue); }
  }
  return result;
}

function hardenUnderstanding({ understanding, utterance, state = {} } = {}) {
  const source = object(understanding); const removed = []; const rejectedFacts = []; const normalizedFields = [];
  const entityMentions = typedMentions(source, utterance, state); const constraints = {};
  for (const key of ['name', 'district', 'service', 'location', 'visit', 'recency']) {
    const validated = validateClue(key, source.constraints?.[key], utterance, state, removed, entityMentions);
    if (validated) constraints[key] = validated;
  }
  const rawConstraintName = object(source.constraints?.name).value; const constraintNameType = classifyEvidenceType(rawConstraintName, utterance);
  if (text(rawConstraintName) && constraintNameType.type !== 'unknown') rejectedFacts.push({ field: 'constraints.name.value', reason: 'evidence_type_conflict', evidence_type: constraintNameType.type });
  else if (text(rawConstraintName) && !constraints.name) rejectedFacts.push({ field: 'constraints.name.value', reason: 'typed_proper_name_required', evidence_type: 'unknown' });
  const explicitService = serviceFromUtterance(utterance);
  if (explicitService) { constraints.service = { value: explicitService.value, certainty: 'confirmed', ...evidence('utterance', explicitService.evidence_text) }; normalizedFields.push('service'); }
  const explicitDayPart = dayPartFromUtterance(utterance); const explicitRelative = relativeTimeFromUtterance(utterance);
  if (explicitDayPart || explicitRelative) {
    constraints.recency = { ...(explicitRelative ? { days: explicitRelative.days, certainty: explicitRelative.certainty } : { certainty: 'confirmed' }), ...(!explicitRelative && explicitDayPart?.days !== undefined ? { days: explicitDayPart.days } : {}), ...(explicitDayPart ? { day_part: explicitDayPart.day_part } : {}), ...evidence('utterance', explicitDayPart?.evidence_text || explicitRelative?.evidence_text, explicitRelative ? 'uncertain' : 'safe') };
    normalizedFields.push('recency');
  }
  const temporal = uniqueClues((source.temporal_clues || []).map(item => validateClue('recency', item, utterance, state, removed, entityMentions)));
  if (explicitDayPart || explicitRelative) temporal.splice(0, temporal.length, { certainty: explicitRelative?.certainty || 'confirmed', ...(explicitRelative ? { days: explicitRelative.days } : {}), ...(!explicitRelative && explicitDayPart?.days !== undefined ? { days: explicitDayPart.days } : {}), ...(explicitDayPart ? { day_part: explicitDayPart.day_part } : {}), ...evidence('utterance', explicitDayPart?.evidence_text || explicitRelative?.evidence_text, explicitRelative ? 'uncertain' : 'safe') });
  const locations = uniqueClues((source.location_clues || []).map(item => validateClue('location', item, utterance, state, removed, entityMentions)));
  const services = uniqueClues((source.service_clues || []).map(item => validateClue('service', item, utterance, state, removed, entityMentions)));
  if (explicitService) services.splice(0, services.length, constraints.service);
  const rawReference = object(source.target_reference); const targetReference = {};
  const candidateName = rawReference.name || constraints.name?.value; const referenceNameType = classifyEvidenceType(candidateName, utterance); const supportedName = properNameMention(candidateName, entityMentions, utterance, state);
  if (supportedName) Object.assign(targetReference, { name: supportedName.value, ...evidence(supportedName.source, supportedName.evidence_text, supportedName.semantic_safety) });
  else if (text(rawReference.name)) { removed.push('target_reference.name'); rejectedFacts.push({ field: 'target_reference.name', reason: referenceNameType.type === 'unknown' ? 'typed_proper_name_required' : 'evidence_type_conflict', evidence_type: referenceNameType.type }); }
  const historicalRelationship = historicalRelationshipFromUtterance(utterance); if (historicalRelationship) targetReference.relation = 'historical_customer';
  let act = text(source.conversational_act, 40).toLowerCase() || 'unknown'; const utteranceNormalized = normalized(utterance);
  if (/\b(cancela|cancelar|dejalo)\b/.test(utteranceNormalized)) act = 'cancellation';
  let cancelScope = text(source.cancel_scope, 32).toLowerCase() || 'none';
  if (act === 'cancellation') {
    const explicitScope = /\b(visita|cita|agenda)\b/.test(utteranceNormalized) ? 'agenda' : /\b(tarea|busqueda|seguimiento)\b/.test(utteranceNormalized) ? 'task' : null;
    cancelScope = explicitScope || (text(object(state).task, 80) ? 'task' : 'unknown');
  }
  const hasName = Boolean(targetReference.name || constraints.name?.value); const hasDisambiguator = Boolean(constraints.district || constraints.service || constraints.location || constraints.recency || temporal.length); const referenceSpecificity = hasName ? (hasDisambiguator ? 'specific' : 'partial') : 'unknown';
  const approximate = [...Object.values(constraints), ...temporal].some(item => item?.certainty === 'approximate'); const hasUsefulFact = Boolean(hasName || hasDisambiguator || historicalRelationship || act !== 'unknown'); const semanticSafety = !hasUsefulFact ? 'unsupported' : removed.length || approximate || referenceSpecificity === 'partial' || cancelScope === 'unknown' ? 'uncertain' : 'safe';
  return { ...source, schema: HARDENED_SCHEMA, conversational_act: act, entity_mentions: entityMentions, target_reference: targetReference, constraints, cancel_scope: cancelScope, temporal_clues: temporal, location_clues: locations, service_clues: services, ambiguity: false, reference_specificity: referenceSpecificity, historical_relationship: historicalRelationship, semantic_safety: semanticSafety, semantic_guard: { removed_fact_count: removed.length, removed_fields: [...new Set(removed)].slice(0, 16), rejected_facts: rejectedFacts.slice(0, 16), normalized_fields: [...new Set(normalizedFields)] } };
}

module.exports = { HARDENED_SCHEMA, PREVIOUS_HARDENED_SCHEMA, MENTION_KINDS, SERVICE_ALIASES, canonicalService, classifyEvidenceType, dayPartFromUtterance, relativeTimeFromUtterance, hardenUnderstanding };
