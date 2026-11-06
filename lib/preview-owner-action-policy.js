'use strict';

const crypto = require('node:crypto');
const OWNER_ACTION_ROUTE = '/api/assistant/owner-action';
const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';
const PRODUCTION_REF = 'haifktjvyhbsazmiyqps';
const FORBIDDEN_KEYS = ['GEMINI_API_KEY','GEMINI_KEY','META_ACCESS_TOKEN','WHATSAPP_TOKEN','YCLOUD_API_KEY','YCLOUD_KEY','NOTION_TOKEN','FNZ_NOTION_TOKEN','GOOGLE_SHEETS_URL','GOOGLE_CALENDAR_CLIENT_EMAIL','GOOGLE_CALENDAR_PRIVATE_KEY'];
function value(input) { return String(input || '').trim(); }
function active(env = process.env) { return value(env.VERCEL_ENV) === 'preview' && value(env.YARBI_PREVIEW_OWNER_ACTION_ONLY).toLowerCase() === 'true'; }
function pathOf(request) { try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid').pathname; } catch (_) { return '/'; } }
function equal(left, right) { const a = Buffer.from(value(left)); const b = Buffer.from(value(right)); return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b); }
function configuration(env = process.env) {
  if (value(env.VERCEL_ENV) !== 'preview') return { active: false, valid: true };
  if (!active(env)) return { active: true, valid: false, code: 'owner_action_preview_mode_required' };
  if (value(env.YARBI_PREVIEW_AUDIT_ONLY).toLowerCase() === 'true' || value(env.YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY).toLowerCase() === 'true' || value(env.YARBI_PREVIEW_PROACTIVE_LOOP_ONLY).toLowerCase() === 'true') return { active: true, valid: false, code: 'owner_action_preview_mode_conflict' };
  if (value(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase() !== PREVIEW_REF) return { active: true, valid: false, code: value(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase() === PRODUCTION_REF ? 'owner_action_preview_project_is_production' : 'owner_action_preview_project_not_authorized' };
  let url; try { url = new URL(value(env.SUPABASE_URL)); } catch (_) { return { active: true, valid: false, code: 'owner_action_preview_supabase_url_invalid' }; }
  if (url.protocol !== 'https:' || url.hostname !== `${PREVIEW_REF}.supabase.co` || url.pathname !== '/') return { active: true, valid: false, code: 'owner_action_preview_supabase_url_not_authorized' };
  if (value(env.SUPABASE_SECRET_KEY).length < 32 || value(env.YARBI_OWNER_ACTION_TOKEN).length < 32) return { active: true, valid: false, code: 'owner_action_preview_secret_missing' };
  const external = FORBIDDEN_KEYS.find(key => value(env[key]));
  if (external) return { active: true, valid: false, code: `owner_action_preview_external_forbidden:${external}` };
  return {
    active: true,
    valid: true,
    token: value(env.YARBI_OWNER_ACTION_TOKEN),
    supabaseUrl: url.toString().replace(/\/$/, ''),
    supabaseKey: value(env.SUPABASE_SECRET_KEY)
  };
}
function decidePreviewOwnerActionRequest(request, env = process.env) {
  const config = configuration(env);
  if (!config.active || !config.valid) return config.active ? { allow: false, status: 503, code: config.code } : { allow: true, status: 200, code: 'owner_action_preview_inactive' };
  if (pathOf(request) !== OWNER_ACTION_ROUTE) return { allow: false, status: 403, code: 'owner_action_preview_route_blocked' };
  if (String(request?.method || '').toUpperCase() !== 'POST') return { allow: false, status: 405, code: 'owner_action_preview_method_not_allowed' };
  const bearer = String(request?.headers?.authorization || request?.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  return equal(bearer, config.token) ? { allow: true, status: 200, code: 'owner_action_preview_allowed' } : { allow: false, status: 401, code: 'owner_action_preview_unauthorized' };
}
module.exports = { OWNER_ACTION_ROUTE, active, configuration, decidePreviewOwnerActionRequest };
