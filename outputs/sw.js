const APP_CACHE = "matchcat-app-v7";
const RUNTIME_CACHE = "matchcat-api-cache-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./cloud-config.js",
  "./matchcat-hero.png",
  "./auto-field.png",
  "./manifest.webmanifest",
];
const DATA_HOSTS = new Set([
  "api.ftcscout.org",
  "ftcscout.org",
  "theorangealliance.org",
  "api.theorangealliance.org",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => {
        const request = new Request(url, { cache: "reload" });
        return cache.add(request);
      })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("matchcat-app-") && key !== APP_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (isFreshAppFile(url)) {
      event.respondWith(networkOnlyWithCacheUpdate(request, APP_CACHE));
      return;
    }

    event.respondWith(networkFirst(request, APP_CACHE, request.mode === "navigate" ? "./index.html" : null));
    return;
  }

  if (DATA_HOSTS.has(url.hostname)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
  }
});

function isFreshAppFile(url) {
  return url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css") ||
    url.pathname.endsWith("/sw.js");
}

async function networkOnlyWithCacheUpdate(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request, { cache: "reload" });
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request) || await cache.match(stripSearch(request.url));
    if (cached) return cached;
    throw error;
  }
}

function stripSearch(url) {
  const parsed = new URL(url);
  parsed.search = "";
  return parsed.href;
}

async function networkFirst(request, cacheName, fallbackUrl = null) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }

    throw error;
  }
}
