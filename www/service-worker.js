const CACHE_NAME = 'fnz-pro-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Instalar el Service Worker y almacenar recursos estáticos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activar y limpiar cachés antiguas
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptar solicitudes y responder desde el caché
self.addEventListener('fetch', e => {
  const isLocal = e.request.url.startsWith(self.location.origin) || e.request.url.startsWith(location.origin);
  if (!isLocal || e.request.method !== 'GET') {
    return; // Dejar pasar peticiones externas de red (Sheets, Notion, Gemini)
  }

  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      if (cachedResponse) {
        // Devolver la respuesta en cache, pero intentar actualizarla en segundo plano para la próxima vez
        fetch(e.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
