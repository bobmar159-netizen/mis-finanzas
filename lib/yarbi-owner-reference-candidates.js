'use strict';

// Recuperación de candidatos para el dueño. Es lectura acotada: no decide,
// no escribe y no intenta deducir quién es dueño de qué contacto.
const { SERVICES } = require('./yarbi-commercial-context');
const { createCanonicalOwnerScopeResolver, verifiedOwnerId } = require('./yarbi-owner-scope');
const { createScopedAsyncCache } = require('./yarbi-scoped-cache');

const SCHEMA = 'yarbi.owner-reference-candidates.v2';
const MAX_SCOPE_CONTACTS = 96;
const MAX_CANDIDATES = 8;
// Cache efímero de proceso: sus claves se hashean y siempre se crea después
// de verificar el scope canónico del dueño.
const ownerCandidateCache = createScopedAsyncCache({ ttlMs: 15000, maxEntries: 96 });
const SERVICE_SET = new Set(SERVICES);
const TIME_BANDS = Object.freeze({
  morning: { startHour: 6, endHour: 12 },
  afternoon: { startHour: 12, endHour: 18 },
  evening: { startHour: 18, endHour: 24 },
  night: { startHour: 18, endHour: 24 }
});

function text(value, limit = 160) { return String(value ?? '').trim().slice(0, limit); }
function integer(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function iso(value) { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
function normalized(value) { return text(value, 120).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function sameText(a, b) { const left = normalized(a); const right = normalized(b); return Boolean(left && right && (left === right || left.includes(right) || right.includes(left))); }
function csv(ids) { return encodeURIComponent(ids.join(',')); }
function one(value) { return encodeURIComponent(text(value, 100)); }

// El llamador real debe proveer un scope obtenido desde la futura relación
// canónica owner_contact_scope/RPC. Esta fábrica existe únicamente para tests.
function createFixtureOwnerScopeResolver(scopes) {
  const byOwner = object(scopes);
  return async ownerId => byOwner[text(ownerId, 160)] || null;
}

function normalizeVerifiedScope(ownerId, source) {
  const scope = object(source);
  const ids = [...new Set((Array.isArray(scope.contact_ids) ? scope.contact_ids : []).map(integer).filter(Boolean))];
  if (text(ownerId, 160) !== text(scope.owner_id, 160)) return { ok: false, code: 'owner_scope_unavailable', ids: [] };
  if (scope.verification !== 'canonical_owner_contact_scope' && scope.verification !== 'fixture_owner_scope') return { ok: false, code: 'owner_scope_unverified', ids: [] };
  if (!ids.length) return { ok: false, code: 'owner_scope_empty', ids: [] };
  if (ids.length > MAX_SCOPE_CONTACTS) return { ok: false, code: 'owner_scope_too_broad', ids: [] };
  return { ok: true, ids, provenance: text(scope.provenance, 80) || scope.verification };
}

async function resolveScope({ ownerId, ownerScopeResolver, conversationState }) {
  const cached = object(conversationState).verified_owner_scope;
  if (cached && cached.reuse_allowed === true) return normalizeVerifiedScope(ownerId, cached);
  if (typeof ownerScopeResolver !== 'function') return { ok: false, code: 'owner_scope_unavailable', ids: [] };
  return normalizeVerifiedScope(ownerId, await ownerScopeResolver(ownerId));
}

function constraintsFor(understanding = {}, state = {}) {
  return { ...object(state.active_constraints), ...object(understanding.constraints), ...object(understanding.target_reference) };
}

function localParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const values = Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function zonedUtc(parts, timeZone) {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute || 0, parts.second || 0);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observed = localParts(new Date(guess), timeZone);
    const expectedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute || 0, parts.second || 0);
    const observedUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    guess += expectedUtc - observedUtc;
  }
  return new Date(guess);
}

