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
  '/lessons/s2.html',

  // Story images
  '/story/whole-numbers-en.webp',
  '/story/whole-numbers-hi.webp',
  '/story/fractions-en.webp',
  '/story/fractions-hi.webp',
  '/story/geometry-en.webp',
  '/story/geometry-hi.webp',
  '/story/plants-en.webp',
  '/story/plants-hi.webp',
  '/story/matter-en.webp',
  '/story/matter-hi.webp',

  // Lesson images
  '/images/whole-numbers.svg',
  '/images/fractions.svg',
  '/images/geometry.svg',
  '/images/plants.svg',
  '/images/matter.svg',

  // Worksheets
  '/worksheets/whole-numbers.jpg',
  '/worksheets/fractions.jpg',
  '/worksheets/geometry.png',
  '/worksheets/plants-around-us.png',
  '/worksheets/states-of-matter.png'
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
