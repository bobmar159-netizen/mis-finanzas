const crypto = require('node:crypto');
const AUDIT_ROUTE = '/api/audit/trace';
const KNOWN_PRODUCTION_SUPABASE_REF = 'haifktjvyhbsazmiyqps';
const EXTERNAL_INTEGRATION_KEYS = ['GEMINI_API_KEY','GEMINI_KEY','META_ACCESS_TOKEN','WHATSAPP_TOKEN','YCLOUD_API_KEY','YCLOUD_KEY','NOTION_TOKEN','FNZ_NOTION_TOKEN','GOOGLE_SHEETS_URL','GOOGLE_CALENDAR_CLIENT_EMAIL','GOOGLE_CALENDAR_PRIVATE_KEY','VERIFY_TOKEN','CRON_SECRET','AI_PROCESSOR_URL'];
const nonEmpty = value => String(value || '').trim();
function pathOf(request) { const raw = String(request?.url || request?.pathname || ''); try { return new URL(raw, 'https://audit.invalid').pathname; } catch (_) { return raw.split('?')[0] || '/'; } }
function headerOf(request, name) { const headers = request?.headers || {}; return nonEmpty(typeof headers.get === 'function' ? headers.get(name) : headers[String(name).toLowerCase()] || headers[name]); }
function same(left, right) { const a = Buffer.from(nonEmpty(left)); const b = Buffer.from(nonEmpty(right)); return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b); }
function invalid(code) { return { active: true, valid: false, code }; }
function validPreviewAuditConfig(env = process.env) {
  if (nonEmpty(env.VERCEL_ENV) !== 'preview') return { active: false, valid: true };
  if (nonEmpty(env.YARBI_PREVIEW_AUDIT_ONLY).toLowerCase() !== 'true') return invalid('audit_preview_mode_required');
  const ref = nonEmpty(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(ref)) return invalid('audit_preview_project_ref_invalid');
  if (ref === KNOWN_PRODUCTION_SUPABASE_REF || ref === nonEmpty(env.YARBI_PRODUCTION_SUPABASE_PROJECT_REF).toLowerCase()) return invalid('audit_preview_project_ref_is_production');
  let parsed; try { parsed = new URL(nonEmpty(env.SUPABASE_URL)); } catch (_) { return invalid('audit_preview_supabase_url_missing_or_invalid'); }
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.hostname !== `${ref}.supabase.co`) return invalid('audit_preview_supabase_url_not_authorized');
  if (nonEmpty(env.SUPABASE_SECRET_KEY).length < 32) return invalid('audit_preview_supabase_key_invalid');
  if (nonEmpty(env.YARBI_TRACE_HMAC_KEY).length < 32) return invalid('audit_preview_trace_hmac_missing');
  if (nonEmpty(env.YARBI_AUDIT_TOKEN).length < 32) return invalid('audit_preview_audit_token_missing');
  if (nonEmpty(env.ENABLE_LEGACY_WEBHOOK_EXTRACTION).toLowerCase() === 'true') return invalid('audit_preview_legacy_processing_forbidden');
  const externalKey = EXTERNAL_INTEGRATION_KEYS.find(key => nonEmpty(env[key])); if (externalKey) return invalid(`audit_preview_external_integration_forbidden:${externalKey}`);
  return { active: true, valid: true, config: { supabaseUrl: parsed.toString().replace(/\/$/, ''), supabaseProjectRef: ref, supabaseKey: nonEmpty(env.SUPABASE_SECRET_KEY), traceHmacKey: nonEmpty(env.YARBI_TRACE_HMAC_KEY), auditToken: nonEmpty(env.YARBI_AUDIT_TOKEN) } };
}
function decidePreviewAuditRequest(request, env = process.env) {
  const config = validPreviewAuditConfig(env); if (!config.active) return { allow: true, status: 200, code: 'audit_preview_inactive', config }; if (!config.valid) return { allow: false, status: 503, code: config.code, config };
  if (pathOf(request) !== AUDIT_ROUTE) return { allow: false, status: 403, code: 'audit_preview_route_blocked', config };
  if (String(request?.method || 'GET').toUpperCase() !== 'POST') return { allow: false, status: 405, code: 'audit_preview_method_not_allowed', config };
  if (!same(headerOf(request, 'x-yarbi-audit-token'), config.config.auditToken)) return { allow: false, status: 401, code: 'audit_preview_unauthorized', config };
  return { allow: true, status: 200, code: 'audit_preview_allowed', config };
}
module.exports = { AUDIT_ROUTE, EXTERNAL_INTEGRATION_KEYS, decidePreviewAuditRequest, validPreviewAuditConfig };
