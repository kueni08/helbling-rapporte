const CACHE_PREFIX = 'helbling-rapporte-';
const CACHE = `${CACHE_PREFIX}v14`;
const STATIC = [
  '/', '/manifest.json', '/css/app.css', '/js/api.js', '/js/ui.js', '/js/app.js', '/js/pwa.js',
  '/js/order-fields.js', '/js/views/admin.js', '/js/views/planer.js', '/js/views/monteur.js',
  '/js/views/tagesuebersicht.js', '/icons/he-180.png', '/icons/he-192.png', '/icons/he-512.png',
  '/icons/he-maskable-512.png'
];

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
  if (STATIC.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
