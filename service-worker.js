"use strict";

const CACHE_NAME = "lecto-shell-v3";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/lecto-icon.svg",
  "./icons/lecto-icon-180.png",
  "./icons/lecto-icon-192.png",
  "./icons/lecto-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith("lecto-shell-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin ||
    event.request.headers.has("range")
  ) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          cache.put("./index.html", response.clone())
            .catch(error => console.warn("Could not update the cached Lecto page.", error));
        }
        return response;
      } catch (error) {
        const offlinePage = await cache.match("./index.html");
        if (offlinePage) return offlinePage;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(event.request);
    if (cachedResponse) return cachedResponse;

    const response = await fetch(event.request);
    if (response.ok && response.type === "basic") {
      cache.put(event.request, response.clone())
        .catch(error => console.warn("Could not cache a Lecto resource.", error));
    }
    return response;
  })());
});
