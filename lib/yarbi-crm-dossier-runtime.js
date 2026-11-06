'use strict';

// Expediente de lectura: compone datos ya existentes sin crear identidades,
// tareas, mensajes ni efectos comerciales. El contacto solicitado se vuelve a
// contrastar con el scope canónico antes de leer sus fuentes.
const { buildClientDossier } = require('./yarbi-client-dossier');
const { loadScopedCrmSources, normalizeScope } = require('./yarbi-crm-search-runtime');
const { verifiedOwnerId } = require('./yarbi-owner-scope');

const DOSSIER_SCHEMA = 'yarbi.crm-dossier.v1';
const MAX_TIMELINE_ITEMS = 24;

function integer(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function text(value, limit = 600) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function array(value) { return Array.isArray(value) ? value : []; }
function dateValue(value) { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; }
function byContact(rows, contactId) { return array(rows).filter(row => integer(row?.contact_id) === contactId); }

function phoneFor(identifiers, contactId) {
  const preferred = byContact(identifiers, contactId).sort((left, right) => Number(Boolean(right?.is_primary)) - Number(Boolean(left?.is_primary)))[0];
  return text(preferred?.normalized_value || preferred?.identifier_value, 40).replace(/\D/g, '');
}

function memoryFor(rows) {
  const memory = {};
  for (const row of rows) {
    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    if (row?.memory_type === 'service' && !memory.latest_service) memory.latest_service = text(value.service, 120);
    if (row?.memory_type === 'pending_step' && !memory.follow_up_status) memory.follow_up_status = text(value.step, 240);
    if (row?.memory_type === 'summary' && !memory.summary) memory.summary = text(value.summary || value.text, 420);
  }
  return memory;
}

function timelineFrom(sources, contactId) {
  const events = [];
  for (const row of byContact(sources.messages, contactId)) events.push({ kind: 'message', at: row.timestamp || row.created_at || null, label: text(row.title, 120) || 'Mensaje recibido', detail: text(row.text, 500), source_id: row.id == null ? null : String(row.id) });
  for (const row of byContact(sources.analyses, contactId)) events.push({ kind: 'analysis', at: row.completed_at || row.updated_at || null, label: text(row.service, 120) || text(row.intent, 120) || 'Análisis', detail: text(row.intent, 160), source_id: row.id == null ? null : String(row.id) });
  for (const row of byContact(sources.agenda, contactId)) events.push({ kind: 'agenda', at: row.starts_at || row.updated_at || null, label: text(row.service, 120) || 'Visita', detail: text(row.status, 100) || text(row.description, 500), source_id: row.id == null ? null : String(row.id) });
  for (const row of byContact(sources.receivables, contactId)) events.push({ kind: 'receivable', at: row.updated_at || row.next_action_due || null, label: 'Cobranza', detail: [text(row.status, 100), text(row.next_action, 240)].filter(Boolean).join(' · '), source_id: row.id == null ? null : String(row.id) });
  for (const row of byContact(sources.observations, contactId)) events.push({ kind: 'observation', at: row.observed_at || row.created_at || null, label: text(row.category, 120) || 'Dato verificado', detail: text(row.value, 300), source_id: row.id == null ? null : String(row.id) });
  return events.filter(event => event.label || event.detail).sort((left, right) => dateValue(right.at) - dateValue(left.at)).slice(0, MAX_TIMELINE_ITEMS);
}

async function loadObservations(supabase, contactId, metrics) {
  metrics.query_count += 1;
  const result = await supabase('/rest/v1/yarbi_contact_observations?contact_id=eq.' + encodeURIComponent(String(contactId)) + '&status=eq.active&select=id,contact_id,observation_type,category,value,status,source_message_ids,observed_at&order=observed_at.desc&limit=24');
  if (!result?.response?.ok) { metrics.sources.observations = 'unavailable'; return []; }
  metrics.sources.observations = 'available';
  return array(result.data);
}

async function getScopedCrmDossier({ supabase, validatedIdentity, ownerScopeResolver, contactId } = {}) {
  if (typeof supabase !== 'function' || typeof ownerScopeResolver !== 'function') {
    const error = new Error('crm_dossier_store_unavailable'); error.code = error.message; throw error;
  }
  const requestedContactId = integer(contactId);
  if (!requestedContactId) return { schema: DOSSIER_SCHEMA, outcome: 'contact_id_invalid', dossier: null, timeline: [], source_status: {} };
  const ownerId = verifiedOwnerId(validatedIdentity);
  const scope = normalizeScope(ownerId, await ownerScopeResolver(validatedIdentity));
  if (!scope.ok) return { schema: DOSSIER_SCHEMA, outcome: scope.code, dossier: null, timeline: [], source_status: {}, scope: { verified: 'canonical_owner_contact_scope', contact_count: 0 } };
  if (!scope.ids.includes(requestedContactId)) return { schema: DOSSIER_SCHEMA, outcome: 'contact_not_in_owner_scope', dossier: null, timeline: [], source_status: {}, scope: { verified: 'canonical_owner_contact_scope', contact_count: scope.ids.length } };
  const metrics = { query_count: 0, sources: {} };
  const sources = await loadScopedCrmSources({ supabase, contactIds: [requestedContactId], metrics });
  sources.observations = await loadObservations(supabase, requestedContactId, metrics);
  const contact = array(sources.contacts).find(row => integer(row?.id) === requestedContactId);
  if (!contact) return { schema: DOSSIER_SCHEMA, outcome: 'contact_not_found', dossier: null, timeline: [], source_status: metrics.sources, scope: { verified: 'canonical_owner_contact_scope', contact_count: scope.ids.length } };
  const dossier = buildClientDossier({
    contact: { ...contact, id: requestedContactId }, phone: phoneFor(sources.identifiers, requestedContactId),
    memory: memoryFor(byContact(sources.memory, requestedContactId)), observations: byContact(sources.observations, requestedContactId),
    analyses: byContact(sources.analyses, requestedContactId), messages: byContact(sources.messages, requestedContactId), agenda: byContact(sources.agenda, requestedContactId)
  });
  return { schema: DOSSIER_SCHEMA, outcome: 'dossier_found', contact_id: requestedContactId, dossier, timeline: timelineFrom(sources, requestedContactId), source_status: metrics.sources, metrics: { query_count: metrics.query_count }, scope: { verified: 'canonical_owner_contact_scope', contact_count: scope.ids.length } };
}

module.exports = { DOSSIER_SCHEMA, MAX_TIMELINE_ITEMS, getScopedCrmDossier, timelineFrom };
