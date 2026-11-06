'use strict';

const { applyOwnerAction, createOwnerActionStore } = require('../../lib/yarbi-owner-action');
const { configuration, decidePreviewOwnerActionRequest } = require('../../lib/preview-owner-action-policy');
const { active: ownerUiActive, configuration: ownerUiConfiguration, decidePreviewOwnerUiRequest } = require('../../lib/preview-owner-ui-policy');
const { authenticatedPreviewOwner } = require('../../lib/yarbi-owner-ui-auth');

function client(config) {
  return async (path, options = {}) => {
    const response = await fetch(config.url + path, { ...options, headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, ...(options.headers || {}) } });
    return { response, data: await response.json().catch(() => ({})) };
  };
}
function endpointConfig(env) {
  const policy = configuration(env);
  if (!policy.active || !policy.valid) return null;
  return { url: policy.supabaseUrl, key: policy.supabaseKey, token: policy.token };
}
module.exports = async function ownerActionHandler(req, res) {
  // UI-01 uses an authenticated account JWT.  Retain the F3K static-token path
  // unchanged for its isolated runner and never expose that token to a client.
  const uiDecision = decidePreviewOwnerUiRequest(req, process.env);
  if (ownerUiActive(process.env)) {
    if (!uiDecision.allow) return res.status(uiDecision.status).json({ ok: false, error: uiDecision.code });
    const uiPolicy = ownerUiConfiguration(process.env);
    const uiConfig = uiPolicy.config;
    if (!uiConfig) return res.status(503).json({ ok: false, error: 'owner_ui_preview_not_configured' });
    const authenticated = await authenticatedPreviewOwner(req, uiConfig);
    if (!authenticated.ok) return res.status(authenticated.status).json({ ok: false, error: authenticated.code });
    try {
      const result = await applyOwnerAction({ store: createOwnerActionStore({ supabase: client({ url: uiConfig.supabaseUrl, key: uiConfig.supabaseKey }) }), request: req.body || {}, now: new Date() });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      const code = String(error?.code || 'owner_action_failed').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 100);
      return res.status(code.startsWith('owner_action_') && !['owner_action_apply_failed'].includes(code) ? 400 : 502).json({ ok: false, error: code });
    }
  }
  const decision = decidePreviewOwnerActionRequest(req, process.env);
  if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
  const config = endpointConfig(process.env);
  if (!config) return res.status(503).json({ ok: false, error: 'owner_action_preview_not_configured' });
  try {
    const result = await applyOwnerAction({ store: createOwnerActionStore({ supabase: client(config) }), request: req.body || {}, now: new Date() });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const code = String(error?.code || 'owner_action_failed').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 100);
    return res.status(code === 'owner_action_request_invalid' || code === 'owner_action_postpone_until_invalid' || code === 'owner_action_postpone_until_unexpected' ? 400 : 502).json({ ok: false, error: code });
  }
};
