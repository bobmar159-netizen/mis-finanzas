'use strict';

const { searchClients } = require('./yarbi-client-search');
const { createScopedAsyncCache } = require('./yarbi-scoped-cache');
const { verifiedOwnerId } = require('./yarbi-owner-scope');

const CRM_SEARCH_SCHEMA = 'yarbi.crm-search.v1';
const MAX_SCOPE_CONTACTS = 96;
const MAX_PAGE_SIZE = 12;
const crmSearchCache = createScopedAsyncCache({ ttlMs: 15000, maxEntries: 96 });

function text(value, limit = 240) { return String(value ?? '').trim().slice(0, limit); }
function integer(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function csv(ids) { return encodeURIComponent([...new Set(ids.map(integer).filter(Boolean))].join(',')); }
function bounded(value, fallback, maximum) { return Math.min(Math.max(Number(value) || fallback, 1), maximum); }

function normalizeScope(ownerId, scope) {
  const source = object(scope);
  const ids = [...new Set(array(source.contact_ids).map(integer).filter(Boolean))];
  if (text(source.owner_id, 160) !== ownerId || source.verification !== 'canonical_owner_contact_scope') return { ok: false, code: 'owner_scope_unverified', ids: [] };
  if (!ids.length) return { ok: false, code: 'owner_scope_empty', ids: [] };
  if (ids.length > MAX_SCOPE_CONTACTS) return { ok: false, code: 'owner_scope_too_broad', ids: [] };
  return { ok: true, ids };
}

async function readRows(supabase, path, metrics, source, optional = false) {
  metrics.query_count += 1;
  const result = await supabase(path);
  if (!result?.response?.ok) {
    metrics.sources[source] = 'unavailable';
    if (optional) return [];
    const error = new Error('crm_search_' + source + '_read_failed');
    error.code = error.message;
    throw error;
  }
  metrics.sources[source] = 'available';
  return array(result.data);
}

function safeValue(value) {
  if (value && typeof value === 'object') return JSON.stringify(value).slice(0, 1000);
  return text(value, 1000);
}

function recordsFromRows({ ownerId, contacts, identifiers, memory, messages, analyses, agenda, receivables }) {
  const byContact = new Map();
  for (const row of contacts) {
    const id = integer(row?.id);
    if (!id) continue;
    byContact.set(id, {
      id,
      owner_id: ownerId,
      display_name: text(row.display_name, 160) || null,
      full_name: text(row.full_name, 160) || null,
      commercial_status: text(row.commercial_status, 32) || 'frio',
      operational_status: text(row.operational_status, 64) || '',
      latest_service: text(row.latest_service, 80) || null,
      last_contact_at: row.last_contact_at || null,
      updated_at: row.updated_at || null,
      phones: [], history: [], historical_services: [], traits: [], quote: '', pending_step: ''
    });
  }
  for (const row of identifiers) {
    const contact = byContact.get(integer(row?.contact_id));
    const phone = text(row?.normalized_value || row?.identifier_value, 40).replace(/\D/g, '');
    if (contact && phone) contact.phones.push(phone);
  }
  for (const row of memory) {
    const contact = byContact.get(integer(row?.contact_id));
    if (!contact) continue;
    const value = object(row?.value);
    if (row?.memory_type === 'district') contact.district = text(value.district, 100) || contact.district;
    if (row?.memory_type === 'location') contact.location = text(value.label || value.address, 180) || contact.location;
    if (row?.memory_type === 'pending_step') contact.pending_step = text(value.step, 100) || contact.pending_step;
    if (row?.memory_type === 'service') contact.historical_services.push(text(value.service, 80));
    if (row?.memory_type === 'customer_commitment' || row?.memory_type === 'objection') contact.traits.push(safeValue(value));
  }
  for (const row of messages) {
    const contact = byContact.get(integer(row?.contact_id));
    if (contact) contact.history.push(text(row?.text || row?.title, 1000));
  }
  for (const row of analyses) {
    const contact = byContact.get(integer(row?.contact_id));
    if (!contact) continue;
    contact.historical_services.push(text(row?.service, 80));
    contact.history.push([text(row?.intent, 80), text(row?.service, 80), safeValue(row?.extracted_data)].filter(Boolean).join(' '));
    const extracted = object(row?.extracted_data);
    const quote = text(extracted.quote || extracted.cotizacion || extracted.price || extracted.amount, 120);
    if (quote) contact.quote += ' ' + quote;
  }
  for (const row of agenda) {
    const contact = byContact.get(integer(row?.contact_id));
    if (!contact) continue;
    contact.historical_services.push(text(row?.service, 80));
    contact.history.push([text(row?.service, 80), text(row?.status, 60), text(row?.description, 600)].filter(Boolean).join(' '));
  }
  for (const row of receivables) {
    const contact = byContact.get(integer(row?.contact_id));
    if (!contact) continue;
    contact.quote += ' ' + [text(row?.status, 60), text(row?.next_action, 120), text(row?.agreed_amount, 40), text(row?.balance_amount, 40)].filter(Boolean).join(' ');
  }
  return [...byContact.values()].map(row => ({
    ...row,
    phones: [...new Set(row.phones)],
    history: row.history.filter(Boolean).slice(0, 8),
    historical_services: [...new Set(row.historical_services.filter(Boolean))].slice(0, 8),
    traits: [...new Set(row.traits.filter(Boolean))].slice(0, 8)
  }));
}

async function loadScopedCrmRecords({ supabase, ownerId, contactIds, metrics }) {
  const sources = await loadScopedCrmSources({ supabase, contactIds, metrics });
  return recordsFromRows({ ownerId, ...sources });
}

// Fuente de lectura compartida por el buscador y el expediente. Todas las
// consultas reciben IDs que ya provinieron del scope canónico del owner; nunca
// de un identificador aportado por el navegador.
async function loadScopedCrmSources({ supabase, contactIds, metrics }) {
  const scoped = csv(contactIds);
  const [contacts, identifiers, memory, messages, analyses, agenda, receivables] = await Promise.all([
    readRows(supabase, '/rest/v1/crm_contacts?id=in.(' + scoped + ')&select=id,full_name,display_name,commercial_status,latest_service,last_contact_at,updated_at&order=last_contact_at.desc.nullslast&limit=' + MAX_SCOPE_CONTACTS, metrics, 'contacts'),
    readRows(supabase, '/rest/v1/contact_identifiers?contact_id=in.(' + scoped + ')&identifier_type=eq.phone&select=contact_id,identifier_value,normalized_value,is_primary&order=is_primary.desc&limit=' + (MAX_SCOPE_CONTACTS * 2), metrics, 'identifiers'),
    readRows(supabase, '/rest/v1/yarbi_contact_operational_memory?contact_id=in.(' + scoped + ')&state=eq.active&select=contact_id,memory_type,value,occurred_at&order=occurred_at.desc&limit=' + (MAX_SCOPE_CONTACTS * 8), metrics, 'memory', true),
    readRows(supabase, '/rest/v1/whatsapp_messages?contact_id=in.(' + scoped + ')&deleted_at=is.null&select=contact_id,title,text,timestamp&order=timestamp.desc&limit=' + (MAX_SCOPE_CONTACTS * 5), metrics, 'messages', true),
    readRows(supabase, '/rest/v1/ai_message_analysis?contact_id=in.(' + scoped + ')&status=eq.completed&select=contact_id,intent,service,extracted_data,completed_at&order=completed_at.desc&limit=' + (MAX_SCOPE_CONTACTS * 4), metrics, 'analyses', true),
    readRows(supabase, '/rest/v1/agenda_events?contact_id=in.(' + scoped + ')&select=contact_id,service,status,description,starts_at&order=starts_at.desc&limit=' + (MAX_SCOPE_CONTACTS * 3), metrics, 'agenda', true),
    readRows(supabase, '/rest/v1/yarbi_receivables?contact_id=in.(' + scoped + ')&select=contact_id,agreed_amount,balance_amount,status,next_action,next_action_due&order=updated_at.desc&limit=' + (MAX_SCOPE_CONTACTS * 2), metrics, 'receivables', true)
  ]);
  return { contacts, identifiers, memory, messages, analyses, agenda, receivables };
}

async function searchScopedCrm({ supabase, validatedIdentity, ownerScopeResolver, query = '', filters = {}, page = 1, limit = MAX_PAGE_SIZE, cache = crmSearchCache } = {}) {
  const started = performance.now();
  if (typeof supabase !== 'function' || typeof ownerScopeResolver !== 'function') {
    const error = new Error('crm_search_store_unavailable'); error.code = error.message; throw error;
  }
  const ownerId = verifiedOwnerId(validatedIdentity);
  const scope = normalizeScope(ownerId, await ownerScopeResolver(validatedIdentity));
  if (!scope.ok) return { schema: CRM_SEARCH_SCHEMA, outcome: scope.code, results: [], pagination: { page: 1, limit: bounded(limit, MAX_PAGE_SIZE, MAX_PAGE_SIZE), total: 0, pages: 0 }, metrics: { query_count: 0, cache: 'disabled', total_ms: performance.now() - started } };
  const safePage = bounded(page, 1, 1000);
  const safeLimit = bounded(limit, MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const metrics = { query_count: 0, sources: {} };
  const cacheResult = await cache.getOrLoad({
    ownerId,
    contactIds: scope.ids,
    key: { scope: scope.ids, query: text(query, 240), filters: object(filters), page: safePage, limit: safeLimit },
    load: async () => {
      const records = await loadScopedCrmRecords({ supabase, ownerId, contactIds: scope.ids, metrics });
      return searchClients({ records, ownerId, requesterOwnerId: ownerId, query, filters: object(filters), page: safePage, limit: safeLimit });
    }
  });
  const result = cacheResult.value;
  return {
    ...result,
    schema: CRM_SEARCH_SCHEMA,
    metrics: { query_count: metrics.query_count, sources: metrics.sources, cache: cacheResult.cache, total_ms: performance.now() - started },
    scope: { verified: 'canonical_owner_contact_scope', contact_count: scope.ids.length }
  };
}

function invalidateCrmSearchCache({ ownerId, contactId } = {}) { return crmSearchCache.invalidate({ ownerId, contactId }); }

module.exports = { CRM_SEARCH_SCHEMA, MAX_PAGE_SIZE, normalizeScope, recordsFromRows, loadScopedCrmSources, searchScopedCrm, invalidateCrmSearchCache };
