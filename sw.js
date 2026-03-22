const CACHE_NAME = "gestalt-village-v14";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/config.js",
  "./src/constants.js",
  "./src/dom.js",
  "./src/render/world.js",
  "./src/state.js",
  "./src/ui/log.js",
  "./src/ui/panels.js",
  "./src/utils.js",
  "./src/workers/reasoning-worker.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
