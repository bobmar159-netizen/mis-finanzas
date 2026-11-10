/* Build template. build-unified-frontend.cjs replaces all placeholders. */
(function () {
  'use strict';
  const config = Object.freeze({
    apiOrigin: '__YARBI_API_ORIGIN__',
    environment: '__YARBI_ENVIRONMENT__',
    releaseId: '__YARBI_RELEASE_ID__',
    remoteEnabled: '__YARBI_REMOTE_ENABLED__' === 'true',
    nativeAuthCallbackScheme: '__YARBI_NATIVE_AUTH_CALLBACK_SCHEME__'
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
})();
