const CACHE_PREFIX = 'helbling-rapporte-';
const CACHE = `${CACHE_PREFIX}v15`;
const STATIC = [
  '/', '/manifest.json', '/css/app.css?v=15', '/js/api.js?v=15', '/js/ui.js?v=15', '/js/app.js?v=15', '/js/pwa.js?v=15',
  '/js/order-fields.js?v=15', '/js/views/admin.js?v=15', '/js/views/planer.js?v=15', '/js/views/monteur.js?v=15',
  '/js/views/tagesuebersicht.js?v=15', '/icons/he-180.png', '/icons/he-192.png', '/icons/he-512.png',
  '/icons/he-maskable-512.png'
];
const STATIC_PATHS = new Set(STATIC.map(asset => new URL(asset, self.location.origin).pathname));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match('/')));
    return;
  }
  if (STATIC_PATHS.has(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
