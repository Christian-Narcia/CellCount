/*
 * PWA registration + update flow.
 *
 * Registers service-worker.js (offline caching lives there) and, when a NEW
 * deployed version is waiting, shows a small "Update available — Reload" banner.
 * Clicking Reload tells the waiting worker to activate (SKIP_WAITING); the
 * resulting `controllerchange` reloads the page onto the fresh version. This is
 * the user-facing mechanism for picking up a new build — no manual cache clear.
 *
 * ── WHERE THE VERSION LIVES ───────────────────────────────────────────────────
 * In service-worker.js, and NOWHERE else. Every file in this directory is served
 * cache-first from the old cache, so a version constant here (or in config.js)
 * would be read from the STALE copy — the page would keep asking for the build it
 * already has and no update could ever be detected. The worker script is the only
 * file the browser always re-fetches from the network, so it is the only file whose
 * contents can announce a new release. We register it with updateViaCache:'none' so
 * the HTTP cache (GitHub Pages sends a ~10-min max-age) can't stale it either, then
 * ask the ACTIVE worker which version it is and hand that back via `onVersion` for
 * the footer — the number on screen is then, by construction, the build serving you.
 *
 * Display-only and self-contained: import + call registerPWA() from main.js.
 * A no-op when service workers are unavailable (e.g. non-secure context).
 */

/**
 * @param {(version: string) => void} [onVersion] Called with the version of the
 *   worker actually controlling the page (may fire after first paint).
 */
export function registerPWA(onVersion) {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js', { updateViaCache: 'none' })
      .then((reg) => {
        // Ask whichever worker ends up in control what build it is.
        if (onVersion) {
          navigator.serviceWorker.ready.then((ready) => {
            if (ready.active) requestVersion(ready.active).then(onVersion);
          });
        }

        // A build was already waiting before this page finished loading.
        if (reg.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner(reg.waiting);
        }
        // A new build installs while the page is open.
        reg.addEventListener('updatefound', () => {
          const incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', () => {
            // `controller` set ⇒ this is an update, not the first install.
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(incoming);
            }
          });
        });

        // The browser only checks for a new worker on navigation. A tab left open
        // for days would never notice a release, so re-check when it regains focus.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.warn('Service worker registration failed:', err));

    // When the waiting worker takes over, reload once onto the new version.
    // Only do this if the page ALREADY had a controller at load — i.e. this is a
    // real update. On the very first visit, activate's clients.claim() also fires
    // controllerchange, and we must NOT reload then (nothing changed yet).
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

/** Round-trip the worker's VERSION over a MessageChannel. Resolves to '' on silence. */
function requestVersion(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const done = (value) => {
      channel.port1.onmessage = null;
      resolve(value);
    };
    channel.port1.onmessage = (event) => done((event.data && event.data.version) || '');
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    setTimeout(() => done(''), 2000);
  }).then((version) => version || undefined);
}

function showUpdateBanner(worker) {
  if (document.getElementById('pwa-update')) return; // already shown

  const banner = document.createElement('div');
  banner.id = 'pwa-update';
  banner.className = 'pwa-update';
  banner.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'pwa-update__text';
  text.textContent = 'A new version is available.';

  const reload = document.createElement('button');
  reload.className = 'pwa-update__btn';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => {
    reload.disabled = true;
    worker.postMessage('SKIP_WAITING');
  });

  const dismiss = document.createElement('button');
  dismiss.className = 'pwa-update__dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => banner.remove());

  banner.append(text, reload, dismiss);
  document.body.appendChild(banner);
}
