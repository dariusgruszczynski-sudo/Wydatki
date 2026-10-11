const VERSION = 'pt-v2-1';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/js/main.js',
  '/js/api.js',
  '/js/store.js',
  '/js/router.js',
  '/js/ui/dom.js',
  '/js/ui/overlay.js',
  '/js/ui/fx.js',
  '/js/ui/cards.js',
  '/js/ui/table.js',
  '/js/ui/grid.js',
  '/js/ui/charts.js',
  '/js/ui/input.js',
  '/js/ui/illustrations.js',
  '/js/views/login.js',
  '/js/views/home.js',
  '/js/views/train.js',
  '/js/views/spotplayer.js',
  '/js/views/drills.js',
  '/js/views/learn.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  // Sieć najpierw (świeży kod po wdrożeniu), cache jako zapas offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

self.addEventListener('push', (e) => {
  let data = { title: 'Poker Trener', body: 'Czas na trening!', url: '/' };
  try {
    data = { ...data, ...e.data.json() };
  } catch {
    /* zostaw domyślne */
  }
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: data.url } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus().then(() => c.navigate(url));
      return self.clients.openWindow(url);
    })
  );
});
