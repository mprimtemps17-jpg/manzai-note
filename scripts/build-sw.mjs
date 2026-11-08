import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const assets = (await readdir("dist/assets")).map(name => "/assets/" + name);
const hash = createHash("sha256");
for (const url of ["/index.html", ...assets]) hash.update(await readFile("dist" + url));
const cacheName = "manzai-note-" + hash.digest("hex").slice(0, 16);
await writeFile("dist/sw.js", `
const CACHE = ${JSON.stringify(cacheName)};
const SHELL = ${JSON.stringify(["/", ...assets, "/app.webmanifest", "/icon.svg", "/icon-180.png", "/icon-192.png", "/icon-512.png"])};
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith("manzai-note-") && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
const cached = path => caches.open(CACHE).then(cache => cache.match(path, { ignoreVary: true }));
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET" ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => cached("/")));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(cached(url.pathname).then(response => response || fetch(request)));
  }
});
`);
