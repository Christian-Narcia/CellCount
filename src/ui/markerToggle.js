/**
 * markerToggle.js — Show/hide the per-channel DETECTION MARKERS on the overlay
 * (display-only). Sibling of ui/labelToggle.js: where that one drops only the
 * number labels, this one drops the markers themselves — the small dots OR the
 * rings, whichever the marker-style toggle is currently showing (config
 * MARKER_DOTS). Hiding them (and their labels, which are drawn with them) lets the
 * user read the raw composite without the detection overlay on top.
 *
 * Co-localization dots and hand-placed manual squares are UNAFFECTED — this only
 * governs the per-channel 'cell' groups. Like the other tool toggles it never
 * re-runs detection: flipping it just repaints the overlay (main.js renderMarkers(),
 * which skips the per-channel marker groups when this returns false).
 *
 * Self-contained like the sibling modules: it owns its button, its state, AND its
 * keyboard shortcut (config MARKER_DOTS.shortcutKey, shown in the button's name).
 * The key is ignored while the user is typing in a field and when a modifier is
 * held, matching ui/shortcuts.js (whose typing guard it reuses).
 */

import { MARKER_DOTS } from '../config.js';
import { isTypingTarget } from './shortcuts.js';

/**
 * @param {HTMLElement} container
 * @param {{ onChange: (showMarkers: boolean) => void }} opts
 *        onChange fires on every change with the new value.
 * @param {Document|HTMLElement} [target] - keydown listener target
 * @returns {{ getShowMarkers: () => boolean, destroy: () => void }}
 */
export function createMarkerToggle(container, { onChange }, target = document) {
  const key = MARKER_DOTS.shortcutKey;
  const keyName = key.toUpperCase();
  let showMarkers = MARKER_DOTS.default;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'label-tools__btn btn-secondary';
  btn.addEventListener('click', () => set(!showMarkers));
  container.appendChild(btn);
  render();

  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave combos to the browser/OS
    if (isTypingTarget(e.target)) return;
    if (e.key.toLowerCase() !== key) return;
    e.preventDefault();
    set(!showMarkers);
  }
  target.addEventListener('keydown', onKeydown);

  function set(value) {
    showMarkers = value;
    render();
    onChange(showMarkers);
  }

  function render() {
    btn.textContent = showMarkers ? `Hide markers (${keyName})` : `Show markers (${keyName})`;
    btn.title = `Show or hide the per-channel detection markers (shortcut: ${keyName})`;
    btn.setAttribute('aria-pressed', String(!showMarkers));
    // Highlighted while markers are HIDDEN — the non-default state, matching the
    // visual language of the sibling "Hide numbers" / "Add markers" tools.
    btn.classList.toggle('is-active', !showMarkers);
  }

  return {
    getShowMarkers: () => showMarkers,
    destroy: () => target.removeEventListener('keydown', onKeydown),
  };
}
