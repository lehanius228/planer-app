// Планер: работа без интернета и уведомления о напоминаниях.
const CACHE = 'planer-v2';
const SHELL = ['./', 'index.html', 'parse_ru.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'badge.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Свои файлы: сначала сеть (чтобы обновления приходили сразу), без сети - из кэша. GitHub API не трогаем.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('index.html')))
  );
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {title: 'Планер', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Планер', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'badge.png',
    tag: d.id || undefined,
    renotify: true,
    requireInteraction: ['meeting', 'reminder', 'deadline'].includes(d.type),
    data: {id: d.id},
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if (id) c.postMessage({open: id}); return; }
    }
    await self.clients.openWindow('./' + (id ? '?open=' + id : ''));
  })());
});
