'use strict';

const { SERVICES } = require('./yarbi-commercial-context');
const { emptyContactOperationalMemory, getContactOperationalMemory, getContactOperationalMemories } = require('./yarbi-operational-memory');

const SERVICE_SET = new Set(SERVICES.filter(service => service !== 'unknown'));

function contextError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function text(value, limit = 240) {
  return String(value ?? '').trim().slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeService(value) {
  const service = text(value, 80);
  return SERVICE_SET.has(service) ? service : null;
}

function activeMemoryValue(memory, type) {
  return asObject(memory?.[type]);
}

function primaryPhone(identifiers = []) {
  const phones = (Array.isArray(identifiers) ? identifiers : [])
    .filter(identifier => text(identifier?.identifier_type, 32) === 'phone')
    .sort((left, right) => Number(Boolean(right?.is_primary)) - Number(Boolean(left?.is_primary)));
  const winner = phones[0] || null;
  return winner ? text(winner.normalized_value || winner.identifier_value, 32) || null : null;
}

function compactMemory(memory) {
  const source = memory || {};
  return {
    service: activeMemoryValue(source, 'service'),
    district: activeMemoryValue(source, 'district'),
    location: activeMemoryValue(source, 'location'),
    pending_step: activeMemoryValue(source, 'pending_step'),
    visit: activeMemoryValue(source, 'visit'),
    customer_commitment: activeMemoryValue(source, 'customer_commitment'),
    business_commitment: activeMemoryValue(source, 'business_commitment'),
    objection: activeMemoryValue(source, 'objection')
  };
}

function buildUnifiedContactContext({ contactId, contact = null, identifiers = [], memory = null } = {}) {
  const normalizedContactId = positiveInteger(contactId);
  if (!normalizedContactId) throw contextError('unified_context_contact_invalid');
  const safeContact = asObject(contact);
  const compact = compactMemory(memory || emptyContactOperationalMemory(normalizedContactId));
  const commercialService = normalizeService(safeContact?.latest_service);
  const memoryService = normalizeService(compact.service?.service);
  const conflicts = [];
  let effectiveService = commercialService || memoryService;
  let serviceSource = commercialService ? 'commercial_context' : (memoryService ? 'operational_memory' : null);
  if (commercialService && memoryService && commercialService !== memoryService) {
    effectiveService = null;
    serviceSource = null;
    conflicts.push({
      code: 'context_conflict',
      field: 'service',
      sources: ['commercial_context', 'operational_memory']
    });
  }
  const visitRequested = compact.visit?.requested === true;
  const missing = [];
  if (!effectiveService && !conflicts.some(conflict => conflict.field === 'service')) missing.push('service');
  if (!compact.district) missing.push('district');
  if (visitRequested && !compact.location) missing.push('location');

  return {
    schema: 'yarbi.unified-contact.v1',
    contact_id: normalizedContactId,
    found: Boolean(safeContact),
    identity: {
      display_name: safeContact ? text(safeContact.display_name || safeContact.full_name, 160) || null : null,
      phone: primaryPhone(identifiers)
    },
    commercial: {
      status: safeContact ? text(safeContact.commercial_status, 32) || 'frio' : null,
      service: effectiveService,
      service_source: serviceSource,
      last_contact_at: safeContact ? text(safeContact.last_contact_at, 80) || null : null,
      last_contact_message_id: safeContact ? text(safeContact.last_contact_message_id, 240) || null : null
    },
    memory: compact,
    missing,
    diagnostics: conflicts
  };
}

async function readRows(supabase, path, code) {
  const result = await supabase(path);
  if (!result?.response?.ok) throw contextError(code);
  return Array.isArray(result.data) ? result.data : [];
}

/**
 * Recupera tres fuentes acotadas en paralelo: contacto, teléfono e hechos
 * activos. No consulta whatsapp_messages, ni historial, ni servicios externos.
 */
async function getUnifiedContactContext({ supabase, contactId } = {}) {
  if (typeof supabase !== 'function') throw contextError('unified_context_store_unavailable');
  const normalizedContactId = positiveInteger(contactId);
  if (!normalizedContactId) throw contextError('unified_context_contact_invalid');
  const id = encodeURIComponent(String(normalizedContactId));
  const [contacts, identifiers, memory] = await Promise.all([
    readRows(supabase,
      '/rest/v1/crm_contacts?id=eq.' + id
      + '&select=id,full_name,display_name,commercial_status,latest_service,last_contact_at,last_contact_message_id&limit=1',
      'unified_context_contact_read_failed'),
    readRows(supabase,
      '/rest/v1/contact_identifiers?contact_id=eq.' + id
      + '&identifier_type=eq.phone&select=identifier_type,identifier_value,normalized_value,is_primary&order=is_primary.desc&limit=4',
      'unified_context_identifier_read_failed'),
    getContactOperationalMemory({ supabase, contactId: normalizedContactId })
  ]);
  return buildUnifiedContactContext({
    contactId: normalizedContactId,
    contact: contacts[0] || null,
    identifiers,
    memory
  });
}

async function getUnifiedContactContexts({ supabase, contactIds } = {}) {
  if (typeof supabase !== 'function') throw contextError('unified_context_store_unavailable');
  const ids = [...new Set((Array.isArray(contactIds) ? contactIds : []).map(positiveInteger).filter(Boolean))];
  if (!ids.length) return [];
  const filter = encodeURIComponent(ids.join(','));
  const [contacts, identifiers, memories] = await Promise.all([
    readRows(supabase,
      '/rest/v1/crm_contacts?id=in.(' + filter + ')&select=id,full_name,display_name,commercial_status,latest_service,last_contact_at,last_contact_message_id&limit=' + ids.length,
      'unified_context_contact_read_failed'),
    readRows(supabase,
      '/rest/v1/contact_identifiers?contact_id=in.(' + filter + ')&identifier_type=eq.phone&select=contact_id,identifier_type,identifier_value,normalized_value,is_primary&order=is_primary.desc&limit=' + Math.min(ids.length * 4, 800),
      'unified_context_identifier_read_failed'),
    getContactOperationalMemories({ supabase, contactIds: ids })
  ]);
  const contactById = new Map(contacts.map(contact => [positiveInteger(contact?.id), contact]).filter(([id]) => id));
  const identifiersById = new Map(ids.map(id => [id, []]));
  for (const identifier of identifiers) {
    const id = positiveInteger(identifier?.contact_id);
    if (id && identifiersById.has(id)) identifiersById.get(id).push(identifier);
  }
  return ids.map(id => buildUnifiedContactContext({
    contactId: id,
    contact: contactById.get(id) || null,
    identifiers: identifiersById.get(id) || [],
    memory: memories.get(id) || emptyContactOperationalMemory(id)
  }));
}

module.exports = {
  buildUnifiedContactContext,
  compactMemory,
  getUnifiedContactContext,
  getUnifiedContactContexts,
  primaryPhone
};
