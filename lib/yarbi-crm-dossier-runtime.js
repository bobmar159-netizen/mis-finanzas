'use strict';

// Expediente de lectura: compone datos ya existentes sin crear identidades,
// tareas, mensajes ni efectos comerciales. El contacto solicitado se vuelve a
// contrastar con el scope canónico antes de leer sus fuentes.
const { buildClientDossier } = require('./yarbi-client-dossier');
const { loadScopedCrmSources, normalizeScope } = require('./yarbi-crm-search-runtime');
const { verifiedOwnerId } = require('./yarbi-owner-scope');
const { summarizeAgenda } = require('./yarbi-agenda-intelligence');
const { buildFinanceContext } = require('./yarbi-finance-context');
const { buildBusinessTimeline } = require('./yarbi-business-timeline');

const DOSSIER_SCHEMA = 'yarbi.crm-dossier.v1';
const MAX_TIMELINE_ITEMS = 24;

function integer(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function text(value, limit = 600) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function array(value) { return Array.isArray(value) ? value : []; }
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
  const activities = summarizeAgenda(byContact(sources.agenda, requestedContactId), { contactId: requestedContactId });
  const finance = buildFinanceContext({ contactId: requestedContactId, analyses: sources.analyses, receivables: sources.receivables, movements: null });
  const timeline = buildBusinessTimeline({ sources, contactId: requestedContactId, limit: MAX_TIMELINE_ITEMS });
  return { schema: DOSSIER_SCHEMA, outcome: 'dossier_found', contact_id: requestedContactId, dossier, activities, finance, timeline: timeline.events, timeline_meta: { schema: timeline.schema, outcome: timeline.outcome, source_status: timeline.source_status }, source_status: metrics.sources, metrics: { query_count: metrics.query_count }, scope: { verified: 'canonical_owner_contact_scope', contact_count: scope.ids.length } };
}

module.exports = { DOSSIER_SCHEMA, MAX_TIMELINE_ITEMS, getScopedCrmDossier, timelineFrom: (sources, contactId) => buildBusinessTimeline({ sources, contactId, limit: MAX_TIMELINE_ITEMS }).events };
