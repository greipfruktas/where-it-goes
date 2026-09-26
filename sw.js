const CACHE = "where-it-goes-v26";
const ASSETS = [
  "./", "./index.html", "./privacy.html", "./styles.css", "./styles.css?v=26", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./src/groups/domain.js", "./src/groups/supabase.js", "./src/groups/repository.js",
  "./src/groups/view.js", "./src/groups/controller.js", "./supabase/config.js"
  , "./src/personal-sync/domain.js", "./src/personal-sync/storage.js",
  "./src/personal-sync/repository.js", "./src/personal-sync/controller.js"
];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname.endsWith(".supabase.co")) return;
  if (url.origin !== self.location.origin) return;
  if (url.search || url.hash) {
    event.respondWith(fetch(event.request));
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
