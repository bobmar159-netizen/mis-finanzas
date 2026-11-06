'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(req) {
  return String(req?.headers?.authorization || req?.headers?.Authorization || '').trim().replace(/^Bearer\s+/i, '');
}

// Verifica una sesión de Supabase sin asumir todavía qué contactos puede ver.
// Esa autorización se resuelve después, exclusivamente desde
// yarbi_owner_contact_scope. Así evitamos que una petición pueda declarar un
// owner_id o un scope propio.
async function authenticatedOwnerIdentity(req, config, fetchImpl = fetch) {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, code: 'owner_reference_unauthorized' };
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, { headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}` } });
  if (!response.ok) return { ok: false, status: 401, code: 'owner_reference_unauthorized' };
  const user = await response.json().catch(() => null);
  if (!user?.id || typeof user.id !== 'string' || !UUID.test(user.id)) return { ok: false, status: 401, code: 'owner_reference_unauthorized' };
  return { ok: true, user: { id: user.id }, identity: { kind: 'validated_auth_identity', subject: user.id } };
}

async function authenticatedPreviewOwner(req, config, fetchImpl = fetch) {
  const authenticated = await authenticatedOwnerIdentity(req, config, fetchImpl);
  if (!authenticated.ok) return { ok: false, status: authenticated.status, code: authenticated.code === 'owner_reference_unauthorized' ? 'owner_ui_unauthorized' : authenticated.code };
  if (authenticated.user.id !== config.ownerAccountId) return { ok: false, status: 403, code: 'owner_ui_forbidden' };
  const user = authenticated.user;
  return { ok: true, user: { id: user.id } };
}
module.exports = { authenticatedOwnerIdentity, authenticatedPreviewOwner };
