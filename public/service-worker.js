const CACHE_NAME = 'offlineorbit-v28';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/syllabus.json',

  // Lessons
  '/lessons/l1.html',
  '/lessons/l2.html',
  '/lessons/l3.html',
  '/lessons/s1.html',
  '/lessons/s2.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        const networkRequest = fetch(event.request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();

              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, copy);
                })
                .catch(() => {});
            }

            return response;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkRequest;
      })
      .catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }

        return new Response('Offline', {
          status: 503,
          statusText: 'Offline'
        });
      })
  );
});
