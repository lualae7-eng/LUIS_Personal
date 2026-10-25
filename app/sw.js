/* FORJA · service worker: abre sin red. Los datos no pasan por aquí. */
const CACHE = 'forja-luis-1.0.1';
const BASE = ['/', '/index.html', '/app.css', '/app.js', '/fin-calc.js', '/finanzas.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // El Apps Script nunca se guarda en caché.
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;

  if (url.origin === location.origin) {
    // Red primero para tener siempre la versión nueva; caché si no hay red.
    e.respondWith(fetch(e.request).then(r => {
      const copia = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copia = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copia));
      return res;
    })));
  }
});
