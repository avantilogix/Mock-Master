const CACHE = 'mission-selection-offline-v1';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('/offline.html')));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('mission-selection-offline-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const fallback = await caches.match('/offline.html');
    return fallback || Response.error();
  }));
});
