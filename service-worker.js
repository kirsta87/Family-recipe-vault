"use strict";

const CACHE_NAME = "recipe-vault-v125";
const APP_SHELL = [
  "./", "./index.html", "./styles.css?v=125", "./app.js?v=125",
  "./meal-planner.html", "./meal-planner.js?v=125",
  "./manage-collections.html", "./manage-collections.js?v=125",
  "./recipe-health.html", "./recipe-health.js?v=125",
  "./config.js?v=3", "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if(request.method !== "GET") return;
  const url = new URL(request.url);
  const isCode = request.mode === "navigate" || /\.(?:html|js|css)$/i.test(url.pathname);
  if(isCode){
    event.respondWith(fetch(request, {cache:"no-store"}).then(response => {
      if(response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request).then(hit => hit || caches.match("./index.html"))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