function shiftedDay(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function temporalRange(constraints, understanding, now, timeZone) {
  const recency = object(constraints.recency || constraints.last_contact);
  const temporal = Array.isArray(understanding.temporal_clues) ? understanding.temporal_clues : [];
  const clue = temporal.find(item => item && (Number.isFinite(Number(item.days)) || text(item.day_part, 20))) || recency;
  const days = Number(clue?.days);
  const dayPart = text(clue?.day_part, 20).toLowerCase();
  if (dayPart) {
    if (!timeZone) return { error: 'timezone_required' };
    try { Intl.DateTimeFormat('en-US', { timeZone }).format(now); } catch (_) { return { error: 'timezone_invalid' }; }
    const target = shiftedDay(localParts(now, timeZone), Number.isFinite(days) ? days : 0);
    const band = TIME_BANDS[dayPart];
    if (!band) return { error: 'time_band_unsupported' };
    const from = zonedUtc({ ...target, hour: band.startHour, minute: 0, second: 0 }, timeZone);
    const endTarget = band.endHour === 24 ? shiftedDay(target, -1) : target;
    const to = zonedUtc({ ...endTarget, hour: band.endHour === 24 ? 0 : band.endHour, minute: 0, second: 0 }, timeZone);
    return { from: from.toISOString(), to: to.toISOString(), approximate: false, time_band: dayPart, timezone: timeZone };
  }
  if (!Number.isFinite(days)) return null;
  const approximate = clue?.certainty === 'approximate';
  const tolerance = approximate ? 21 : 3;
  const base = new Date(now).getTime();
  return { from: new Date(base - (days + tolerance) * 86400000).toISOString(), to: new Date(base - Math.max(0, days - tolerance) * 86400000).toISOString(), approximate };
}

async function rows(supabase, path, code, metrics) {
  metrics.query_count += 1;
  const result = await supabase(path);
  if (!result?.response?.ok) { const error = new Error(code); error.code = code; throw error; }
  return Array.isArray(result.data) ? result.data : [];
}

function activeCandidateRows(state, scope) {
  return (Array.isArray(state.active_candidates) ? state.active_candidates : [])
    .filter(row => scope.ids.includes(integer(row?.contact_id)))
    .map(row => ({ ...row, source: { conversation_state: true } }));
}

function queryForContacts(ids, constraints, range, limit) {
  const select = 'id,full_name,display_name,commercial_status,latest_service,last_contact_at';
  const parts = ['/rest/v1/crm_contacts?select=' + select, 'id=in.(' + csv(ids) + ')'];
  const exactId = integer(constraints.contact_id || constraints.id);
  if (exactId) parts.push('id=eq.' + exactId);
  const name = text(constraints.name?.value || constraints.name, 80);
  if (name) parts.push('or=(display_name.ilike.*' + encodeURIComponent(name) + '*,full_name.ilike.*' + encodeURIComponent(name) + '*)');
  const service = text(constraints.service?.value || constraints.service, 64);
  if (service && SERVICE_SET.has(service)) parts.push('latest_service=eq.' + one(service));
  if (range?.from) { parts.push('last_contact_at=gte.' + encodeURIComponent(range.from)); parts.push('last_contact_at=lt.' + encodeURIComponent(range.to)); }
  parts.push('order=last_contact_at.desc.nullslast', 'limit=' + Math.min(limit, MAX_CANDIDATES));
  return parts.join('&');
}

function districtQuery(ids, district) {
  return '/rest/v1/yarbi_contact_operational_memory?contact_id=in.(' + csv(ids) + ')&memory_type=eq.district&state=eq.active&value->>district=eq.' + one(district) + '&select=contact_id,memory_type,value,occurred_at&order=occurred_at.desc&limit=' + Math.min(ids.length, MAX_SCOPE_CONTACTS);
}

function factByType(memory = []) {
  const facts = {};
  for (const row of memory) if (!facts[row?.contact_id] || !facts[row.contact_id][row.memory_type]) {
    if (!facts[row?.contact_id]) facts[row.contact_id] = {};
    facts[row.contact_id][row.memory_type] = { value: object(row.value), source: 'operational_memory', occurred_at: iso(row.occurred_at) };
  }
  return facts;
}

function compactCandidate(contact, identifiers, facts) {
  const id = integer(contact?.id); const memory = facts[id] || {};
  const district = text(memory.district?.value?.district, 100) || null;
  const location = object(memory.location?.value);
  const service = SERVICE_SET.has(text(contact?.latest_service, 64)) ? text(contact.latest_service, 64) : null;
  const phones = identifiers.filter(row => integer(row.contact_id) === id && row.identifier_type === 'phone')
    .map(row => text(row.normalized_value || row.identifier_value, 40).replace(/\D/g, '')).filter(Boolean);
  return {
    contact_id: id, display_name: text(contact.display_name || contact.full_name, 160) || null,
    phones: [...new Set(phones)], district,
    location_label: text(location.label || location.address || location.url, 160) || null,
    has_location: Boolean(location.url || location.latitude || location.longitude || location.label || location.address), service,
    process_status: text(memory.pending_step?.value?.step, 80) || null,
    commercial_temperature: text(contact.commercial_status, 32) || null, last_contact_at: iso(contact.last_contact_at), visits: [], historical_services: [],
    sources: { district: district ? 'operational_memory' : null, location: Object.keys(location).length ? 'operational_memory' : null, service: service ? 'crm_contacts' : null, last_contact_at: contact.last_contact_at ? 'crm_contacts' : null, visit: 'not_available', historical_services: 'not_available' }
  };
}

function filtersMatch(candidate, constraints, understanding, now, timeZone) {
  const name = text(constraints.name?.value || constraints.name); const district = text(constraints.district?.value || constraints.district);
  if (name && !sameText(candidate.display_name, name)) return false;
  if (district && !sameText(candidate.district, district)) return false;
  const service = text(constraints.service?.value || constraints.service);
  if (service && candidate.service !== service) return false;
  const range = temporalRange(constraints, understanding, now, timeZone);
  if (range?.from && candidate.last_contact_at) { const value = new Date(candidate.last_contact_at).getTime(); if (value < new Date(range.from).getTime() || value >= new Date(range.to).getTime()) return false; }
  return true;
}

async function getOwnerReferenceCandidates({ supabase, ownerId, ownerScopeResolver, understanding = {}, conversationState = {}, now = new Date(), timeZone, limit = MAX_CANDIDATES, cache = ownerCandidateCache } = {}) {
  const started = performance.now();
  const metrics = { query_count: 0, candidates_considered: 0, candidates_recovered: 0, reused_conversation_candidates: false, candidate_query_ms: 0, enrichment_ms: 0, adapter_ms: 0, cache: 'disabled' };
  const finish = (outcome, candidates = []) => ({ schema: SCHEMA, outcome, candidates, metrics: { ...metrics, adapter_ms: performance.now() - started } });
  const scope = await resolveScope({ ownerId, ownerScopeResolver, conversationState });
  if (!scope.ok) return finish(scope.code);
  const reused = activeCandidateRows(conversationState, scope);
  if (reused.length) { metrics.candidates_considered = reused.length; metrics.candidates_recovered = reused.length; metrics.reused_conversation_candidates = true; return finish('reused_conversation_candidates', reused.slice(0, limit)); }
  if (typeof supabase !== 'function') { const error = new Error('owner_candidate_store_unavailable'); error.code = error.message; throw error; }
  const constraints = constraintsFor(understanding, conversationState);
  const range = temporalRange(constraints, understanding, now, timeZone);
  if (range?.error) return finish(range.error);
  const load = async () => {
    const candidateQueryStarted = performance.now();
    const phone = text(constraints.phone, 40).replace(/\D/g, '');
    const district = text(constraints.district?.value || constraints.district, 100);
    let eligibleIds = scope.ids;
    let districtMemory = [];
    if (!phone && district) {
      districtMemory = await rows(supabase, districtQuery(scope.ids, district), 'owner_candidate_district_read_failed', metrics);
      eligibleIds = [...new Set(districtMemory.map(row => integer(row.contact_id)).filter(id => scope.ids.includes(id)))];
      if (!eligibleIds.length) { metrics.candidate_query_ms = performance.now() - candidateQueryStarted; return { outcome:'no_candidates', candidates:[] }; }
    }
    let seedIdentifiers = [];
    if (phone.length >= 6) {
      seedIdentifiers = await rows(supabase, '/rest/v1/contact_identifiers?contact_id=in.(' + csv(scope.ids) + ')&identifier_type=eq.phone&normalized_value=eq.' + encodeURIComponent(phone) + '&select=contact_id,identifier_type,identifier_value,normalized_value,is_primary&limit=' + Math.min(limit, MAX_CANDIDATES), 'owner_candidate_identifier_read_failed', metrics);
      seedIdentifiers = seedIdentifiers.filter(row => text(row?.normalized_value || row?.identifier_value, 40).replace(/\D/g, '') === phone);
      eligibleIds = seedIdentifiers.map(row => integer(row.contact_id)).filter(id => scope.ids.includes(id));
      if (!eligibleIds.length) { metrics.candidate_query_ms = performance.now() - candidateQueryStarted; return { outcome:'no_candidates', candidates:[] }; }
    }
    const contactRows = await rows(supabase, queryForContacts(eligibleIds, constraints, range, limit), 'owner_candidate_contact_read_failed', metrics);
    metrics.candidate_query_ms = performance.now() - candidateQueryStarted;
    const ids = contactRows.map(row => integer(row.id)).filter(id => eligibleIds.includes(id));
    metrics.candidates_considered = ids.length;
    if (!ids.length) return { outcome:'no_candidates', candidates:[] };
    const enrichmentStarted = performance.now();
    const [readIdentifiers, memory] = await Promise.all([
      phone.length >= 6 ? Promise.resolve(seedIdentifiers) : rows(supabase, '/rest/v1/contact_identifiers?contact_id=in.(' + csv(ids) + ')&identifier_type=eq.phone&select=contact_id,identifier_type,identifier_value,normalized_value,is_primary&order=is_primary.desc&limit=' + Math.min(ids.length * 4, 32), 'owner_candidate_identifier_read_failed', metrics),
      rows(supabase, '/rest/v1/yarbi_contact_operational_memory?contact_id=in.(' + csv(ids) + ')&state=eq.active&select=contact_id,memory_type,value,occurred_at&order=contact_id.asc,occurred_at.desc&limit=' + Math.min(ids.length * 8, 64), 'owner_candidate_memory_read_failed', metrics)
    ]);
    metrics.enrichment_ms = performance.now() - enrichmentStarted;
    const facts = factByType([...districtMemory, ...memory]);
    const candidates = contactRows.map(row => compactCandidate(row, readIdentifiers, facts)).filter(row => filtersMatch(row, constraints, understanding, now, timeZone)).slice(0, Math.min(limit, MAX_CANDIDATES));
    metrics.candidates_recovered = candidates.length;
    return { outcome:candidates.length ? 'candidates_found' : 'no_candidates', candidates };
  };
  if (!cache || typeof cache.getOrLoad !== 'function') {
    const result = await load();
    return finish(result.outcome, result.candidates);
  }
  const cached = await cache.getOrLoad({
    ownerId,
    contactIds: scope.ids,
    key: { ids:[...scope.ids].sort((a,b) => a-b), constraints, range, timeZone:text(timeZone,80), limit },
    load
  });
  metrics.cache = cached.cache;
  return finish(cached.value.outcome, cached.value.candidates);
}

function invalidateOwnerReferenceCandidates({ ownerId, contactId } = {}) {
  return ownerCandidateCache.invalidate({ ownerId, contactId });
}

// Entrada de producción para una sesión del dueño: el sujeto procede de la
// autenticación validada del backend. No expone ownerId ni contact_ids al
// cliente; el scope se lee solamente desde la relación canónica.
async function getAuthenticatedOwnerReferenceCandidates({ supabase, authenticatedIdentity, understanding = {}, conversationState = {}, now = new Date(), timeZone, limit = MAX_CANDIDATES } = {}) {
  const started = performance.now();
  const ownerId = verifiedOwnerId(authenticatedIdentity);
  const ownerScopeResolver = createCanonicalOwnerScopeResolver({ supabase });
  let scopeMs = 0;
  const result = await getOwnerReferenceCandidates({
    supabase,
    ownerId,
    ownerScopeResolver: async () => {
      const scopeStarted = performance.now();
      try { return await ownerScopeResolver(authenticatedIdentity); }
      finally { scopeMs = performance.now() - scopeStarted; }
    },
    understanding,
    conversationState,
    now,
    timeZone,
    limit
  });
  return { ...result, metrics: { ...(result.metrics || {}), scope_ms: scopeMs, authenticated_adapter_ms: performance.now() - started } };
}

module.exports = { SCHEMA, MAX_CANDIDATES, TIME_BANDS, createFixtureOwnerScopeResolver, getOwnerReferenceCandidates, getAuthenticatedOwnerReferenceCandidates, invalidateOwnerReferenceCandidates, temporalRange };
