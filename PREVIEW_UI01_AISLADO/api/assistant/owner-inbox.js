'use strict';
const { configuration, decidePreviewOwnerUiRequest, wantsAuthConfig } = require('../../lib/preview-owner-ui-policy');
const { authenticatedPreviewOwner } = require('../../lib/yarbi-owner-ui-auth');
const { sanitizeInboxRows } = require('../../lib/yarbi-owner-inbox');

function serviceClient(config) { return async (path, options = {}) => { const response = await fetch(config.supabaseUrl + path, { ...options, headers: { apikey: config.supabaseKey, ...(options.headers || {}) } }); return { response, data: await response.json().catch(() => []) }; }; }
function noStore(res) { res.setHeader('Cache-Control', 'no-store'); }
function safeInboxFailure(result) {
  const code = String(result?.data?.code || '').trim();
  const status = Number(result?.response?.status || 0);
  if (code === '42P01' || code === 'PGRST205') return 'owner_inbox_schema_unavailable';
  if (code === '42703') return 'owner_inbox_contract_mismatch';
  if (code === '42501') return 'owner_inbox_permission_denied';
  if (code === '401' || code === 'PGRST301') return 'owner_inbox_service_key_rejected';
  if (status === 401) return 'owner_inbox_service_key_rejected';
  if (status === 403) return 'owner_inbox_permission_denied';
  if (status === 404) return 'owner_inbox_schema_unavailable';
  if (status === 400) return 'owner_inbox_contract_mismatch';
  return 'owner_inbox_unavailable';
}
module.exports = async function ownerInboxHandler(req, res) {
  const decision = decidePreviewOwnerUiRequest(req, process.env); noStore(res);
  if (!decision.allow) return res.status(decision.status).json({ ok:false, error:decision.code });
  const config = decision.state?.config;
  if (!config) return res.status(503).json({ ok:false, error:'owner_ui_preview_not_configured' });
  if (wantsAuthConfig(req)) return res.status(200).json({ ok:true, supabaseUrl:config.supabaseUrl, publishableKey:config.publishableKey, projectRef:config.projectRef });
  const authenticated = await authenticatedPreviewOwner(req, config);
  if (!authenticated.ok) return res.status(authenticated.status).json({ ok:false, error:authenticated.code });
  try { const store = serviceClient(config); const result = await store(`/rest/v1/yarbi_owner_inbox?owner_key=eq.${encodeURIComponent(config.ownerKey)}&status=eq.delivered&select=id,urgency,payload,status,created_at,owner_decision_status,postpone_until&order=created_at.desc&limit=50`); if (!result.response.ok || !Array.isArray(result.data)) { const error = new Error('owner_inbox_read_failed'); error.code = safeInboxFailure(result); throw error; } return res.status(200).json({ ok:true, ...sanitizeInboxRows(result.data), fetched_at:new Date().toISOString() }); }
  catch (error) { return res.status(502).json({ ok:false, error:['owner_inbox_schema_unavailable','owner_inbox_contract_mismatch','owner_inbox_permission_denied','owner_inbox_service_key_rejected'].includes(error?.code) ? error.code : 'owner_inbox_unavailable' }); }
};
module.exports.safeInboxFailure = safeInboxFailure;
