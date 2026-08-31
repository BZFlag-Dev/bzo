/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// sw.js - Service worker: makes bzo installable and serves its bulky assets
// from disk, without ever letting cached code outlive the server that serves it.
//
// The client/server protocol is lockstep, so code is fetched network-first and
// the cache is only an offline fallback. Textures, audio, models and Three.js
// cannot desync anything, so those are served cache-first out of a cache keyed
// to the client version: a release changes the key and refills it.
//
// The version arrives in the worker's own script URL (`/sw.js?v=1.0.39`).
// Because the registration URL is part of the worker's identity, a release
// installs a genuinely new worker with no build step and no ES module support
// required in workers.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `bzo-v${VERSION}`;

// The shell needed to boot the game. Assets discovered later (textures, models,
// audio, addons) join the cache on first use rather than being listed here.
const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/client.js',
  '/xr-launch.js',
  '/webxr.js',
  '/install.js',
  '/vendor/three/three.module.js',
  '/vendor/three/three.core.js',
  '/favicon.svg',
];

// Paths whose contents change only on release, and which cannot cause a
// protocol desync if they lag. Icons are excluded: a launcher keeps whichever
// one it was shown at install time, so a stale icon is the one kind that
// outlives the cache it came from.
const ASSET_PATHS = /^\/(?:textures|obj|audio|vendor)\//;

self.addEventListener('install', (event) => {
  // Individually, so one missing asset does not fail the whole install.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(
    PRECACHE.map((url) => cache.add(url).catch(() => {})),
  )));
});

self.addEventListener('activate', (event) => {
  // Drop every other version's cache, then take over already-open pages.
  // Note there is no skipWaiting: a new worker waits for the next launch rather
  // than swapping the game's code out from under a running match.
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Live server state: never cached, never intercepted.
  if (url.pathname.startsWith('/api/') || url.pathname === '/manifest.webmanifest') return;

  if (ASSET_PATHS.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigations, HTML and JavaScript. `no-cache` on these responses means the
  // common case is a cheap 304 revalidation rather than a re-download, so this
  // stays fast while guaranteeing the running code matches the server.
  event.respondWith(networkFirst(request));
});
