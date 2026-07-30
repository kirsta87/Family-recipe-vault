"use strict";
const BUILD = "259";
const CACHE_NAME = `recipe-vault-build-${BUILD}`;
const APP_SHELL = [
  "./", "./index.html", `./app.js?v=${BUILD}`,
  "./cookbooks.html", `./cookbooks.js?v=${BUILD}`,
  "./meal-planner.html", `./meal-planner.js?v=${BUILD}`, `./meal-prep.js?v=${BUILD}`, `./meal-prep.css?v=${BUILD}`,
  "./pantry.html", "./recipe-health.html", "./manage-collections.html",
  "./styles.css", `./build-status.js?v=${BUILD}`, "./build.json"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => undefined).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME && k.startsWith("recipe-vault-")).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.pathname.endsWith("/build.json")){
    event.respondWith(fetch(req, {cache:"no-store"}));
    return;
  }
  const code = req.mode === "navigate" || /\.(?:html|js|css)$/i.test(url.pathname);
  if(code){
    event.respondWith(fetch(req, {cache:"no-store"}).then(res => {
      if(res && res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html"))));
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
