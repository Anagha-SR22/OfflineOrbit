const CACHE_NAME = 'offlineorbit-v26-logo-live-board';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/syllabus.json',
  '/src/core/app-shell.js',
  '/src/core/router.js',
  '/src/core/syllabus-view.js',
  '/src/core/connection-status.js',
  '/src/shared/db.js',
  '/src/shared/live-signal.js',
  '/src/dashboard/dashboard.js',
  '/src/lessons/lesson-runtime.js',
  '/branding/favicon.ico',
  '/branding/favicon-32.png',
  '/branding/favicon-16.png',
  '/branding/logo-32.png',
  '/branding/logo-64.png',
  '/branding/logo-192.png',
  '/branding/logo-512.png',
  '/lessons/l1.html',
  '/lessons/l2.html',
  '/lessons/l3.html',
  '/lessons/s1.html',
  '/lessons/s2.html',
  '/images/whole-numbers.svg',
  '/images/fractions.svg',
  '/images/geometry.svg',
  '/worksheets/whole-numbers.jpg',
  '/worksheets/fractions.jpg',
  '/worksheets/geometry.png',
  '/worksheets/plants-around-us.png',
  '/worksheets/states-of-matter.png',
  '/story/whole-numbers-en.webp',
  '/story/whole-numbers-hi.webp',
  '/story/fractions-en.webp',
  '/story/fractions-hi.webp',
  '/story/geometry-en.webp',
  '/story/geometry-hi.webp',
  '/story/plants-en.webp',
  '/story/plants-hi.webp',
  '/story/matter-en.webp',
  '/story/matter-hi.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/index.html');
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }))
  );
});
