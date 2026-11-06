'use strict';
const { bearer } = require('./preview-owner-ui-policy');

async function authenticatedPreviewOwner(req, config, fetchImpl = fetch) {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, code: 'owner_ui_unauthorized' };
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, { headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` } });
  if (!response.ok) return { ok: false, status: 401, code: 'owner_ui_unauthorized' };
  const user = await response.json().catch(() => null);
  if (!user?.id || user.id !== config.ownerAccountId) return { ok: false, status: 403, code: 'owner_ui_forbidden' };
  return { ok: true, user: { id: user.id } };
}
module.exports = { authenticatedPreviewOwner };
