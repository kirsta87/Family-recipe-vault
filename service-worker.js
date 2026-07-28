"use strict";
const BUILD = 209;
const CACHE_NAME = `recipe-vault-v${BUILD}`;
const APP_SHELL = [
  "./", "./index.html", `./styles.css?v=${BUILD}`, `./app.js?v=${BUILD}`,
  "./meal-planner.html", `./meal-planner.js?v=${BUILD}`,
  "./pantry.html", `./pantry.js?v=${BUILD}`,
  "./manage-collections.html", `./manage-collections.js?v=${BUILD}`,
  "./recipe-health.html", `./recipe-health.js?v=${BUILD}`,
  "./cookbooks.html", `./cookbooks.js?v=${BUILD}`,
  `./config.js?v=${BUILD}`, `./build-status.js?v=${BUILD}`, "./build.json",
  "./recipe-pack-schema.js", "./sample-recipe-pack.zip", "./manifest.webmanifest"
];
self.addEventListener("install",event=>{
  // Cache the new shell, but do not take over an open tab mid-import.
  event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)).catch(()=>undefined));
});
self.addEventListener("activate",event=>{
  // The new worker becomes active on the next navigation/reload. Avoid clients.claim()
  // so a deployment cannot mix old page state with new JavaScript during an import.
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&k.startsWith("recipe-vault-")).map(k=>caches.delete(k)))));
});
self.addEventListener("fetch",event=>{
  const req=event.request;if(req.method!=="GET")return;const url=new URL(req.url);
  if(url.pathname.endsWith("/build.json")){event.respondWith(fetch(req,{cache:"no-store"}));return;}
  const code=req.mode==="navigate"||/\.(?:html|js|css)$/i.test(url.pathname);
  if(code){event.respondWith(fetch(req,{cache:"no-store"}).then(res=>{if(res&&res.ok)caches.open(CACHE_NAME).then(c=>c.put(req,res.clone()));return res;}).catch(()=>caches.match(req).then(hit=>hit||caches.match("./index.html"))));return;}
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
});
