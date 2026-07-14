/*
 * PWA registration + update flow.
 *
 * Registers service-worker.js (offline caching lives there) and, when a NEW
 * deployed version is waiting, shows a small "Update available — Reload" banner.
 * Clicking Reload tells the waiting worker to activate (SKIP_WAITING); the
 * resulting `controllerchange` reloads the page onto the fresh version. This is
 * the user-facing mechanism for picking up a new build — no manual cache clear.
 *
 * Display-only and self-contained: import + call registerPWA() from main.js.
 * A no-op when service workers are unavailable (e.g. non-secure context).
 */

import { APP_VERSION } from './config.js';

export function registerPWA() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    // The version rides in the SW URL's query string. Bumping APP_VERSION in
    // config.js therefore changes the registered script URL, which the browser
    // treats as a NEW worker — it installs, activates, drops the old cache, and
    // triggers the update banner below. So config.js is the SINGLE place to bump.
    navigator.serviceWorker
      .register(`./service-worker.js?v=${encodeURIComponent(APP_VERSION)}`)
      .then((reg) => {
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
