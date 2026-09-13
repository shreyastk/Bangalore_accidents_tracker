const CACHE = 'bat-safety-v1';
const SHELL = ['/', '/index.html', '/dashboard.html', '/report.html', '/emergency.html', '/civic.html', '/css/main.css', '/css/dashboard.css', '/js/bat-config.js', '/js/i18n.js', '/js/pwa.js', '/logo.png'];

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && new URL(event.request.url).origin === self.location.origin) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match('/index.html'))));
});
