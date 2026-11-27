// Altın Saat service worker: önce ağ, olmazsa önbellek.
// İnternet yokken de açılsın; yüz modeli ilk kullanımda önbelleğe alınır.
const ONBELLEK = 'altinsaat-v3';
const KABUK = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'ikon-192.png',
  'js/main.js', 'js/face.js', 'js/arm.js', 'js/speech.js', 'js/score.js', 'data/inme-merkezleri.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(ONBELLEK).then(c => c.addAll(KABUK)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(adlar => Promise.all(adlar.filter(a => a !== ONBELLEK).map(a => caches.delete(a))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(yanit => {
    if (yanit.ok || yanit.type === 'opaque') {
      const kopya = yanit.clone();
      caches.open(ONBELLEK).then(c => c.put(e.request, kopya)).catch(() => {});
    }
    return yanit;
  }).catch(() => caches.match(e.request)));
});
