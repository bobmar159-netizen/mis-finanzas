'use strict';

const { configuration: baseConfiguration } = require('./preview-gemini-v4-probe-policy');
const ROUTE = '/api/diagnostics/gemini-v4-semantic-validation';

function text(value) { return String(value || '').trim(); }
function bearer(request) { return text(request?.headers?.authorization || request?.headers?.Authorization).replace(/^Bearer\s+/i, ''); }
function pathOf(request) { try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid').pathname; } catch (_) { return '/'; } }

function decideGeminiV4ValidationRequest(request, env = process.env) {
  const state = baseConfiguration(env);
  if (!state.valid) return { allow: false, status: 503, code: state.code, state };
  if (pathOf(request) !== ROUTE) return { allow: false, status: 403, code: 'gemini_v4_validation_route_blocked', state };
  if (String(request?.method || 'GET').toUpperCase() !== 'POST') return { allow: false, status: 405, code: 'gemini_v4_validation_method_not_allowed', state };
  if (!bearer(request)) return { allow: false, status: 401, code: 'gemini_v4_validation_unauthorized', state };
  return { allow: true, status: 200, code: 'gemini_v4_validation_allowed', state };
}

module.exports = { ROUTE, decideGeminiV4ValidationRequest };
