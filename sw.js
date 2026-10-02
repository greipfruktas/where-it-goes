const CACHE = "where-it-goes-v27";
const ASSETS = [
  "./", "./index.html", "./privacy.html", "./styles.css", "./styles.css?v=27", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./src/groups/domain.js", "./src/groups/supabase.js", "./src/groups/repository.js",
  "./src/groups/view.js", "./src/groups/controller.js", "./supabase/config.js"
  , "./src/personal-sync/domain.js", "./src/personal-sync/storage.js",
  "./src/personal-sync/repository.js", "./src/personal-sync/controller.js",
  "./vendor/xlsx.full.min.js", "./src/import/swedbank-parser.js", "./src/import/categorizer.js",
  "./src/import/duplicates.js", "./src/import/domain.js", "./src/import/view.js", "./src/import/controller.js"
];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname.endsWith(".supabase.co")) return;
  if (url.origin !== self.location.origin) return;
  if (url.search || url.hash) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || (event.request.mode === "navigate" ? caches.match("./index.html") : undefined))));
});
