'use strict';

// Ruta temporal de diagnóstico. Solo puede existir en el Preview aislado y no
// comparte handler ni configuración permisiva con las rutas comerciales.
const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';
const PRODUCTION_REF = 'haifktjvyhbsazmiyqps';
const ROUTE = '/api/diagnostics/gemini-v4-first-probe';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN = [
  'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN', 'YCLOUD_API_KEY', 'YCLOUD_KEY',
  'NOTION_TOKEN', 'FNZ_NOTION_TOKEN', 'GOOGLE_SHEETS_URL',
  'GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY', 'CRON_SECRET'
];

function text(value) { return String(value || '').trim(); }
function bearer(request) { return text(request?.headers?.authorization || request?.headers?.Authorization).replace(/^Bearer\s+/i, ''); }
function pathOf(request) { try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid').pathname; } catch (_) { return '/'; } }
function invalid(code) { return { active: true, valid: false, code }; }

function configuration(env = process.env) {
  if (text(env.VERCEL_ENV) !== 'preview') return invalid('gemini_v4_probe_preview_only');
  if (text(env.YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT).toLowerCase() !== 'true') return invalid('gemini_v4_probe_mode_required');
  const projectRef = text(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase();
  if (projectRef !== PREVIEW_REF) return invalid(projectRef === PRODUCTION_REF ? 'gemini_v4_probe_project_is_production' : 'gemini_v4_probe_project_not_authorized');
  let supabaseUrl;
  try { supabaseUrl = new URL(text(env.SUPABASE_URL)); } catch (_) { return invalid('gemini_v4_probe_supabase_url_invalid'); }
  if (supabaseUrl.protocol !== 'https:' || supabaseUrl.hostname !== `${PREVIEW_REF}.supabase.co` || supabaseUrl.pathname !== '/') return invalid('gemini_v4_probe_supabase_url_not_authorized');
  const ownerId = text(env.YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID);
  if (!UUID.test(ownerId)) return invalid('gemini_v4_probe_owner_missing');
  const supabaseKey = text(env.SUPABASE_SECRET_KEY);
  if (supabaseKey.length < 32) return invalid('gemini_v4_probe_secret_missing');
  const traceSecret = text(env.YARBI_TRACE_HMAC_KEY);
  if (traceSecret.length < 32) return invalid('gemini_v4_probe_trace_hmac_missing');
  if (text(env.YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING).toLowerCase() !== 'true') return invalid('gemini_v4_probe_gemini_not_enabled');
  const geminiKey = text(env.GEMINI_API_KEY || env.GEMINI_KEY);
  if (!geminiKey) return invalid('gemini_v4_probe_gemini_missing');
  const external = FORBIDDEN.find(key => text(env[key]));
  if (external) return invalid(`gemini_v4_probe_external_forbidden:${external}`);
  return { active: true, valid: true, config: {
    projectRef,
    supabaseUrl: supabaseUrl.toString().replace(/\/$/, ''),
    supabaseKey,
    traceSecret,
    ownerId,
    gemini: { apiKey: geminiKey, model: text(env.GEMINI_OWNER_UNDERSTANDING_MODEL) || 'gemini-3.5-flash-lite', timeoutMs: 10000 }
  } };
}

function decideGeminiV4ProbeRequest(request, env = process.env) {
  const state = configuration(env);
  if (!state.valid) return { allow: false, status: 503, code: state.code, state };
  if (pathOf(request) !== ROUTE) return { allow: false, status: 403, code: 'gemini_v4_probe_route_blocked', state };
  if (String(request?.method || 'GET').toUpperCase() !== 'POST') return { allow: false, status: 405, code: 'gemini_v4_probe_method_not_allowed', state };
  if (!bearer(request)) return { allow: false, status: 401, code: 'gemini_v4_probe_unauthorized', state };
  return { allow: true, status: 200, code: 'gemini_v4_probe_allowed', state };
}

module.exports = { PREVIEW_REF, ROUTE, configuration, decideGeminiV4ProbeRequest };
