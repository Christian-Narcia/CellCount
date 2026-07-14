/**
 * manualMarkers.js — Place/remove channel-attributed marker dots by hand (Phase 11).
 *
 * Owns the "Add markers" toggle, a channel selector (which channel a new marker is
 * attributed to), a "Reset" button, and the per-channel lists of hand-placed
 * markers. Each marker belongs to a SPECIFIC channel (same ids as CHANNELS config),
 * so it counts toward that channel's total and is exported as that channel — exactly
 * as if it were a detected cell. While the tool is active the supplied canvas
 * captures pointer events. A click resolves in priority order:
 *   1. near a hand-placed marker (any channel) → REMOVE it (own list);
 *   2. near an AUTO-DETECTED marker            → EXCLUDE it (the caller owns the
 *      detected results + the exclusion set, injected via getDetectedMarkers /
 *      onExcludeDetected — this tool stays agnostic about how detection works);
 *   3. empty space                             → ADD a marker for the selected channel.
 * So the one edit mode both adds/removes manual markers and prunes spurious
 * auto-detections. main.js reads getChannelMarkers()/count() to draw, count,
 * and export the manual markers.
 *
 * Coordinates: a click's screen position is converted to image pixels via the
 * canvas's on-screen rect (which already includes the viewport's pan/zoom
 * transform), so no separate scale math is needed.
 *
 * Exclusivity: turning this tool on calls `onActivate` (so the caller can switch
 * off the ROI "Move" tool, which shares the same canvas), and the tool exposes
 * `deactivate()` so it can be switched off symmetrically.
 *
 * Undo (Phase 14A): the tool does NOT own the history stack (main.js does — it's the
 * only module that can see the exclusions and the ROI transform too). It just calls
 * `onBeforeChange(kind)` immediately BEFORE it mutates anything, which is main's cue
 * to snapshot the pre-edit state. That timing is the whole point: `onChange` fires
 * AFTER the mutation, so snapshotting there would capture the post-edit state and the
 * undo would be a no-op. It also hosts the "Undo" button (setCanUndo() drives its
 * enabled state) so the button sits with the edit tools it belongs to.
 */

const HIT_PX = 8; // click-to-remove tolerance, in SCREEN px
const DRAG_PX = 4; // movement above this is treated as a drag, not a click

/**
 * @param {HTMLElement} container - where the toggle/selector/reset are injected
 * @param {Object} deps
 * @param {HTMLCanvasElement} deps.canvas - overlay canvas (event target + coord source)
 * @param {Array<{key:string,label:string}>} deps.channels - attributable channels (CHANNELS)
 * @param {() => void} [deps.onActivate] - called when this tool turns ON
 * @param {() => void} [deps.onChange] - called when a MANUAL marker is added/removed
 * @param {(activeChannel: string|null) => Record<string, Array<{x:number,y:number,index:number}>>} [deps.getDetectedMarkers]
 *        - AUTO-DETECTED markers eligible to be excluded, each with its ORIGINAL
 *          index. Receives the currently-selected channel so the caller can restrict
 *          exclusion to it (you can only prune detections of the channel you're
 *          editing, never another channel's even if it's visible).
 * @param {(channelKey: string, index: number) => void} [deps.onExcludeDetected]
 *        - called to exclude the auto-detected marker at `index` in `channelKey`.
 * @param {() => void} [deps.onReset] - called when "Reset" is clicked (after the
 *        manual lists are cleared) so the caller can clear its exclusions + refresh.
 * @param {(kind: 'edit'|'reset') => void} [deps.onBeforeChange] - fired immediately
 *        BEFORE any mutation (add / remove / exclude / reset), so the caller can
 *        snapshot the pre-edit state for undo. Never fired for a click that changes
 *        nothing (e.g. empty space with no channel selected) — no no-op undo steps.
 * @param {() => void} [deps.onUndo] - "Undo" button clicked (same action as Ctrl+Z).
 * @param {() => void} [deps.onRedo] - "Redo" button clicked (same action as Ctrl+Shift+Z).
 */
