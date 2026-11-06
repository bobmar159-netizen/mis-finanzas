/* Build template. build-unified-frontend.cjs replaces all placeholders. */
(function () {
  'use strict';
  const config = Object.freeze({
    apiOrigin: '__YARBI_API_ORIGIN__',
    environment: '__YARBI_ENVIRONMENT__',
    releaseId: '__YARBI_RELEASE_ID__'
  });
  function apiOrigin() {
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
})();
