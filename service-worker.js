const CACHE_NAME = 'yarbi-static-p02i-b2037537e426dff5';
const ASSETS = ['./', './index.html', './manifest.json', './runtime-config.js', './yarbi-assistant.js', './yarbi-memory-center.js', './yarbi-owner-inbox-ui.js', './yarbi-avatar-motion.js', './avatar.png', './avatar_circle.png', './mascota.png'];
const assetUrls = () => new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('yarbi-static-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // API and user-specific responses are intentionally never cached here.
  if (new URL(event.request.url).pathname.includes('/api/')) return;
  if (!assetUrls().has(event.request.url)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    return response;
  })));
});
