// Service Worker: Offline-Start + Benachrichtigungen
const CACHE = 'laufcoach-v4';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    // alte Bundles aufräumen: nur die Assets behalten, die die aktuelle Seite braucht
    .then(() => caches.open(CACHE)).then((c) => c.keys().then((reqs) => Promise.all(reqs.filter((r) => r.url.includes('/assets/')).map((r) => c.delete(r)))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('version.json')) return;
  // Netz zuerst (Seiten ohne HTTP-Cache), bei Offline aus dem Cache
  const req = e.request.mode === 'navigate' ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
    }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data ? e.data.text() : 'Laufcoach' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Laufcoach', {
    body: d.body || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: d.url || './#heute' }, tag: d.tag || undefined,
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './#heute', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
