'use strict';

const { configuration, decidePreviewOwnerUiRequest } = require('../../lib/preview-owner-ui-policy');
const { authenticatedPreviewOwner } = require('../../lib/yarbi-owner-ui-auth');
const { sanitizeInboxRows } = require('../../lib/yarbi-owner-inbox');

function serviceClient(config) {
  return async (path, options = {}) => {
    const response = await fetch(config.supabaseUrl + path, { ...options, headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, ...(options.headers || {}) } });
    return { response, data: await response.json().catch(() => []) };
  };
}

module.exports = async function ownerInboxHandler(req, res) {
  const decision = decidePreviewOwnerUiRequest(req, process.env);
  if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
  const config = decision.state?.config;
  if (!config) return res.status(503).json({ ok: false, error: 'owner_ui_preview_not_configured' });
  const authenticated = await authenticatedPreviewOwner(req, config);
  if (!authenticated.ok) return res.status(authenticated.status).json({ ok: false, error: authenticated.code });
  try {
    const store = serviceClient(config);
    const result = await store(`/rest/v1/yarbi_owner_inbox?owner_key=eq.${encodeURIComponent(config.ownerKey)}&status=eq.delivered&select=id,urgency,payload,status,created_at,owner_decision_status,postpone_until&order=created_at.desc&limit=50`);
    if (!result.response.ok || !Array.isArray(result.data)) throw new Error('owner_inbox_read_failed');
    const view = sanitizeInboxRows(result.data);
    return res.status(200).json({ ok: true, ...view, fetched_at: new Date().toISOString() });
  } catch (_) {
    return res.status(502).json({ ok: false, error: 'owner_inbox_unavailable' });
  }
};

module.exports.serviceClient = serviceClient;
