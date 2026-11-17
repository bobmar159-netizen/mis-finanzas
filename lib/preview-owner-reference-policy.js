'use strict';

// Modo de lectura autenticada de referencias. No comparte el owner fijo de
// UI-01: la identidad viene de la sesión y el alcance sale de la relación
// canónica yarbi_owner_contact_scope.
const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';
const PRODUCTION_REF = 'haifktjvyhbsazmiyqps';
const REFERENCE_ROUTE = '/api/assistant/reference-candidates';
const CRM_SEARCH_ROUTE = '/api/assistant/crm-search';
const CRM_DOSSIER_ROUTE = '/api/assistant/crm-dossier';
const CONVERSATION_ROUTE = '/api/assistant/conversation';
const OWNER_MEMORY_ROUTE = '/api/assistant/memory';
const AUTH_CONFIG_ROUTE = '/api/assistant/preferences';
const META_ADS_ROUTE = '/api/assistant/meta-ads';
const OWNER_READ_ROUTES = new Set([REFERENCE_ROUTE, CRM_SEARCH_ROUTE, CRM_DOSSIER_ROUTE, CONVERSATION_ROUTE, OWNER_MEMORY_ROUTE, META_ADS_ROUTE]);
const FORBIDDEN = ['META_ACCESS_TOKEN','WHATSAPP_TOKEN','YCLOUD_API_KEY','YCLOUD_KEY','NOTION_TOKEN','FNZ_NOTION_TOKEN','GOOGLE_SHEETS_URL','GOOGLE_CALENDAR_CLIENT_EMAIL','GOOGLE_CALENDAR_PRIVATE_KEY','CRON_SECRET'];
const CONFLICTS = ['YARBI_PREVIEW_AUDIT_ONLY','YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY','YARBI_PREVIEW_PROACTIVE_LOOP_ONLY','YARBI_PREVIEW_OWNER_ACTION_ONLY','YARBI_PREVIEW_OWNER_UI_ONLY'];

