// Service worker: ทำให้ติดตั้งเป็นแอปได้ และเปิดได้แม้เน็ตหลุด (ใช้ไฟล์ล่าสุดที่เคยโหลด)
// ดึงจากเน็ตก่อนเสมอ -> config.json / index.html ที่อัปเดตบน GitHub จะเห็นทันที
const CACHE = 'cps-portal-v1';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon.webp', 'icon-192.png', 'icon-512.png', 'favicon.png'];

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
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('index.html')))
  );
});
