/* Build template. build-unified-frontend.cjs replaces all placeholders. */
(function () {
  'use strict';
  const config = Object.freeze({
    apiOrigin: '__YARBI_SAME_ORIGIN__',
    environment: 'web',
    releaseId: 'p02i-a4507cabd223698c',
    remoteEnabled: 'true' === 'true',
    nativeAuthCallbackScheme: 'com.misfinanzas.app',
    supabaseUrl: '',
    supabasePublishableKey: ''
  });
  function apiOrigin() {
    if (!config.remoteEnabled) {
      throw new Error('Las operaciones remotas están deshabilitadas en esta compilación local de prueba. No se usó ningún destino alternativo.');
    }
    if (config.apiOrigin === '__YARBI_SAME_ORIGIN__') return window.location.origin;
    try {
      const parsed = new URL(config.apiOrigin);
      if (parsed.protocol !== 'https:') throw new Error('https_required');
      return parsed.origin;
    } catch (_) {
      throw new Error('Configuración de API Yarbi ausente o inválida. La aplicación se detuvo sin usar un destino alternativo.');
    }
  }
  window.gfcRuntimeConfig = config;
  window.gfcRuntimeApiOrigin = apiOrigin;
  window.gfcRuntimeRemoteEnabled = () => config.remoteEnabled;
  window.gfcRuntimeNativeAuthCallbackPrefix = () => `${config.nativeAuthCallbackScheme}://auth/callback`;
  window.gfcRuntimePublicAuthConfig = () => {
    if (!config.supabaseUrl || !config.supabasePublishableKey) return null;
    try {
      const parsed = new URL(config.supabaseUrl);
      if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) return null;
      return Object.freeze({
        supabaseUrl: parsed.origin,
        publishableKey: config.supabasePublishableKey
      });
    } catch (_) {
      return null;
    }
  };
})();
