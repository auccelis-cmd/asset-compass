// 只快取 App 外殼（網路優先，離線時退回快取）；報價與資料一律走網路。
const CACHE = 'asset-compass-v36';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icon.svg', 'lib-hall-top.webp', 'lib-hall-blur.webp', 'ver-bg.webp', 'yuji-ledger.woff2', 'star-bg.webp', 'sky-starmap.webp?v=1', 'sky-verdant.webp?v=1', 'sky-green.webp?v=1', 'sky-navy.webp?v=1', 'sky-purple.webp?v=1', 'sky-library.webp?v=1', 'sky-ivory.webp?v=1', 'dusk-bg.webp?v=1'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request))
  );
});
