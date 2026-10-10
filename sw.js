// 只快取 App 外殼（網路優先）；資料一律走網路
const CACHE = 'lunaria-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'cycle.js', 'config.js', 'manifest.webmanifest', 'icon.svg', 'bg-moss-day.webp', 'bg-moss-night.webp', 'bg-mist-day.webp', 'bg-mist-night.webp', 'bg-blush-day.webp', 'bg-blush-night.webp', 'yuji-luna.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
