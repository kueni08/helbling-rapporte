const CACHE = 'hr-v6';
const STATIC = ['/css/app.css', '/js/api.js', '/js/ui.js', '/js/app.js',
  '/js/order-fields.js', '/js/views/admin.js', '/js/views/planer.js', '/js/views/monteur.js',
  '/js/views/tagesuebersicht.js', '/icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // API-Anfragen nie cachen
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
