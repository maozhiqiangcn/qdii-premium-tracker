const CACHE_NAME = "lof-premium-mobile-v5";
const ASSETS = [
  "./mobile.html",
  "./mobile.css",
  "./mobile-config.js",
  "./mobile-data.js",
  "./mobile.js",
  "./client-runtime.js",
  "./miniprogram/utils/fund-core.js",
  "./manifest.webmanifest",
  "./icon.svg",
];
const STATIC_PATHS = new Set(ASSETS.map((asset) => new URL(asset, self.location.href).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !STATIC_PATHS.has(url.pathname)) return;

  const cacheKey = new Request(`${url.origin}${url.pathname}`);
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, response.clone()));
        return response;
      })
      .catch(() => caches.match(cacheKey)),
  );
});
