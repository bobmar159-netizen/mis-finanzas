const CACHE_NAME = 'yarbi-static-p02i-aa78ce9a4376f7d6';
// runtime-config.js queda fuera del precache: en Android puede cambiar entre
// builds de Preview y debe leerse siempre desde los assets de la APK actual.
// Así una versión anterior no puede apuntar a un entorno ya reemplazado.
const ASSETS = ['./', './index.html', './manifest.json', './yarbi-assistant.js', './yarbi-memory-center.js', './yarbi-owner-inbox-ui.js', './yarbi-avatar-motion.js', './avatar.png', './avatar_circle.png', './mascota.png'];
const assetUrls = () => new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('yarbi-static-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // API, configuración de entorno y respuestas de usuario nunca se guardan.
  const pathname = new URL(event.request.url).pathname;
  if (pathname.includes('/api/') || pathname.endsWith('/runtime-config.js')) return;
  if (!assetUrls().has(event.request.url)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    return response;
  })));
});
