'use strict';

const { syntheticFunctionalMode, validPreviewFunctionalConfig } = require('./preview-functional-policy');
const ownerReferencePreview = require('./preview-owner-reference-policy');

const AUDIT_ONLY = value => String(value || '').trim().toLowerCase() === 'true';
const HISTORICAL_BACKEND_HOSTS = new Set([
  'misfinanzas-backend-omar-dfc4.vercel.app',
  'misfinanzas-backend.vercel.app'
]);
const PRODUCTION_SUPABASE_HOST = 'haifktjvyhbsazmiyqps.supabase.co';

function configured(value) {
  return String(value || '').trim();
}

function invalid(code) {
  return { ok: false, code };
}

function parseHttpsUrl(value, missingCode, invalidCode) {
  const raw = configured(value);
  if (!raw) return invalid(missingCode);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return invalid(invalidCode);
    return { ok: true, url: url.toString().replace(/\/$/, '') };
  } catch (_) {
    return invalid(invalidCode);
  }
}

// Configuración de las rutas server-side tradicionales. A diferencia de la
// configuración del procesador, esta función no decide qué host es válido en
// Production: obliga a declararlo en las variables del entorno. Fuera de
// Production rechaza explícitamente el host conocido de Production para que
// una ejecución local o Preview nunca llegue allí por accidente.
function validateServerRouteConfig({ env = process.env, requireProcessor = false, optionalProcessor = false } = {}) {
  const environment = configured(env.VERCEL_ENV).toLowerCase();
  const preview = environment === 'preview';
  const supabase = parseHttpsUrl(
    env.SUPABASE_URL,
    'yarbi_config_supabase_url_missing',
    'yarbi_config_supabase_url_invalid'
  );
  if (!supabase.ok) return supabase;

  if (environment !== 'production' && new URL(supabase.url).hostname.toLowerCase() === PRODUCTION_SUPABASE_HOST) {
    return invalid('yarbi_config_nonproduction_supabase_destination_forbidden');
  }

  const supabaseKey = configured(env.SUPABASE_SECRET_KEY);
  if (!supabaseKey) return invalid('yarbi_config_supabase_key_missing');

  if (preview) {
    if (syntheticFunctionalMode(env)) {
      const functional = validPreviewFunctionalConfig(env);
      if (!functional.valid) return invalid(functional.code);
      if (functional.config.supabaseUrl !== supabase.url) return invalid('yarbi_config_preview_supabase_destination_mismatch');
    } else if (ownerReferencePreview.active(env)) {
      // El modo CRM de referencias tiene una política propia, más restrictiva
      // que el modo funcional: valida Preview, ref aislado, URL exacta, clave
      // de servicio y ausencia de integraciones externas antes de abrir rutas.
      const ownerReference = ownerReferencePreview.configuration(env);
      if (!ownerReference.valid) return invalid(ownerReference.code);
      if (ownerReference.config.supabaseUrl !== supabase.url) return invalid('yarbi_config_preview_supabase_destination_mismatch');
    } else {
      return invalid('yarbi_config_preview_mode_required');
    }
  }

  let processorUrl = '';
  if (requireProcessor || (optionalProcessor && configured(env.AI_PROCESSOR_URL))) {
    const processor = parseHttpsUrl(
      env.AI_PROCESSOR_URL,
      'yarbi_config_processor_url_missing',
      'yarbi_config_processor_url_invalid'
    );
    if (!processor.ok) return processor;
    if (preview) {
      const processorHost = new URL(processor.url).hostname.toLowerCase();
      if (processorHost !== configured(env.YARBI_PREVIEW_DEPLOYMENT_HOST).toLowerCase()) {
        return invalid('yarbi_config_preview_processor_destination_mismatch');
      }
    }
    processorUrl = processor.url;
  }

  return { ok: true, supabaseUrl: supabase.url, supabaseKey, processorUrl };
}

// La decisión depende solo de variables del proceso. Ninguna cabecera HTTP
// puede cambiar el destino de Supabase ni abrir el modo de preview.
function validateRuntimeConfig({ env = process.env, requireProcessor = false } = {}) {
  const preview = configured(env.VERCEL_ENV) === 'preview';
  if (preview && AUDIT_ONLY(env.YARBI_PREVIEW_AUDIT_ONLY)) return invalid('yarbi_config_audit_only_runtime_blocked');

  const supabase = parseHttpsUrl(
    env.SUPABASE_URL,
    'yarbi_config_supabase_url_missing',
    'yarbi_config_supabase_url_invalid'
  );
  if (!supabase.ok) return supabase;
  if (!configured(env.SUPABASE_SECRET_KEY)) return invalid('yarbi_config_supabase_key_missing');

  if (preview) {
    if (syntheticFunctionalMode(env)) {
      const functional = validPreviewFunctionalConfig(env);
      if (!functional.valid) return invalid(functional.code);
      if (functional.config.supabaseUrl !== supabase.url) return invalid('yarbi_config_preview_supabase_destination_mismatch');
    } else if (ownerReferencePreview.active(env)) {
      const ownerReference = ownerReferencePreview.configuration(env);
      if (!ownerReference.valid) return invalid(ownerReference.code);
      if (ownerReference.config.supabaseUrl !== supabase.url) return invalid('yarbi_config_preview_supabase_destination_mismatch');
    } else {
      return invalid('yarbi_config_preview_mode_required');
    }
  }

  let processorUrl = '';
  if (requireProcessor) {
    const processor = parseHttpsUrl(
      env.AI_PROCESSOR_URL,
      'yarbi_config_processor_url_missing',
      'yarbi_config_processor_url_invalid'
    );
    if (!processor.ok) return processor;
    const host = new URL(processor.url).hostname.toLowerCase();
    if (HISTORICAL_BACKEND_HOSTS.has(host)) return invalid('yarbi_config_processor_url_forbidden');
    processorUrl = processor.url;
  }

  return { ok: true, supabaseUrl: supabase.url, processorUrl };
}

module.exports = { validateRuntimeConfig, validateServerRouteConfig };
