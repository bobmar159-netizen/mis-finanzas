'use strict';
const { applyOwnerAction, createOwnerActionStore } = require('../../lib/yarbi-owner-action');
const { configuration, decidePreviewOwnerUiRequest } = require('../../lib/preview-owner-ui-policy');
const { authenticatedPreviewOwner } = require('../../lib/yarbi-owner-ui-auth');
function client(config) { return async (path, options = {}) => { const response = await fetch(config.supabaseUrl + path, { ...options, headers: { apikey:config.supabaseKey, ...(options.headers || {}) } }); return { response, data:await response.json().catch(() => ({})) }; }; }
module.exports = async function ownerActionHandler(req,res) {
  const decision = decidePreviewOwnerUiRequest(req,process.env);
  if (!decision.allow) return res.status(decision.status).json({ ok:false,error:decision.code });
  const config = configuration(process.env).config;
  if (!config) return res.status(503).json({ ok:false,error:'owner_ui_preview_not_configured' });
  const authenticated = await authenticatedPreviewOwner(req,config);
  if (!authenticated.ok) return res.status(authenticated.status).json({ ok:false,error:authenticated.code });
  try { const result = await applyOwnerAction({ store:createOwnerActionStore({supabase:client(config)}), request:req.body||{}, now:new Date() }); return res.status(200).json({ok:true,...result}); }
  catch (error) { const code=String(error?.code||'owner_action_failed').replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,100); return res.status(code.startsWith('owner_action_') && code !== 'owner_action_apply_failed' ? 400:502).json({ok:false,error:code}); }
};
