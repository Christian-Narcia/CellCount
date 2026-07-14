/*
 * ITCN Cell Counter — service worker (offline support).
 *
 * The app is 100% client-side with no remote data fetching, so a cache-first
 * strategy is all that's needed: serve every asset from the cache, fall back to
 * the network. After one online visit the whole app works with no connection.
 *
 * ── UPDATING THE APP ──────────────────────────────────────────────────────────
 * Bump VERSION below — that is the ONLY place, and it MUST live in this file.
 *
 * Every other file (index.html, src/config.js, …) is served cache-first out of the
 * old cache, so a returning visitor's page cannot see a version written anywhere
 * else — it would read the stale copy and never ask for an update. This script is
 * the one exception: the browser re-fetches it from the network on every navigation
 * and byte-compares it (pwa.js registers with updateViaCache:'none', so the HTTP
 * cache can't stale it either). Changing VERSION therefore changes these bytes,
 * which is what makes the browser install a new worker, fill a NEW cache
 * (`itcn-<VERSION>`), drop every old one in `activate`, and show the page's
 * "Update available — Reload" banner. The page reads this VERSION back over
 * postMessage to display it, so there is nothing to keep in sync by hand.
 *
 * Paths are RELATIVE (no leading "/") so this works whether the app is served
 * from a domain root or a GitHub Pages project subpath (e.g. /cell-count/).
 * The Web Worker (src/workers/detector.worker.js) MUST be cached — the service
 * worker intercepts its fetch too, so without it detection breaks offline.
 */

const VERSION = '0.1.02';
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
  './src/ui/labelToggle.js',
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

// Page → worker messages:
//   'SKIP_WAITING' — sent when the user clicks "Reload" on the update banner.
//   'GET_VERSION'  — pwa.js asking which build is actually serving this page, so the
//                    footer shows the SHIPPED version rather than a cached constant.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
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
          return Response.error();
        });
    })
  );
});
