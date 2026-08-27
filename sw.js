/* sw.js — offline-first service worker for TAKT.
   Cache-first for the app shell; the app never needs the network. */
'use strict';

const CACHE = 'takt-v2';
// On localhost, prefer the network so development edits are picked up
// immediately; offline still falls back to the cache.
const DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './storage.js',
  './audio-engine.js',
  './rhythm-engine.js',
  './metronome.js',
  './presets.js',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './maskable-192.png',
  './maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        // addAll fails the whole install if one asset 404s; add individually
        // so a missing optional icon cannot break offline support.
        return Promise.allSettled(SHELL.map(function (url) {
          return cache.add(url);
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  // App navigations: serve the cached shell first so the app opens offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then(function (cached) {
        return cached || fetch(req).then(function (res) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
          return res;
        }).catch(function () { return caches.match('./'); });
      })
    );
    return;
  }

  // 'no-cache' makes the browser revalidate every time — essential on
  // localhost where heuristic freshness would otherwise mask edits.
  const network = fetch(req, { cache: DEV ? 'no-cache' : 'default' }).then(function (res) {
    if (res && res.ok && new URL(req.url).origin === self.location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (cached) {
      return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
    });
  });

  if (DEV) {
    // Development: network-first, cache fallback (works offline too).
    e.respondWith(network);
    return;
  }

  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return network;
    })
  );
});
