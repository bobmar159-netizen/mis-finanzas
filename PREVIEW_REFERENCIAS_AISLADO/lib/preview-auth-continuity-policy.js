'use strict';

// Ruta temporal de diagnóstico: Preview aislado, proyecto exacto y auth del
// owner sintético. No habilita ni importa Gemini.
const ROUTE = '/api/diagnostics/auth-continuity';
const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';
const PRODUCTION_REF = 'haifktjvyhbsazmiyqps';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN = ['META_ACCESS_TOKEN', 'WHATSAPP_TOKEN', 'YCLOUD_API_KEY', 'YCLOUD_KEY', 'NOTION_TOKEN', 'FNZ_NOTION_TOKEN', 'GOOGLE_SHEETS_URL', 'GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY', 'CRON_SECRET'];

function text(value) { return String(value || '').trim(); }
function pathOf(request) { try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid').pathname; } catch (_) { return '/'; } }
function authorizationInfo(request) {
  const raw = text(request?.headers?.authorization || request?.headers?.Authorization);
  const present = raw.length > 0;
  const match = /^Bearer\s+([^\s]+)$/i.exec(raw);
  return { present, format_valid: Boolean(match && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(match[1])) };
}
function configuration(env = process.env) {
  if (text(env.VERCEL_ENV) !== 'preview') return { valid: false, code: 'auth_continuity_preview_only' };
  if (text(env.YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT).toLowerCase() !== 'true') return { valid: false, code: 'auth_continuity_preview_mode_required' };
  const projectRef = text(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase();
  if (projectRef !== PREVIEW_REF) return { valid: false, code: projectRef === PRODUCTION_REF ? 'auth_continuity_project_is_production' : 'auth_continuity_project_not_authorized' };
  let supabaseUrl; try { supabaseUrl = new URL(text(env.SUPABASE_URL)); } catch (_) { return { valid: false, code: 'auth_continuity_supabase_url_invalid' }; }
  if (supabaseUrl.protocol !== 'https:' || supabaseUrl.hostname !== `${PREVIEW_REF}.supabase.co` || supabaseUrl.pathname !== '/') return { valid: false, code: 'auth_continuity_supabase_url_not_authorized' };
  const ownerId = text(env.YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID); if (!UUID.test(ownerId)) return { valid: false, code: 'auth_continuity_owner_missing' };
  const supabaseKey = text(env.SUPABASE_SECRET_KEY); if (supabaseKey.length < 32) return { valid: false, code: 'auth_continuity_secret_missing' };
  const external = FORBIDDEN.find(key => text(env[key])); if (external) return { valid: false, code: `auth_continuity_external_forbidden:${external}` };
  return { valid: true, config: { projectRef, supabaseUrl: supabaseUrl.toString().replace(/\/$/, ''), supabaseKey, ownerId } };
}
function decideAuthContinuityRequest(request, env = process.env) {
  const state = configuration(env);
  if (!state.valid) return { allow: false, status: 503, code: state.code, state, authorization: authorizationInfo(request) };
  if (pathOf(request) !== ROUTE) return { allow: false, status: 403, code: 'auth_continuity_route_blocked', state, authorization: authorizationInfo(request) };
  if (String(request?.method || 'GET').toUpperCase() !== 'POST') return { allow: false, status: 405, code: 'auth_continuity_method_not_allowed', state, authorization: authorizationInfo(request) };
  const authorization = authorizationInfo(request);
  if (!authorization.present) return { allow: false, status: 401, code: 'auth_continuity_header_missing', state, authorization };
  if (!authorization.format_valid) return { allow: false, status: 401, code: 'auth_continuity_header_invalid', state, authorization };
  return { allow: true, status: 200, code: 'auth_continuity_allowed', state, authorization };
}
module.exports = { ROUTE, authorizationInfo, configuration, decideAuthContinuityRequest };
