'use strict';

// Controles comunes para rutas interactivas de Yarbi. La identidad proviene
// exclusivamente de Supabase Auth y el alcance de contactos se obtiene de la
// relación canónica server-side; nunca de un campo enviado por el navegador.
const { authenticatedOwnerIdentity } = require('./yarbi-owner-ui-auth');
const { createCanonicalOwnerScopeResolver } = require('./yarbi-owner-scope');

const BLOCKED_OWNER_INPUTS = new Set([
  'owner_id', 'owner_account_id', 'ownerid', 'owneraccountid',
  'contact_ids', 'contactids', 'service_role', 'supabase_key',
  'supabase_secret_key'
]);

function blockedOwnerInput(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = String(key).replace(/[^a-z0-9_]/gi, '').toLowerCase();
    return BLOCKED_OWNER_INPUTS.has(normalized) || blockedOwnerInput(child, depth + 1);
  });
}

function scopedContact(scope, contactId) {
  const target = Number(contactId);
  return Number.isSafeInteger(target) && target > 0 && Array.isArray(scope?.contact_ids) && scope.contact_ids.includes(target);
}

function scopedFilter(scope) {
  const ids = Array.isArray(scope?.contact_ids) ? scope.contact_ids.filter(id => Number.isSafeInteger(id) && id > 0) : [];
  return ids.length ? 'in.(' + ids.join(',') + ')' : null;
}

async function authenticateScopedOwner(req, config, supabase, fetchImpl) {
  const authenticated = await authenticatedOwnerIdentity(req, config, fetchImpl);
  if (!authenticated.ok) return authenticated;
  try {
    const scope = await createCanonicalOwnerScopeResolver({ supabase })(authenticated.identity);
    return { ok: true, authenticated, scope };
  } catch (error) {
    return { ok: false, status: 403, code: error?.code || 'owner_scope_unavailable' };
  }
}

module.exports = { BLOCKED_OWNER_INPUTS, blockedOwnerInput, scopedContact, scopedFilter, authenticateScopedOwner };
