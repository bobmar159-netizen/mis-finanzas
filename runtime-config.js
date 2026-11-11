/* Build template. build-unified-frontend.cjs replaces all placeholders. */
(function () {
  'use strict';
  const config = Object.freeze({
    apiOrigin: '__YARBI_SAME_ORIGIN__',
    environment: 'web',
    releaseId: 'p02i-d48afcb527fea951',
    remoteEnabled: 'true' === 'true',
    nativeAuthCallbackScheme: 'com.misfinanzas.app'
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
