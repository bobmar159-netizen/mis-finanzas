'use strict';

// Política única para la conversación que puede consultar datos del negocio.
// Preview conserva su aislamiento histórico. Producción debe habilitarse de
// forma explícita y apuntar al proyecto de producción declarado; una clave de
// Gemini por sí sola jamás abre el recorrido propietario.
const { validateServerRouteConfig } = require('./yarbi-runtime-config');
const { configuration: previewConfiguration, decidePreviewOwnerReferenceRequest, bearer } = require('./preview-owner-reference-policy');

const PRODUCTION_REF = 'haifktjvyhbsazmiyqps';

function text(value) { return String(value || '').trim(); }
function enabled(value) { return text(value).toLowerCase() === 'true'; }
function invalid(code, active = true) { return { active, valid: false, code, config: null }; }

function productionConfiguration(env = process.env) {
  if (text(env.VERCEL_ENV).toLowerCase() !== 'production') return invalid('owner_conversation_production_only', false);
  if (!enabled(env.YARBI_OWNER_CONVERSATION_ENABLED)) return invalid('owner_conversation_production_mode_required');
  if (text(env.YARBI_OWNER_CONVERSATION_PROJECT_REF).toLowerCase() !== PRODUCTION_REF) return invalid('owner_conversation_production_project_not_authorized');
  const runtime = validateServerRouteConfig({ env, requirePublicAuth: true });
  if (!runtime.ok) return invalid(runtime.code);
  let url;
  try { url = new URL(runtime.supabaseUrl); } catch (_) { return invalid('owner_conversation_production_supabase_url_invalid'); }
  if (url.hostname.toLowerCase() !== `${PRODUCTION_REF}.supabase.co`) return invalid('owner_conversation_production_supabase_url_not_authorized');
  const geminiEnabled = enabled(env.YARBI_OWNER_CONVERSATION_GEMINI_ENABLED);
  const geminiKey = text(env.GEMINI_API_KEY || env.GEMINI_KEY);
  if (geminiEnabled && !geminiKey) return invalid('owner_conversation_gemini_missing');
  if (geminiKey && !geminiEnabled) return invalid('owner_conversation_gemini_not_enabled');
  if (!text(env.YARBI_TRACE_HMAC_KEY)) return invalid('owner_conversation_trace_hmac_key_missing');
  return {
    active: true,
    valid: true,
    code: 'owner_conversation_production_allowed',
    config: {
      ...runtime,
      projectRef: PRODUCTION_REF,
      gemini: {
        enabled: geminiEnabled,
        apiKey: geminiEnabled ? geminiKey : null,
        model: text(env.GEMINI_OWNER_UNDERSTANDING_MODEL) || text(env.GEMINI_CHAT_MODEL) || 'gemini-3.5-flash-lite',
        timeoutMs: 10000
      }
    }
  };
}

function configuration(env = process.env) {
  if (text(env.VERCEL_ENV).toLowerCase() === 'preview') return previewConfiguration(env);
  return productionConfiguration(env);
}

function decideOwnerConversationRequest(request, env = process.env) {
  if (text(env.VERCEL_ENV).toLowerCase() === 'preview') return decidePreviewOwnerReferenceRequest(request, env);
  const state = productionConfiguration(env);
  if (!state.valid) return { allow: false, status: 503, code: state.code, state };
  if (String(request?.method || 'GET').toUpperCase() !== 'POST') return { allow: false, status: 405, code: 'owner_conversation_method_not_allowed', state };
  if (!bearer(request)) return { allow: false, status: 401, code: 'owner_conversation_unauthorized', state };
  return { allow: true, status: 200, code: 'owner_conversation_allowed', state };
}

module.exports = { PRODUCTION_REF, productionConfiguration, configuration, decideOwnerConversationRequest };
