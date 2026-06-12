/**
 * manualMarkers.js — Place/remove channel-attributed marker dots by hand (Phase 11).
 *
 * Owns the "Add markers" toggle, a channel selector (which channel a new marker is
 * attributed to), a "Reset" button, and the per-channel lists of hand-placed
 * markers. Each marker belongs to a SPECIFIC channel (same ids as CHANNELS config),
 * so it counts toward that channel's total and is exported as that channel — exactly
 * as if it were a detected cell. While the tool is active the supplied canvas
 * captures pointer events: a click on empty space ADDS a marker (to the selected
 * channel); a click near ANY existing manual marker REMOVES it. main.js reads
 * getChannelMarkers()/count() to draw, count, and export them.
 *
 * Coordinates: a click's screen position is converted to image pixels via the
 * canvas's on-screen rect (which already includes the viewport's pan/zoom
 * transform), so no separate scale math is needed.
 *
 * Exclusivity: turning this tool on calls `onActivate` (so the caller can switch
 * off the ROI "Move" tool, which shares the same canvas), and the tool exposes
 * `deactivate()` so it can be switched off symmetrically.
 */

const HIT_PX = 8; // click-to-remove tolerance, in SCREEN px
const DRAG_PX = 4; // movement above this is treated as a drag, not a click

/**
 * @param {HTMLElement} container - where the toggle/selector/reset are injected
 * @param {Object} deps
 * @param {HTMLCanvasElement} deps.canvas - overlay canvas (event target + coord source)
 * @param {Array<{key:string,label:string}>} deps.channels - attributable channels (CHANNELS)
 * @param {() => void} [deps.onActivate] - called when this tool turns ON
 * @param {() => void} [deps.onChange] - called when a marker is added/removed/reset
 */
export function createManualMarkers(container, { canvas, channels, onActivate = () => {}, onChange = () => {} }) {
  /** Per-channel marker lists, keyed by channel id. @type {Record<string, Array<{x:number,y:number}>>} */
  const markers = Object.fromEntries(channels.map((c) => [c.key, []]));
  let activeChannel = channels[0] ? channels[0].key : null;
  let active = false;

  const row = el('div', 'manual-tools__row');

  const btn = el('button', 'manual-tools__btn btn-secondary');
  btn.type = 'button';
  btn.textContent = 'Add markers';
  btn.title = 'Click the image to add a marker for the selected channel; click a marker to remove it';
  btn.addEventListener('click', () => setActive(!active));

  // Channel selector — which channel a new marker is attributed to.
  const select = el('select', 'manual-tools__channel');
  select.title = 'Channel a new manual marker belongs to';
  for (const c of channels) {
    const o = el('option');
    o.value = c.key;
    o.textContent = c.label;
    select.appendChild(o);
  }
  if (activeChannel) select.value = activeChannel;
  select.addEventListener('change', () => {
    activeChannel = select.value;
  });

  const reset = el('button', 'manual-tools__reset btn-secondary');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.title = 'Remove all manually placed markers (every channel)';
  reset.addEventListener('click', () => {
    if (total() === 0) return;
    for (const key of Object.keys(markers)) markers[key].length = 0;
    onChange();
  });

  row.append(select, reset);
  container.append(btn, row);

  function setActive(on) {
    active = on;
    btn.classList.toggle('is-active', on);
    if (on) onActivate(); // let the caller switch off the other canvas tool first
    canvas.style.pointerEvents = on ? 'auto' : 'none';
    canvas.style.cursor = on ? 'crosshair' : '';
  }

  // Convert a pointer event to image-pixel coordinates + the current scale
  // (image px per screen px), using the canvas's transformed on-screen rect.
  function toImage(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width ? canvas.width / rect.width : 1;
    const sy = rect.height ? canvas.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy, sx };
  }

  // Click = pointerdown + up at (nearly) the same spot. We stop propagation so the
  // viewport doesn't start a pan, and ignore drags so panning intent isn't a place.
  let downX = 0;
  let downY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    e.stopPropagation();
    downX = e.clientX;
    downY = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!active) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_PX) return; // a drag
    const { x, y, sx } = toImage(e);
    const tol = HIT_PX * sx; // screen tolerance → image px
    const hit = nearest(x, y, tol); // remove the nearest marker in ANY channel
    if (hit) markers[hit.key].splice(hit.index, 1);
    else if (activeChannel) markers[activeChannel].push({ x: Math.round(x), y: Math.round(y) });
    onChange();
  });

  /** Nearest manual marker (across all channels) within `tol` image px, or null. */
  function nearest(x, y, tol) {
    let best = null;
    let bestD = tol;
    for (const key of Object.keys(markers)) {
      const list = markers[key];
      for (let i = 0; i < list.length; i++) {
        const d = Math.hypot(list[i].x - x, list[i].y - y);
        if (d <= bestD) {
          bestD = d;
          best = { key, index: i };
        }
      }
    }
    return best;
  }

  const total = () => Object.values(markers).reduce((sum, list) => sum + list.length, 0);

  return {
    /** The per-channel marker lists (live reference — treat as read-only). */
    getChannelMarkers: () => markers,
    /** Number of manual markers for one channel. */
    count: (key) => (markers[key] ? markers[key].length : 0),
    /** Total manual markers across all channels. */
    total,
    /** Remove all markers (e.g. the stage was cleared) and turn the tool off. */
    clear() {
      for (const key of Object.keys(markers)) markers[key].length = 0;
      setActive(false);
    },
    /** Turn the tool off (exclusivity with the ROI move tool). */
    deactivate() {
      if (active) setActive(false);
    },
    isActive: () => active,
  };
}

/** Tiny element helper (mirrors the other ui modules). */
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