function text(value) { return String(value || '').trim(); }
function pathOf(request) { try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid').pathname; } catch (_) { return '/'; } }
function urlOf(request) { try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid'); } catch (_) { return null; } }
function bearer(request) { return text(request?.headers?.authorization || request?.headers?.Authorization).replace(/^Bearer\s+/i, ''); }
function active(env = process.env) { return text(env.VERCEL_ENV) === 'preview' && text(env.YARBI_PREVIEW_OWNER_REFERENCES_ONLY).toLowerCase() === 'true'; }
function invalid(code) { return { active: true, valid: false, code }; }

function configuration(env = process.env) {
  // El handler se protege también cuando alguien intenta invocarlo sin pasar
  // por proxy.js: fuera de Preview nunca puede ser una ruta operativa.
  if (text(env.VERCEL_ENV) !== 'preview') return invalid('owner_reference_preview_only');
  if (!active(env)) return invalid('owner_reference_preview_mode_required');
  if (CONFLICTS.some(key => text(env[key]).toLowerCase() === 'true')) return invalid('owner_reference_preview_mode_conflict');
  const ref = text(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase();
  if (ref !== PREVIEW_REF) return invalid(ref === PRODUCTION_REF ? 'owner_reference_preview_project_is_production' : 'owner_reference_preview_project_not_authorized');
  let url; try { url = new URL(text(env.SUPABASE_URL)); } catch (_) { return invalid('owner_reference_preview_supabase_url_invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== `${PREVIEW_REF}.supabase.co` || url.pathname !== '/') return invalid('owner_reference_preview_supabase_url_not_authorized');
  if (text(env.SUPABASE_SECRET_KEY).length < 32) return invalid('owner_reference_preview_secret_missing');
  const geminiEnabled = text(env.YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING).toLowerCase() === 'true';
  // El aprendizaje histórico nunca se habilita por el mero hecho de que el
  // parser conversacional tenga Gemini disponible. Requiere una segunda
  // bandera exclusiva y sigue procesando un solo segmento confirmado.
  const historicalIntelligenceEnabled = text(env.YARBI_PREVIEW_HISTORICAL_INTELLIGENCE_ENABLED).toLowerCase() === 'true';
  const geminiKey = text(env.GEMINI_API_KEY || env.GEMINI_KEY);
  // Gemini se habilita solo de forma explícita para el parser semántico de
  // esta ruta. Una clave presente sin la bandera es un fallo cerrado.
  if (geminiKey && !geminiEnabled) return invalid('owner_reference_preview_gemini_not_enabled');
  if (geminiEnabled && !geminiKey) return invalid('owner_reference_preview_gemini_missing');
  if (historicalIntelligenceEnabled && !geminiEnabled) return invalid('owner_reference_preview_historical_intelligence_requires_gemini');
  const external = FORBIDDEN.find(key => text(env[key]));
  if (external) return invalid(`owner_reference_preview_external_forbidden:${external}`);
  return { active: true, valid: true, config: {
    projectRef: ref, supabaseUrl: url.toString().replace(/\/$/, ''), supabaseKey: text(env.SUPABASE_SECRET_KEY),
    // La sesión de usuario se valida con la publishable key; la secret key
    // queda reservada para las lecturas server-side posteriores al Bearer.
    supabasePublishableKey: text(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY),
    gemini: { enabled: geminiEnabled, apiKey: geminiKey || null, model: text(env.GEMINI_OWNER_UNDERSTANDING_MODEL) || 'gemini-3.5-flash-lite', timeoutMs: 10000 },
    historicalIntelligence: { enabled: historicalIntelligenceEnabled }
  } };
}

function decidePreviewOwnerReferenceRequest(request, env = process.env) {
  const state = configuration(env);
  if (!state.active) return { allow: true, status: 200, code: 'owner_reference_preview_inactive', state };
  if (!state.valid) return { allow: false, status: 503, code: state.code, state };
  const path = pathOf(request); const method = String(request?.method || 'GET').toUpperCase();
  // Auth necesita conocer solamente la URL pública y la publishable key para
  // obtener un Bearer. Esta excepción no expone datos, no acepta parámetros
  // adicionales y no autoriza ninguna otra acción de preferences.
  const requestUrl = urlOf(request);
  if (path === META_ADS_ROUTE && method === 'GET' && requestUrl?.searchParams.get('action') === 'callback') {
    const keys = [...requestUrl.searchParams.keys()];
    const allowed = new Set(['action', 'code', 'state', 'error', 'error_description', 'error_reason', 'error_code']);
    if (keys.every(key => allowed.has(key)) && keys.includes('state') && (keys.includes('code') || keys.includes('error') || keys.includes('error_reason') || keys.includes('error_code'))) {
      return { allow: true, status: 200, code: 'owner_reference_preview_meta_oauth_callback_allowed', state };
    }
    return { allow: false, status: 400, code: 'owner_reference_preview_meta_oauth_callback_invalid', state };
  }
  if (path === AUTH_CONFIG_ROUTE && method === 'GET' && requestUrl?.searchParams.get('action') === 'auth-config' && [...requestUrl.searchParams.keys()].every(key => key === 'action')) {
    return { allow: true, status: 200, code: 'owner_reference_preview_auth_config_allowed', state };
  }
  if (!OWNER_READ_ROUTES.has(path)) return { allow: false, status: 403, code: 'owner_reference_preview_route_blocked', state };
  if (path === META_ADS_ROUTE) {
    const action = requestUrl?.searchParams.get('action') || '';
    if ((method === 'GET' && !['status', 'insights'].includes(action)) || (method === 'POST' && !['connect', 'select-account', 'sync', 'disconnect', 'save-budget'].includes(action))) {
      return { allow: false, status: 403, code: 'owner_reference_preview_meta_ads_action_blocked', state };
    }
  } else if (method !== 'POST') return { allow: false, status: 405, code: 'owner_reference_preview_method_not_allowed', state };
  if (!bearer(request)) return { allow: false, status: 401, code: 'owner_reference_preview_unauthorized', state };
  return { allow: true, status: 200, code: 'owner_reference_preview_allowed', state };
}

module.exports = { PREVIEW_REF, REFERENCE_ROUTE, CRM_SEARCH_ROUTE, CRM_DOSSIER_ROUTE, CONVERSATION_ROUTE, OWNER_MEMORY_ROUTE, AUTH_CONFIG_ROUTE, active, bearer, configuration, decidePreviewOwnerReferenceRequest };
