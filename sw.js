// Сначала сеть (обновления приходят сразу), без сети — из кэша: редактор работает офлайн.
const V = 'holst-v1';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'js/main.js', 'js/app.js', 'js/model.js', 'js/geom.js', 'js/render.js', 'js/canvas.js', 'js/ui.js', 'js/dom.js', 'js/io.js', 'js/proto.js', 'js/collab.js', 'js/store.js', 'js/demo.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).catch(() => { })); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin && !/unpkg\.com|fonts\.(googleapis|gstatic)\.com/.test(u.host)) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
