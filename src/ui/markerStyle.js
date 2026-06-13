/**
 * markerStyle.js — A tiny DISPLAY-only toggle for the per-channel marker shape.
 *
 * Lets the user switch the per-channel detection markers between filled dots and
 * unfilled rings (config MARKER_STYLES). This is purely a paint change: it never
 * re-runs detection — flipping it fires the same repaint path as recolouring a
 * channel (main.js renderMarkers()). Co-localization dots and hand-placed manual
 * squares are unaffected (see overlay.js).
 *
 * Self-contained like the other UI tool modules: it owns its widget + state and
 * exposes the current value via getStyle(); main.js reads it inside renderMarkers.
 */

import { MARKER_STYLES } from '../config.js';

/**
 * @param {HTMLElement} container
 * @param {{ onChange: (style: 'dots'|'rings') => void }} opts
 *        onChange fires on every change with the new style.
 * @returns {{ getStyle: () => 'dots'|'rings' }}
 */
export function createMarkerStyle(container, { onChange }) {
  let style = MARKER_STYLES.default;

  const wrap = el('div', 'control');
  const label = el('label');
  label.textContent = 'Marker style';

  const select = el('select');
  for (const opt of MARKER_STYLES.options) {
    const o = el('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === style) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => {
    style = /** @type {'dots'|'rings'} */ (select.value);
    onChange(style);
  });

  wrap.append(label, select);
  container.appendChild(wrap);

  return { getStyle: () => style };
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
