const CACHE_NAME = "webtoepub-v5"; // Version 5 - Force Update
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

// Install: Skip waiting to activate immediately
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Activate: Delete all old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("Cleaning up old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch: Network First for app.js
self.addEventListener("fetch", (e) => {
  if (e.request.url.includes("app.js")) {
    e.respondWith(
      fetch(e.request)
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((response) => response || fetch(e.request))
    );
  }
});
