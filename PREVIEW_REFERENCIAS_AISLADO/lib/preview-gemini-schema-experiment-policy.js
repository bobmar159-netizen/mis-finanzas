'use strict';

const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';
const PRODUCTION_REF = 'haifktjvyhbsazmiyqps';
const EXPERIMENT_ROUTE = '/api/diagnostics/gemini-schema-isolation';
const MINIMAL_EXPERIMENT_ROUTE = '/api/diagnostics/gemini-schema-minimal';
const FORBIDDEN = ['META_ACCESS_TOKEN','WHATSAPP_TOKEN','YCLOUD_API_KEY','YCLOUD_KEY','NOTION_TOKEN','FNZ_NOTION_TOKEN','GOOGLE_SHEETS_URL','GOOGLE_CALENDAR_CLIENT_EMAIL','GOOGLE_CALENDAR_PRIVATE_KEY','CRON_SECRET'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) { return String(value || '').trim(); }
function pathOf(request) { try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid').pathname; } catch (_) { return '/'; } }
function bearer(request) { return text(request?.headers?.authorization || request?.headers?.Authorization).replace(/^Bearer\s+/i, ''); }
function invalid(code) { return { active: true, valid: false, code }; }

function configuration(env = process.env) {
  if (text(env.VERCEL_ENV) !== 'preview') return invalid('gemini_schema_experiment_preview_only');
  if (text(env.YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT).toLowerCase() !== 'true') return invalid('gemini_schema_experiment_mode_required');
  const ref = text(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase();
  if (ref !== PREVIEW_REF) return invalid(ref === PRODUCTION_REF ? 'gemini_schema_experiment_project_is_production' : 'gemini_schema_experiment_project_not_authorized');
  let url; try { url = new URL(text(env.SUPABASE_URL)); } catch (_) { return invalid('gemini_schema_experiment_supabase_url_invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== `${PREVIEW_REF}.supabase.co` || url.pathname !== '/') return invalid('gemini_schema_experiment_supabase_url_not_authorized');
  // El experimento usa un dueño sintético distinto del dueño de la UI. Nunca
  // se acepta desde el cliente: sólo una variable exclusiva de Preview puede
  // fijar la identidad que el JWT validado debe representar.
  const experimentOwnerAccountId = text(env.YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID);
  if (!UUID.test(experimentOwnerAccountId)) return invalid('gemini_schema_experiment_owner_missing');
  if (text(env.SUPABASE_SECRET_KEY).length < 32) return invalid('gemini_schema_experiment_secret_missing');
  if (text(env.YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING).toLowerCase() !== 'true') return invalid('gemini_schema_experiment_gemini_not_enabled');
  const geminiKey = text(env.GEMINI_API_KEY || env.GEMINI_KEY);
  if (!geminiKey) return invalid('gemini_schema_experiment_gemini_missing');
  const external = FORBIDDEN.find(key => text(env[key]));
  if (external) return invalid(`gemini_schema_experiment_external_forbidden:${external}`);
  return { active: true, valid: true, config: {
    projectRef: ref,
    supabaseUrl: url.toString().replace(/\/$/, ''),
    supabaseKey: text(env.SUPABASE_SECRET_KEY),
    experimentOwnerAccountId,
    gemini: { apiKey: geminiKey, model: text(env.GEMINI_OWNER_UNDERSTANDING_MODEL) || 'gemini-3.5-flash-lite', timeoutMs: 10000 }
  } };
}

function decideGeminiSchemaExperimentRequest(request, env = process.env) {
  const state = configuration(env);
  if (!state.valid) return { allow: false, status: 503, code: state.code, state };
  if (pathOf(request) !== EXPERIMENT_ROUTE) return { allow: false, status: 403, code: 'gemini_schema_experiment_route_blocked', state };
  if (String(request?.method || 'GET').toUpperCase() !== 'POST') return { allow: false, status: 405, code: 'gemini_schema_experiment_method_not_allowed', state };
  if (!bearer(request)) return { allow: false, status: 401, code: 'gemini_schema_experiment_unauthorized', state };
  return { allow: true, status: 200, code: 'gemini_schema_experiment_allowed', state };
}

function decideGeminiMinimalSchemaExperimentRequest(request, env = process.env) {
  const state = configuration(env);
  if (!state.valid) return { allow: false, status: 503, code: state.code, state };
  if (text(env.YARBI_PREVIEW_GEMINI_MINIMAL_SCHEMA_EXPERIMENT).toLowerCase() !== 'true') return { allow: false, status: 503, code: 'gemini_minimal_schema_experiment_mode_required', state };
  if (pathOf(request) !== MINIMAL_EXPERIMENT_ROUTE) return { allow: false, status: 403, code: 'gemini_minimal_schema_experiment_route_blocked', state };
  if (String(request?.method || 'GET').toUpperCase() !== 'POST') return { allow: false, status: 405, code: 'gemini_minimal_schema_experiment_method_not_allowed', state };
  if (!bearer(request)) return { allow: false, status: 401, code: 'gemini_minimal_schema_experiment_unauthorized', state };
  return { allow: true, status: 200, code: 'gemini_minimal_schema_experiment_allowed', state };
}

module.exports = { PREVIEW_REF, EXPERIMENT_ROUTE, MINIMAL_EXPERIMENT_ROUTE, configuration, decideGeminiSchemaExperimentRequest, decideGeminiMinimalSchemaExperimentRequest };
