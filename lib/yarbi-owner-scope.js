'use strict';

// Resolución canónica de alcance del dueño. Este módulo sólo acepta una
// identidad que ya fue validada por el backend; jamás acepta contact_ids de
// una petición de cliente ni intenta inferir pertenencia desde chats, nombres
// o teléfonos.
const SCOPE_SCHEMA = 'yarbi.owner-contact-scope.v1';
const MAX_SCOPE_CONTACTS = 96;
const MAX_COMPLETE_SCOPE_CONTACTS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function verifiedOwnerId(identity) {
  const source = identity && typeof identity === 'object' ? identity : null;
  const subject = String(source?.subject || '').trim();
  if (!source || source.kind !== 'validated_auth_identity' || !UUID.test(subject)) {
    const error = new Error('owner_identity_unverified');
    error.code = 'owner_identity_unverified';
    throw error;
  }
  return subject.toLowerCase();
}

async function fetchRows(supabase, path) {
  if (typeof supabase !== 'function') {
    const error = new Error('owner_scope_store_unavailable');
    error.code = error.message;
    throw error;
  }
  const result = await supabase(path);
  if (!result?.response?.ok) {
    const error = new Error('owner_scope_read_failed');
    error.code = error.message;
    throw error;
  }
  return Array.isArray(result.data) ? result.data : [];
}

function contactIds(rows) {
  const values = [];
  for (const row of rows) {
    const id = Number(row?.contact_id);
    if (Number.isSafeInteger(id) && id > 0) values.push(id);
  }
  return [...new Set(values)];
}

function createCanonicalOwnerScopeResolver({ supabase, maxContacts = MAX_SCOPE_CONTACTS } = {}) {
  const cap = Math.min(Math.max(Number(maxContacts) || MAX_SCOPE_CONTACTS, 1), MAX_SCOPE_CONTACTS);
  return async function resolveCanonicalOwnerScope(validatedIdentity) {
    const ownerId = verifiedOwnerId(validatedIdentity);
    const path = '/rest/v1/yarbi_owner_contact_scope?owner_account_id=eq.' + encodeURIComponent(ownerId) + '&select=contact_id&order=contact_id.asc&limit=' + (cap + 1);
    const rows = await fetchRows(supabase, path);
    const ids = contactIds(rows);
    if (ids.length > cap) {
      const error = new Error('owner_scope_too_broad');
      error.code = error.message;
      throw error;
    }
    return {
      owner_id: ownerId,
      contact_ids: ids,
      verification: 'canonical_owner_contact_scope',
      provenance: 'yarbi_owner_contact_scope'
    };
  };
}

// Las lecturas interactivas que necesitan cubrir todos los contactos usan un
// recorrido paginado independiente. Conserva la misma identidad autenticada,
// falla de forma explícita si excede el presupuesto y nunca trunca el alcance
// silenciosamente. El resolvedor pequeño anterior sigue disponible para las
// rutas históricas que todavía requieren una respuesta de latencia acotada.
function createPaginatedCanonicalOwnerScopeResolver({ supabase, pageSize = 100, maxContacts = MAX_COMPLETE_SCOPE_CONTACTS } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 100, 1), 500);
  const cap = Math.min(Math.max(Number(maxContacts) || MAX_COMPLETE_SCOPE_CONTACTS, size), MAX_COMPLETE_SCOPE_CONTACTS);
  return async function resolveCompleteCanonicalOwnerScope(validatedIdentity) {
    const ownerId = verifiedOwnerId(validatedIdentity);
    const ids = [];
    for (let offset = 0; ; offset += size) {
      const path = '/rest/v1/yarbi_owner_contact_scope?owner_account_id=eq.' + encodeURIComponent(ownerId)
        + '&select=contact_id&order=contact_id.asc&limit=' + size + '&offset=' + offset;
      const rows = await fetchRows(supabase, path);
      ids.push(...contactIds(rows));
      if (ids.length > cap) {
        const error = new Error('owner_scope_too_broad');
        error.code = error.message;
        throw error;
      }
      if (rows.length < size) break;
    }
    return {
      owner_id: ownerId,
      contact_ids: [...new Set(ids)],
      verification: 'canonical_owner_contact_scope',
      provenance: 'yarbi_owner_contact_scope',
      pagination: { page_size: size, complete: true }
    };
  };
}

module.exports = {
  SCOPE_SCHEMA,
  MAX_SCOPE_CONTACTS,
  MAX_COMPLETE_SCOPE_CONTACTS,
  verifiedOwnerId,
  createCanonicalOwnerScopeResolver,
  createPaginatedCanonicalOwnerScopeResolver
};
