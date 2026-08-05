/* DailyWork service worker.
 *
 * Strategy:
 *   - Navigations (HTML): network-first, falling back to the cached app shell
 *     ("/") so the SPA still opens offline.
 *   - Same-origin /assets/* (Vite's content-hashed, immutable bundles):
 *     cache-first, populating the cache from the network on first request.
 *   - Everything else — most importantly cross-origin Supabase API calls —
 *     is NOT intercepted and goes straight to the network untouched.
 *
 * Bump CACHE_VERSION whenever the caching logic changes; activate() drops
 * every cache that doesn't match the current name.
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `dailywork-${CACHE_VERSION}`;
const PRECACHE_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // Activate this worker immediately instead of waiting for old tabs.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      )
      // Take control of already-open clients so the new worker applies on next load.
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never touch cross-origin requests (Supabase API/auth live on another
  // origin) — let the browser handle them directly.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so deploys show up, cached shell as fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Hashed immutable assets: cache-first, then network (caching the result).
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
  // All other same-origin requests fall through to the network untouched.
});
