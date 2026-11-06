const crypto = require('node:crypto');

// Política separada de la auditoría Fase 1. Solo habilita una pareja mínima
// de handlers para una futura prueba sintética y aislada. No se activa en
// producción ni permite destinos distintos al proyecto de prueba autorizado.
const FUNCTIONAL_ROUTES = new Set(['/api/webhook', '/api/ai/process']);
const SYNTHETIC_PREVIEW_REF = 'uevilhbstnmmdlgyshlv';
const PRODUCTION_REF = 'haifktjvyhbsazmiyqps';
const HISTORICAL_BACKEND_HOST = 'misfinanzas-backend-omar-dfc4.vercel.app';
const PRODUCTION_BACKEND_HOST = 'misfinanzas-backend.vercel.app';
const FORBIDDEN_EXTERNAL_KEYS = [
  'GEMINI_API_KEY', 'GEMINI_KEY', 'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN',
  'YCLOUD_API_KEY', 'YCLOUD_KEY', 'NOTION_TOKEN', 'FNZ_NOTION_TOKEN',
  'GOOGLE_SHEETS_URL', 'GOOGLE_CALENDAR_CLIENT_EMAIL',
  'GOOGLE_CALENDAR_PRIVATE_KEY', 'VERIFY_TOKEN', 'CRON_SECRET'
];

function nonEmpty(value) {
  return String(value || '').trim();
}

function pathOf(request) {
  const raw = String(request?.url || request?.pathname || '');
  try { return new URL(raw, 'https://preview.invalid').pathname; }
  catch (_) { return raw.split('?')[0] || '/'; }
}

function headerOf(request, name) {
  const headers = request?.headers || {};
  if (typeof headers.get === 'function') return nonEmpty(headers.get(name));
  return nonEmpty(headers[String(name).toLowerCase()] || headers[name]);
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(nonEmpty(left));
  const b = Buffer.from(nonEmpty(right));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function syntheticFunctionalMode(env = process.env) {
  return nonEmpty(env.VERCEL_ENV) === 'preview'
    && nonEmpty(env.YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY).toLowerCase() === 'true';
}

function invalid(code) {
  return { active: true, valid: false, code };
}

function validPreviewFunctionalConfig(env = process.env) {
  if (nonEmpty(env.VERCEL_ENV) !== 'preview') return { active: false, valid: true };
  if (!syntheticFunctionalMode(env)) return invalid('functional_preview_mode_required');
  if (nonEmpty(env.YARBI_PREVIEW_AUDIT_ONLY).toLowerCase() === 'true') return invalid('functional_preview_conflicts_with_audit_only');

  const ref = nonEmpty(env.YARBI_PREVIEW_SUPABASE_PROJECT_REF).toLowerCase();
  if (ref !== SYNTHETIC_PREVIEW_REF) return invalid(ref === PRODUCTION_REF ? 'functional_preview_project_ref_is_production' : 'functional_preview_project_ref_not_authorized');

  const supabaseUrl = nonEmpty(env.SUPABASE_URL);
  let supabase;
  try { supabase = new URL(supabaseUrl); } catch (_) { return invalid('functional_preview_supabase_url_missing_or_invalid'); }
  if (supabase.protocol !== 'https:' || supabase.pathname !== '/' || supabase.hostname !== `${SYNTHETIC_PREVIEW_REF}.supabase.co`) {
    return invalid('functional_preview_supabase_url_not_authorized');
  }

  const required = [
    ['SUPABASE_SECRET_KEY', 'functional_preview_supabase_key_invalid'],
    ['YARBI_TRACE_HMAC_KEY', 'functional_preview_trace_hmac_missing'],
    ['ASSISTANT_API_TOKEN', 'functional_preview_assistant_token_missing'],
    ['YARBI_PREVIEW_SYNTHETIC_TOKEN', 'functional_preview_synthetic_token_missing']
  ];
  for (const [name, code] of required) if (nonEmpty(env[name]).length < 32) return invalid(code);

  const configuredHost = nonEmpty(env.YARBI_PREVIEW_DEPLOYMENT_HOST).toLowerCase();
  const processorUrl = nonEmpty(env.AI_PROCESSOR_URL);
  if (!configuredHost || !/^[a-z0-9-]+\.vercel\.app$/.test(configuredHost)) return invalid('functional_preview_deployment_host_invalid');
  let processor;
  try { processor = new URL(processorUrl); } catch (_) { return invalid('functional_preview_processor_url_missing_or_invalid'); }
  if (processor.protocol !== 'https:' || processor.pathname !== '/' || processor.hostname !== configuredHost) return invalid('functional_preview_processor_url_not_authorized');
  if ([HISTORICAL_BACKEND_HOST, PRODUCTION_BACKEND_HOST].includes(configuredHost)) return invalid('functional_preview_processor_host_forbidden');
  if (nonEmpty(env.VERCEL_PROJECT_PRODUCTION_URL)) return invalid('functional_preview_production_deployment_variable_forbidden');
  if (nonEmpty(env.VERCEL_URL) && nonEmpty(env.VERCEL_URL).replace(/^https?:\/\//, '').replace(/\/$/, '') !== configuredHost) return invalid('functional_preview_vercel_url_mismatch');
  if (nonEmpty(env.ENABLE_LEGACY_WEBHOOK_EXTRACTION).toLowerCase() === 'true') return invalid('functional_preview_legacy_extraction_forbidden');
  const external = FORBIDDEN_EXTERNAL_KEYS.find(key => nonEmpty(env[key]));
  if (external) return invalid(`functional_preview_external_integration_forbidden:${external}`);

  return {
    active: true,
    valid: true,
    config: {
      supabaseProjectRef: ref,
      supabaseUrl: supabase.toString().replace(/\/$/, ''),
      deploymentHost: configuredHost,
      syntheticToken: nonEmpty(env.YARBI_PREVIEW_SYNTHETIC_TOKEN),
      assistantToken: nonEmpty(env.ASSISTANT_API_TOKEN)
    }
  };
}

function decidePreviewFunctionalRequest(request, env = process.env) {
  const config = validPreviewFunctionalConfig(env);
  if (!config.active) return { allow: true, status: 200, code: 'functional_preview_inactive', config };
  if (!config.valid) return { allow: false, status: 503, code: config.code, config };
  const path = pathOf(request);
  if (!FUNCTIONAL_ROUTES.has(path)) return { allow: false, status: 403, code: 'functional_preview_route_blocked', config };
  if (String(request?.method || 'GET').toUpperCase() !== 'POST') return { allow: false, status: 405, code: 'functional_preview_method_not_allowed', config };
  if (!constantTimeEqual(headerOf(request, 'x-yarbi-preview-token'), config.config.syntheticToken)) return { allow: false, status: 401, code: 'functional_preview_unauthorized', config };
  if (path === '/api/ai/process' && !constantTimeEqual(headerOf(request, 'x-assistant-token'), config.config.assistantToken)) {
    return { allow: false, status: 401, code: 'functional_preview_processor_unauthorized', config };
  }
  return { allow: true, status: 200, code: 'functional_preview_allowed', config };
}

module.exports = {
  FORBIDDEN_EXTERNAL_KEYS,
  FUNCTIONAL_ROUTES,
  SYNTHETIC_PREVIEW_REF,
  decidePreviewFunctionalRequest,
  syntheticFunctionalMode,
  validPreviewFunctionalConfig
};