export function createManualMarkers(container, {
  canvas,
  channels,
  onActivate = () => {},
  onChange = () => {},
  getDetectedMarkers = () => ({}),
  onExcludeDetected = () => {},
  onReset = () => {},
  onBeforeChange = () => {},
  onUndo = () => {},
  onRedo = () => {},
}) {
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

  // Undo/Redo drive the caller's history stack, which covers ROI move/rotate too — so
  // the titles say "edit", not "marker edit".
  const undo = el('button', 'manual-tools__undo btn-secondary');
  undo.type = 'button';
  undo.textContent = 'Undo';
  undo.title = 'Undo the last edit (Ctrl+Z)';
  undo.disabled = true;
  undo.addEventListener('click', () => onUndo());

  const redo = el('button', 'manual-tools__redo btn-secondary');
  redo.type = 'button';
  redo.textContent = 'Redo';
  redo.title = 'Redo the last undone edit (Ctrl+Shift+Z)';
  redo.disabled = true;
  redo.addEventListener('click', () => onRedo());

  const reset = el('button', 'manual-tools__reset btn-secondary');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.title = 'Remove all manual markers and restore every excluded auto-detection';
  reset.addEventListener('click', () => {
    // Clears BOTH hand-placed markers and the caller's auto-detection exclusions,
    // so one button undoes every marker edit. onReset() does the caller-side clear
    // + refresh, so we don't also fire onChange (which would double-repaint).
    // Snapshot FIRST — a Reset is the edit most likely to be an accident, and it's
    // the one a single Ctrl+Z has to bring all the way back.
    onBeforeChange('reset');
    for (const key of Object.keys(markers)) markers[key].length = 0;
    onReset();
  });

  row.append(select, undo, redo, reset);
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

    // Each branch below snapshots (onBeforeChange) immediately before it mutates, so
    // the caller's undo entry holds the state as it was BEFORE this click.

    // 1. A hand-placed marker (any channel) under the cursor → remove it.
    const manualHit = nearest(x, y, tol);
    if (manualHit) {
      onBeforeChange('edit');
      markers[manualHit.key].splice(manualHit.index, 1);
      onChange();
      return;
    }
    // 2. An auto-detected marker under the cursor → exclude it (caller-owned).
    const detHit = nearestDetected(x, y, tol);
    if (detHit) {
      onBeforeChange('edit');
      onExcludeDetected(detHit.key, detHit.index);
      return;
    }
    // 3. Empty space → add a new marker for the selected channel.
    if (activeChannel) {
      onBeforeChange('edit');
      markers[activeChannel].push({ x: Math.round(x), y: Math.round(y) });
      onChange();
    }
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

  /**
   * Nearest AUTO-DETECTED marker within `tol` image px, or null. The candidate set
   * + ORIGINAL indices come from the caller (getDetectedMarkers), scoped to the
   * SELECTED channel and already excluding hidden/previously-excluded cells — so we
   * never exclude another channel's (or an invisible) marker. Returns { key, index }.
   */
  function nearestDetected(x, y, tol) {
    const detected = getDetectedMarkers(activeChannel) || {};
    let best = null;
    let bestD = tol;
    for (const key of Object.keys(detected)) {
      for (const m of detected[key]) {
        const d = Math.hypot(m.x - x, m.y - y);
        if (d <= bestD) {
          bestD = d;
          best = { key, index: m.index };
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

    /**
     * A DEEP copy of the per-channel lists, for the undo stack (Phase 14A).
     * Deep matters: the lists above are handed out live and are mutated in place by
     * every add/remove, so a shallow copy would alias them and the "snapshot" would
     * silently track the very edits it exists to undo.
     */
    getSnapshot: () => Object.fromEntries(
      Object.keys(markers).map((key) => [key, markers[key].map((m) => ({ x: m.x, y: m.y }))])
    ),

    /**
     * Replace the lists from a snapshot (deep-copied back in, for the same reason).
     * Deliberately does NOT fire onChange: the caller restores the marker lists, the
     * exclusions and the ROI transform together and repaints ONCE, at the end.
     */
    restore(snap) {
      for (const key of Object.keys(markers)) {
        const list = (snap && snap[key]) || [];
        markers[key] = list.map((m) => ({ x: m.x, y: m.y }));
      }
    },

    /** Enable/disable the "Undo" button (the caller owns the history stack). */
    setCanUndo(can) {
      undo.disabled = !can;
    },

    /** Enable/disable the "Redo" button. */
    setCanRedo(can) {
      redo.disabled = !can;
    },
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
