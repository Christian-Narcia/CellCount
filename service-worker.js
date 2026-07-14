/*
 * ITCN Cell Counter — service worker (offline support).
 *
 * The app is 100% client-side with no remote data fetching, so a cache-first
 * strategy is all that's needed: serve every asset from the cache, fall back to
 * the network. After one online visit the whole app works with no connection.
 *
 * ── UPDATING THE APP ──────────────────────────────────────────────────────────
 * Bump APP_VERSION in src/config.js — that's the ONLY place. src/pwa.js registers
 * this worker as `service-worker.js?v=<APP_VERSION>`, so a version bump changes the
 * registered script URL; the browser treats that as a new worker, installs it, and
 * `activate` deletes every old cache. The page then shows an "Update available —
 * Reload" banner so users are never stuck on a stale version. This worker reads the
 * same version back off its own URL (?v=…) to name the cache, so the two always
 * match with no second edit. (VERSION below is only a fallback if no ?v= is present.)
 *
 * Paths are RELATIVE (no leading "/") so this works whether the app is served
 * from a domain root or a GitHub Pages project subpath (e.g. /cell-count/).
 * The Web Worker (src/workers/detector.worker.js) MUST be cached — the service
 * worker intercepts its fetch too, so without it detection breaks offline.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || '0.1.0';
const CACHE = `itcn-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './vendor/utif.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // ── src (every ES module + the worker) ──
  './src/config.js',
  './src/main.js',
  './src/pwa.js',
  './src/algorithm/colocalize.js',
  './src/algorithm/detect.js',
  './src/algorithm/gaussian.js',
  './src/algorithm/grayscale.js',
  './src/algorithm/laplacian.js',
  './src/algorithm/nms.js',
  './src/algorithm/threshold.js',
  './src/core/channelExtract.js',
  './src/core/fileLoader.js',
  './src/core/imageDecoder.js',
  './src/core/rasterize.js',
  './src/core/roiParser.js',
  './src/core/roiTransform.js',
  './src/export/csv.js',
  './src/export/png.js',
  './src/ui/aoiBoundary.js',
  './src/ui/canvasLayers.js',
  './src/ui/channelInputs.js',
  './src/ui/composite.js',
  './src/ui/controls.js',
  './src/ui/manualMarkers.js',
  './src/ui/markerStyle.js',
  './src/ui/overlay.js',
  './src/ui/resultsTable.js',
  './src/ui/roiControls.js',
  './src/ui/shortcuts.js',
  './src/ui/viewport.js',
  './src/workers/detector.worker.js',
];

// Precache the app shell on install. `cache: 'reload'` forces every asset to be
// fetched from the NETWORK, bypassing the browser's HTTP cache — otherwise a host
// like GitHub Pages (which sends a ~10-min max-age) can hand back the OLD file, so
// the "new" cache silently fills with stale bytes and the update never takes hold.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
  );
});

// Drop every old versioned cache on activate, then take control of open pages.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// The page posts this when the user clicks "Reload" on the update banner.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Cache-first for same-origin GETs; runtime-cache anything new; offline fallback.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // ignore cross-origin

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Populate the cache for assets not in the precache list (e.g. modules
          // added later) so they're available on the next offline load.
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline and uncached: fall back to the app shell for navigations.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return cached;
        });
    })
  );
});
