'use strict';

// Diagnóstico de autenticación exclusivo para Preview. No importa Gemini,
// CRM, Agenda, WhatsApp ni módulos de negocio; no hace escrituras.
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { decideAuthContinuityRequest } = require('../../lib/preview-auth-continuity-policy');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function response(res, status, body) { return res.status(status).json(body); }
function elapsed(started) { return Math.max(0, Math.round(performance.now() - started)); }

function publicBody({ decision, auth, ownerMatches, elapsedMs }) {
  const category = !decision.authorization.present ? 'header_missing'
    : !decision.authorization.format_valid ? 'header_invalid'
      : !auth?.ok ? 'supabase_auth_rejected'
        : ownerMatches !== true ? 'owner_mismatch' : 'authorized';
  return {
    ok: category === 'authorized', execute: false, gemini_invoked: false,
    commercial_actions_executed: false, authorization_header_present: decision.authorization.present,
    authorization_format_valid: decision.authorization.format_valid,
    supabase_auth_result: !decision.authorization.present || !decision.authorization.format_valid ? 'not_called' : auth?.ok ? 'valid' : 'rejected',
    owner_matches: ownerMatches === true, category, response_ms: elapsedMs,
    isolated_project_ref: 'uevilhbstnmmdlgyshlv'
  };
}

function createAuthContinuityHandler({ authenticate = authenticatedOwnerIdentity } = {}) {
  return async function authContinuityHandler(req, res) {
    const started = performance.now(); const decision = decideAuthContinuityRequest(req, process.env);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
    if (Object.keys(body).length !== 0) return response(res, 400, { ok: false, execute: false, gemini_invoked: false, commercial_actions_executed: false, category: 'request_body_forbidden' });
    if (!decision.allow) return response(res, decision.status, publicBody({ decision, auth: null, ownerMatches: false, elapsedMs: elapsed(started) }));
    let auth;
    try { auth = await authenticate(req, decision.state.config); }
    catch (_) { return response(res, 503, { ...publicBody({ decision, auth: null, ownerMatches: false, elapsedMs: elapsed(started) }), category: 'supabase_auth_transport_failure' }); }
    const ownerMatches = auth?.ok === true && auth.user?.id === decision.state.config.ownerId;
    const status = !auth?.ok ? 401 : ownerMatches ? 200 : 403;
    return response(res, status, publicBody({ decision, auth, ownerMatches, elapsedMs: elapsed(started) }));
  };
}

module.exports = createAuthContinuityHandler();
module.exports.createAuthContinuityHandler = createAuthContinuityHandler;
