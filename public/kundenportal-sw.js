const CACHE = 'helbling-kundenportal-v2';
const SHELL = ['/kundenportal','/css/kundenportal.css','/js/kundenportal.js','/kundenportal-manifest.webmanifest','/icons/icon.svg','/icons/kundenportal-192.png','/icons/kundenportal-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')) return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>caches.match('/kundenportal')));
    return;
  }
  if(SHELL.includes(url.pathname)) event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
