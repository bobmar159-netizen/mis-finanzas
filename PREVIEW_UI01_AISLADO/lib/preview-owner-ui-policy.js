'use strict';

const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';
const PRODUCTION_REF = 'haifktjvyhbsazmiyqps';
const INBOX_ROUTE = '/api/assistant/owner-inbox';
const ACTION_ROUTE = '/api/assistant/owner-action';
const FORBIDDEN = ['GEMINI_API_KEY','GEMINI_KEY','META_ACCESS_TOKEN','WHATSAPP_TOKEN','YCLOUD_API_KEY','YCLOUD_KEY','NOTION_TOKEN','FNZ_NOTION_TOKEN','GOOGLE_SHEETS_URL','GOOGLE_CALENDAR_CLIENT_EMAIL','GOOGLE_CALENDAR_PRIVATE_KEY','CRON_SECRET'];

function text(value) { return String(value || '').trim(); }
function pathOf(request) { try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid').pathname; } catch (_) { return '/'; } }
function queryOf(request) { try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid').searchParams; } catch (_) { return new URLSearchParams(); } }
function bearer(request) { return text(request?.headers?.authorization || request?.headers?.Authorization).replace(/^Bearer\s+/i, ''); }
function active(env = process.env) { return text(env.VERCEL_ENV) === 'preview' && text(env.YARBI_PREVIEW_OWNER_UI_ONLY).toLowerCase() === 'true'; }
function invalid(code) { return { active: true, valid: false, code }; }
function wantsAuthConfig(request) { return pathOf(request) === INBOX_ROUTE && String(request?.method || 'GET').toUpperCase() === 'GET' && queryOf(request).get('mode') === 'auth-config'; }

function configuration(env = process.env) {
  if (text(env.VERCEL_ENV) !== 'preview') return { active: false, valid: true };
  if (!active(env)) return invalid('owner_ui_preview_mode_required');
  if (['YARBI_PREVIEW_AUDIT_ONLY','YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY','YARBI_PREVIEW_PROACTIVE_LOOP_ONLY','YARBI_PREVIEW_OWNER_ACTION_ONLY'].some(key => text(env[key]).toLowerCase() === 'true')) return invalid('owner_ui_preview_mode_conflict');
  const ref = text(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase();
  if (ref !== PREVIEW_REF) return invalid(ref === PRODUCTION_REF ? 'owner_ui_preview_project_is_production' : 'owner_ui_preview_project_not_authorized');
  let url; try { url = new URL(text(env.SUPABASE_URL)); } catch (_) { return invalid('owner_ui_preview_supabase_url_invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== `${PREVIEW_REF}.supabase.co` || url.pathname !== '/') return invalid('owner_ui_preview_supabase_url_not_authorized');
  if (text(env.SUPABASE_SECRET_KEY).length < 32) return invalid('owner_ui_preview_secret_missing');
  if (text(env.SUPABASE_PUBLISHABLE_KEY).length < 20) return invalid('owner_ui_preview_publishable_key_missing');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text(env.YARBI_OWNER_ACCOUNT_ID))) return invalid('owner_ui_preview_owner_account_missing');
  const external = FORBIDDEN.find(key => text(env[key]));
  if (external) return invalid(`owner_ui_preview_external_forbidden:${external}`);
  return { active: true, valid: true, config: {
    projectRef: ref,
    supabaseUrl: url.toString().replace(/\/$/, ''),
    supabaseKey: text(env.SUPABASE_SECRET_KEY),
    publishableKey: text(env.SUPABASE_PUBLISHABLE_KEY),
    ownerAccountId: text(env.YARBI_OWNER_ACCOUNT_ID),
    ownerKey: text(env.YARBI_OWNER_INBOX_OWNER_KEY) || 'primary'
  } };
}

function decidePreviewOwnerUiRequest(request, env = process.env) {
  const state = configuration(env);
  if (!state.active) return { allow: false, status: 503, code: 'owner_ui_preview_mode_required', state };
  if (!state.valid) return { allow: false, status: 503, code: state.code, state };
  const path = pathOf(request); const method = String(request?.method || 'GET').toUpperCase();
  if (wantsAuthConfig(request)) return { allow: true, status: 200, code: 'owner_ui_preview_auth_config', state, publicConfig: true };
  if (!((path === INBOX_ROUTE && method === 'GET') || (path === ACTION_ROUTE && method === 'POST'))) return { allow: false, status: path === INBOX_ROUTE || path === ACTION_ROUTE ? 405 : 403, code: 'owner_ui_preview_route_blocked', state };
  if (!bearer(request)) return { allow: false, status: 401, code: 'owner_ui_preview_unauthorized', state };
  return { allow: true, status: 200, code: 'owner_ui_preview_allowed', state };
}

module.exports = { ACTION_ROUTE, INBOX_ROUTE, PREVIEW_REF, active, bearer, configuration, decidePreviewOwnerUiRequest, wantsAuthConfig };
