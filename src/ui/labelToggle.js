/**
 * labelToggle.js — Show/hide the NUMBER LABELS on the overlay (display-only).
 *
 * The markers themselves (per-channel dots/rings, co-localization discs, manual
 * squares) are untouched: this only suppresses the numeric label drawn beside them,
 * so a dense image can be read without the numbers crowding the cells. Like the
 * marker-style toggle it never re-runs detection — flipping it just repaints the
 * overlay (main.js renderMarkers(), which feeds the value in as
 * MARKER_STYLE.showLabels).
 *
 * Self-contained like the other UI tool modules: it owns its button, its state, AND
 * its keyboard shortcut (config MARKER_LABELS.shortcutKey, shown in the button's
 * name). The key is ignored while the user is typing in a field and when a modifier
 * is held, matching ui/shortcuts.js (whose typing guard it reuses).
 */

import { MARKER_LABELS } from '../config.js';
import { isTypingTarget } from './shortcuts.js';

/**
 * @param {HTMLElement} container
 * @param {{ onChange: (showLabels: boolean) => void }} opts
 *        onChange fires on every change with the new value.
 * @param {Document|HTMLElement} [target] - keydown listener target
 * @returns {{ getShowLabels: () => boolean, destroy: () => void }}
 */
export function createLabelToggle(container, { onChange }, target = document) {
  const key = MARKER_LABELS.shortcutKey;
  const keyName = key.toUpperCase();
  let showLabels = MARKER_LABELS.default;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'label-tools__btn btn-secondary';
  btn.addEventListener('click', () => set(!showLabels));
  container.appendChild(btn);
  render();

  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave combos to the browser/OS
    if (isTypingTarget(e.target)) return;
    if (e.key.toLowerCase() !== key) return;
    e.preventDefault();
    set(!showLabels);
  }
  target.addEventListener('keydown', onKeydown);

  function set(value) {
    showLabels = value;
    render();
    onChange(showLabels);
  }

  function render() {
    btn.textContent = showLabels ? `Hide numbers (${keyName})` : `Show numbers (${keyName})`;
    btn.title = `Show or hide the number labels on the markers (shortcut: ${keyName})`;
    btn.setAttribute('aria-pressed', String(!showLabels));
    // Highlighted while the labels are HIDDEN — i.e. while the overlay is in the
    // non-default state, same visual language as the "Add markers" tool.
    btn.classList.toggle('is-active', !showLabels);
  }

  return {
    getShowLabels: () => showLabels,
    destroy: () => target.removeEventListener('keydown', onKeydown),
  };
}
