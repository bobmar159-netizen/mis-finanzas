'use strict';

const SEARCH_SCHEMA = 'yarbi.client-search.v1';
const SYNONYMS = Object.freeze({
  instalacion: ['instalacion', 'instalar', 'nueva'],
  reparacion: ['reparacion', 'reparar', 'arreglo'],
  punto: ['punto', 'adicional', 'extension'],
  tuberia: ['tuberia', 'tubo', 'modificacion'],
  conversion: ['conversion', 'convertir', 'artefacto'],
  visita: ['visita', 'coordinar', 'agenda']
});

function text(value, limit = 500) { return String(value ?? '').trim().slice(0, limit); }
function normalize(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PE').replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function tokens(value) { return [...new Set(normalize(value).split(' ').filter(Boolean))]; }
function positiveId(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function array(value) { return Array.isArray(value) ? value : []; }

function searchable(contact = {}) {
  const history = array(contact.history || contact.messages || contact.conversations).map(item => typeof item === 'string' ? item : (item?.text || item?.summary || '')).join(' ');
  const services = [contact.service, contact.latest_service, contact.installation_type, ...array(contact.historical_services).map(row => row?.service || row)].join(' ');
  const fields = {
    name: [contact.display_name, contact.full_name, contact.name].filter(Boolean).join(' '),
    phone: [contact.phone, ...array(contact.phones), ...array(contact.identifiers).map(row => row?.normalized_value || row?.identifier_value || row)].join(' '),
    address: [contact.address, contact.location, contact.location_label, contact.district].filter(Boolean).join(' '),
    service: services,
    history,
    quote: [contact.quote, contact.quote_status, contact.budget, contact.price].filter(Boolean).join(' '),
    status: [contact.commercial_status, contact.operational_status, contact.pending_step].filter(Boolean).join(' '),
    traits: array(contact.traits || contact.characteristics).join(' '),
    dates: [contact.last_contact_at, contact.created_at, contact.updated_at].filter(Boolean).join(' ')
  };
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, normalize(value)]));
}

function expandedTerms(query) {
  const result = new Set(tokens(query));
  for (const [canonical, values] of Object.entries(SYNONYMS)) {
    if (values.some(value => result.has(value)) || result.has(canonical)) values.forEach(value => result.add(value));
  }
  return [...result];
}

function filtersMatch(contact, filters = {}) {
  const status = normalize(filters.status);
  const service = normalize(filters.service);
  const district = normalize(filters.district);
  const fields = searchable(contact);
  if (status && !fields.status.includes(status)) return false;
  if (service && !fields.service.includes(service)) return false;
  if (district && !fields.address.includes(district)) return false;
  if (filters.pending === true && !fields.status.includes('pendiente')) return false;
  const recencyDays = Number(filters.recency_days);
  if (Number.isFinite(recencyDays) && recencyDays >= 0) {
    const last = Date.parse(contact.last_contact_at || contact.updated_at || '');
    if (!last || last < Date.now() - recencyDays * 86400000) return false;
  }
  return true;
}

function score(contact, terms) {
  const fields = searchable(contact);
  let total = 0; const matched = new Set();
  for (const term of terms) {
    let found = false;
    for (const [field, value] of Object.entries(fields)) {
      if (!value || !value.includes(term)) continue;
      found = true; matched.add(field);
      const exact = value === term || value.split(' ').includes(term);
      const weight = ({ phone: 130, name: 110, address: 60, service: 75, status: 50, history: 35, quote: 45, traits: 30, dates: 20 })[field] || 10;
      total += exact ? weight : Math.max(8, Math.round(weight * 0.55));
    }
    if (!found) total -= 18;
  }
  const last = Date.parse(contact.last_contact_at || contact.updated_at || '') || 0;
  return { score: Math.max(0, total), matched_fields: [...matched].sort(), last };
}

function searchClients({ records = [], ownerId, requesterOwnerId, query = '', filters = {}, page = 1, limit = 12 } = {}) {
  const owner = text(ownerId, 160); const requester = text(requesterOwnerId, 160);
  if (!owner || owner !== requester) return { schema: SEARCH_SCHEMA, outcome: 'owner_scope_denied', results: [], query: normalize(query) };
  const terms = expandedTerms(query);
  const unique = new Map();
  for (const raw of array(records)) {
    const id = positiveId(raw?.contact_id || raw?.id);
    if (!id || text(raw?.owner_id, 160) !== owner || unique.has(id) || !filtersMatch(raw, filters)) continue;
    const result = score(raw, terms);
    if (terms.length && result.score === 0) continue;
    unique.set(id, {
      contact_id: id,
      display_name: text(raw.display_name || raw.full_name || raw.name, 160) || 'Sin nombre',
      commercial_status: text(raw.commercial_status, 32) || 'frio',
      latest_service: text(raw.latest_service || raw.service, 80) || null,
      district: text(raw.district, 80) || null,
      last_contact_at: text(raw.last_contact_at, 80) || null,
      score: result.score,
      matched_fields: result.matched_fields,
      _last: result.last
    });
  }
  const safeLimit = Math.max(1, Math.min(40, Number(limit) || 12));
  const safePage = Math.max(1, Math.min(1000, Number(page) || 1));
  const sorted = [...unique.values()].sort((a, b) => b.score - a.score || b._last - a._last || a.contact_id - b.contact_id);
  const total = sorted.length;
  const results = sorted.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(({ _last, ...row }) => row);
  return {
    schema: SEARCH_SCHEMA,
    outcome: results.length ? 'results_found' : (total ? 'page_empty' : 'no_results'),
    query: normalize(query), filters: { ...filters }, results,
    pagination: { page: safePage, limit: safeLimit, total, pages: total ? Math.ceil(total / safeLimit) : 0 }
  };
}

module.exports = { SEARCH_SCHEMA, normalize, expandedTerms, searchClients };
