/**
 * LifeWeek's service worker.
 *
 * The point of this file is one sentence: the app must open with the phone in
 * aeroplane mode, on the first try, having never been opened offline before.
 *
 * That rules out the obvious shape. Caching "the shell" and letting everything
 * else fall to the network looks right and fails on the only day it matters:
 * index.html names a content-hashed bundle, the bundle is not in the cache, and
 * the phone shows a white page. So install precaches the *entire* build — every
 * file Vite emitted, listed at build time by scripts/build_pwa.mjs, which is
 * also the only thing that knows the hashes. If install cannot fetch them all
 * it fails, and the old worker stays; a half-installed cache is worse than none.
 *
 * Everything is resolved against the directory this file is served from, so the
 * same worker is correct at `/` (the Mac) and at `/lifeweek/` (GitHub Pages).
 */

/** Replaced at build time. Paths are relative to this file's directory. */
const MANIFEST = ["apple-touch-icon.png","assets/index-BW9WMtaI.js","assets/index-D26EBYDK.css","favicon.png","fonts/instrument-serif-latin-ext.woff2","fonts/instrument-serif-latin.woff2","fonts/inter-latin-ext.woff2","fonts/inter-latin.woff2","icon-192.png","icon-512.png","icon-maskable-512.png","index.html","manifest.webmanifest"];
/** Replaced at build time with a hash of the build; changing it retires the old cache. */
const BUILD = "076e67ca7932";
/** "1" when this build keeps its data on the device and has no backend at all. */
const STANDALONE = "1" === "1";

const CACHE = `lifeweek-${BUILD}`;

/** The directory the worker was served from — "/" or "/lifeweek/". */
const ROOT = new URL("./", self.location.href);
/** Resolves a build-relative path to a full URL, which Request insists on. */
const at = (path) => new URL(path, ROOT).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` skips the HTTP cache: an install that quietly stored a stale
      // bundle would be undetectable until the app misbehaved days later.
      await cache.addAll(
        MANIFEST.map((path) => new Request(at(path), { cache: "reload" })),
      );
      // The start URL is a directory, not "index.html", so it needs its own key.
      const shell = await cache.match(at("index.html"));
      if (shell) await cache.put(ROOT.href, shell);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The Mac's weeks live in SQLite and are asked for every time. A cached copy
  // of someone's life would be a lie. (A standalone build never gets here — it
  // reads IndexedDB directly and makes no requests at all.)
  if (!STANDALONE && url.pathname.startsWith(new URL("api/", ROOT).pathname)) return;

  // Any navigation inside the app is the same single page.
  if (request.mode === "navigate") {
    event.respondWith(
      caches
        .match(ROOT.href, { cacheName: CACHE })
        .then((cached) => cached ?? fetch(request))
        .catch(() => offlineShell()),
    );
    return;
  }

  // Precached by name and hash, so a hit is always the right answer.
  event.respondWith(
    caches.match(request, { cacheName: CACHE }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Anything the build did not know about — a font variant, a late icon.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

/** Only reachable if install never completed, which is already the real fault. */
function offlineShell() {
  const advice = STANDALONE
    ? "Close it and open it again."
    : "Open the app on your Mac, then reload.";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LifeWeek</title>
<style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;padding:24px;background:#FFF;color:#767672;
       font:16px/1.5 ui-sans-serif,-apple-system,system-ui,sans-serif;text-align:center}
</style></head><body>
<p>LifeWeek didn't finish installing.<br>${advice}</p>
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 },
  );
}
