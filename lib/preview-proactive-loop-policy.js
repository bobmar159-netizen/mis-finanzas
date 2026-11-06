'use strict';

const crypto = require('node:crypto');

const PROACTIVE_ROUTE = '/api/assistant/proactive-loop';
const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';
const PRODUCTION_REF = 'haifktjvyhbsazmiyqps';
const FORBIDDEN_EXTERNAL_KEYS = [
  'GEMINI_API_KEY', 'GEMINI_KEY', 'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN',
  'YCLOUD_API_KEY', 'YCLOUD_KEY', 'NOTION_TOKEN', 'FNZ_NOTION_TOKEN',
  'GOOGLE_SHEETS_URL', 'GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY',
  'VERIFY_TOKEN'
];

function nonEmpty(value) { return String(value || '').trim(); }
function pathOf(request) {
  try { return new URL(String(request?.url || request?.pathname || ''), 'https://preview.invalid').pathname; }
  catch (_) { return String(request?.url || request?.pathname || '').split('?')[0] || '/'; }
}
function headerOf(request, name) {
  const headers = request?.headers || {};
  return typeof headers.get === 'function' ? nonEmpty(headers.get(name)) : nonEmpty(headers[String(name).toLowerCase()] || headers[name]);
}
function equal(left, right) {
  const a = Buffer.from(nonEmpty(left)); const b = Buffer.from(nonEmpty(right));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function proactiveLoopMode(env = process.env) {
  return nonEmpty(env.VERCEL_ENV) === 'preview' && nonEmpty(env.YARBI_PREVIEW_PROACTIVE_LOOP_ONLY).toLowerCase() === 'true';
}
function invalid(code) { return { active: true, valid: false, code }; }
function validProactiveLoopConfig(env = process.env) {
  if (nonEmpty(env.VERCEL_ENV) !== 'preview') return { active: false, valid: true };
  if (!proactiveLoopMode(env)) return invalid('proactive_preview_mode_required');
  if (nonEmpty(env.YARBI_PREVIEW_AUDIT_ONLY).toLowerCase() === 'true' || nonEmpty(env.YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY).toLowerCase() === 'true') return invalid('proactive_preview_mode_conflict');
  const ref = nonEmpty(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase();
  if (ref !== PREVIEW_REF) return invalid(ref === PRODUCTION_REF ? 'proactive_preview_project_ref_is_production' : 'proactive_preview_project_ref_not_authorized');
  let url;
  try { url = new URL(nonEmpty(env.SUPABASE_URL)); } catch (_) { return invalid('proactive_preview_supabase_url_missing_or_invalid'); }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.hostname !== `${PREVIEW_REF}.supabase.co`) return invalid('proactive_preview_supabase_url_not_authorized');
  if (nonEmpty(env.SUPABASE_SECRET_KEY).length < 32 || nonEmpty(env.CRON_SECRET).length < 32) return invalid('proactive_preview_secret_missing');
  const testMode = nonEmpty(env.YARBI_F3J_REMOTE_TEST_MODE).toLowerCase();
  const testPrefix = nonEmpty(env.YARBI_F3J_REMOTE_FIXTURE_PREFIX);
  if ((testMode || testPrefix) && !(testMode === 'true' && testPrefix === 'F3J-REMOTE-')) return invalid('proactive_preview_fixture_filter_invalid');
  const external = FORBIDDEN_EXTERNAL_KEYS.find(key => nonEmpty(env[key]));
  if (external) return invalid(`proactive_preview_external_integration_forbidden:${external}`);
  return { active: true, valid: true, config: { supabaseUrl: url.toString().replace(/\/$/, ''), projectRef: ref, cronSecret: nonEmpty(env.CRON_SECRET) } };
}
function decidePreviewProactiveLoopRequest(request, env = process.env) {
  const config = validProactiveLoopConfig(env);
  if (!config.active) return { allow: true, status: 200, code: 'proactive_preview_inactive', config };
  if (!config.valid) return { allow: false, status: 503, code: config.code, config };
  if (pathOf(request) !== PROACTIVE_ROUTE) return { allow: false, status: 403, code: 'proactive_preview_route_blocked', config };
  if (String(request?.method || 'GET').toUpperCase() !== 'GET') return { allow: false, status: 405, code: 'proactive_preview_method_not_allowed', config };
  if (!equal(headerOf(request, 'authorization').replace(/^Bearer\s+/i, ''), config.config.cronSecret)) return { allow: false, status: 401, code: 'proactive_preview_unauthorized', config };
  return { allow: true, status: 200, code: 'proactive_preview_allowed', config };
}

module.exports = { FORBIDDEN_EXTERNAL_KEYS, PREVIEW_REF, PROACTIVE_ROUTE, decidePreviewProactiveLoopRequest, proactiveLoopMode, validProactiveLoopConfig };
