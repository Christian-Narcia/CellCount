/**
 * roiControls.js — Edit the loaded ROI's rotation and position (Phase 11).
 *
 * Owns the live ROI transform { angle (deg), dx, dy (image px) } and the small
 * panel that drives it:
 *   • a rotation number input (degrees),
 *   • a "Move ROI" toggle that lets the user drag the ROI around the image,
 *   • a "Reset" button that returns to the file's original rotation/position.
 *
 * It is a SELF-CONTAINED editor: it holds the transform state (single source of
 * truth) and reports changes via two callbacks, kept separate like the rest of
 * the app:
 *   • onTransform() — cheap, fires continuously (drag / typing): the caller
 *                     re-rasterises the mask and redraws the AOI boundary.
 *   • onCommit()    — fires when an edit settles (drag end / debounced typing):
 *                     the caller re-runs detection (the mask gate changed).
 *
 * Dragging is handled on a caller-supplied canvas (the topmost overlay). Move
 * mode flips that canvas's pointer-events on so it captures the drag and stops it
 * from reaching the viewport's pan handler; off, the canvas is transparent to
 * pointers again and panning works as before. Screen deltas are divided by the
 * current zoom scale to convert to image pixels.
 *
 * Undo (Phase 14B): a third callback, onBeforeTransform(), fires ONCE at the START
 * of a gesture — pointerdown of a drag, the first keystroke of a burst of typing in
 * the rotation field, or a Reset click. That's the caller's cue to snapshot the
 * pre-gesture transform. Firing per UPDATE instead would be wrong in a way the user
 * would feel immediately: onTransform runs on every animation frame of a drag, so one
 * drag across the image would need sixty presses of Ctrl+Z to undo. The gesture state
 * (dragging / mid-typing-burst) lives here, so the coalescing has to live here too —
 * main.js can't see it.
 */

/**
 * @param {HTMLElement} container - where the control panel is injected
 * @param {Object} deps
 * @param {HTMLCanvasElement} deps.moveTarget - canvas that captures move-mode drags
 * @param {() => number} deps.getScale - current viewport zoom scale
 * @param {() => void} deps.onTransform - live: re-rasterise + redraw boundary
 * @param {() => void} deps.onCommit - settled: re-run detection
 * @param {() => void} [deps.onActivate] - called when "Move ROI" turns ON
 * @param {() => void} [deps.onBeforeTransform] - fired ONCE at the start of a gesture,
 *        before the transform changes, so the caller can push an undo snapshot.
 */
export function createRoiControls(container, {
  moveTarget,
  getScale,
  onTransform,
  onCommit,
  onActivate = () => {},
  onBeforeTransform = () => {},
}) {
  let angle = 0;
  let dx = 0;
  let dy = 0;
  let baseRotation = 0; // the file's stored rotation — Reset returns here
  let moveMode = false;

  // ---- DOM ----
  const wrap = el('div', 'roi-controls');
  wrap.hidden = true;

  const heading = el('div', 'roi-controls__heading');
  heading.textContent = 'Region of interest';

  const rotRow = el('div', 'roi-controls__row');
  const rotLabel = el('label');
  rotLabel.textContent = 'Rotation';
  const rotInput = el('input', 'roi-controls__rot');
  rotInput.type = 'number';
  rotInput.step = '1';
  rotInput.value = '0';
  const rotUnit = el('span', 'roi-controls__unit');
  rotUnit.textContent = '°';
  rotRow.append(rotLabel, rotInput, rotUnit);

  const btnRow = el('div', 'roi-controls__row');
  const moveBtn = el('button', 'roi-controls__move btn-secondary');
  moveBtn.type = 'button';
  moveBtn.textContent = 'Move ROI';
  moveBtn.title = 'Drag the ROI to reposition it';
  const resetBtn = el('button', 'roi-controls__reset btn-secondary');
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset';
  resetBtn.title = 'Reset rotation and position';
  btnRow.append(moveBtn, resetBtn);

  wrap.append(heading, rotRow, btnRow);
  container.appendChild(wrap);

  // ---- Live (rAF-coalesced) + debounced commit ----
  let rafQueued = false;
  function fireTransform() {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      onTransform();
    });
  }
  let commitTimer = null;
  let typing = false; // mid-burst in the rotation field — see the rotation handler
  function fireCommit(delay = 0) {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      typing = false; // the burst has settled; the next keystroke starts a new gesture
      onCommit();
    }, delay);
  }

  // ---- Rotation ----
  rotInput.addEventListener('input', () => {
    // Snapshot once per BURST of typing, not per keystroke: typing "45" is one edit
    // and must be one Ctrl+Z, not two (4 → 45). The burst ends when the same debounce
    // that drives the re-detect fires.
    if (!typing) {
      typing = true;
      onBeforeTransform();
    }
    const v = Number(rotInput.value);
    angle = Number.isFinite(v) ? v : 0;
    fireTransform();
    fireCommit(200); // re-detect after typing settles
  });

  // ---- Reset ----
  resetBtn.addEventListener('click', () => {
    if (angle === baseRotation && dx === 0 && dy === 0) return; // already reset — no-op
    onBeforeTransform();
    angle = baseRotation;
    dx = 0;
    dy = 0;
    rotInput.value = String(round(baseRotation));
    fireTransform();
    fireCommit(0);
  });

  // ---- Move mode (drag to reposition) ----
  moveBtn.addEventListener('click', () => setMoveMode(!moveMode));

  function setMoveMode(on) {
    moveMode = on;
    moveBtn.classList.toggle('is-active', on);
    if (on) onActivate(); // let the caller switch off the other canvas tool first
    // Only intercept pointers while moving, so panning still works otherwise.
    moveTarget.style.pointerEvents = on ? 'auto' : 'none';
    moveTarget.style.cursor = on ? 'move' : '';
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  moveTarget.addEventListener('pointerdown', (e) => {
    if (!moveMode) return;
    e.stopPropagation(); // keep the viewport from starting a pan
    onBeforeTransform(); // ONE undo entry per drag — snapshot the pre-drag transform
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    moveTarget.setPointerCapture(e.pointerId);
  });
  moveTarget.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const s = getScale() || 1;
    dx += (e.clientX - lastX) / s; // screen px → image px
    dy += (e.clientY - lastY) / s;
    lastX = e.clientX;
    lastY = e.clientY;
    fireTransform();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      moveTarget.releasePointerCapture(e.pointerId);
    } catch {}
    fireCommit(0); // mask moved → re-detect
  };
  moveTarget.addEventListener('pointerup', endDrag);
  moveTarget.addEventListener('pointercancel', endDrag);

  return {
    /** Reveal the panel and seed it from the file's stored rotation. */
    show(rotation = 0) {
      baseRotation = Number.isFinite(rotation) ? rotation : 0;
      angle = baseRotation;
      dx = 0;
      dy = 0;
      rotInput.value = String(round(baseRotation));
      wrap.hidden = false;
    },
    /** Hide the panel and leave move mode (e.g. the ROI was cleared). */
    hide() {
      wrap.hidden = true;
      setMoveMode(false);
    },
    /** Current transform — the single source of truth main.js rasterises from. */
    getTransform() {
      return { angle, dx, dy };
    },

    /**
     * Put the transform back to a snapshotted value (undo/redo, Phase 14B).
     *
     * Updates the rotation FIELD as well as the internal angle: this panel is the
     * single source of truth, so leaving the input showing the pre-undo angle would
     * desync it — and the user would hit that the moment they typed in it next (the
     * field's value, not the restored angle, is what the next keystroke edits).
     *
     * Fires NO callbacks. main.js re-rasterises, redraws the boundary and re-detects
     * once, after the whole snapshot (markers, exclusions, transform) is back in
     * place — restoring piecemeal would re-detect against a half-restored state.
     */
    setTransform(t) {
      if (!t) return;
      angle = Number.isFinite(t.angle) ? t.angle : 0;
      dx = Number.isFinite(t.dx) ? t.dx : 0;
      dy = Number.isFinite(t.dy) ? t.dy : 0;
      rotInput.value = String(round(angle));
      typing = false; // an undo ends any in-progress typing burst
    },
    /** Turn "Move ROI" off (exclusivity with the manual-marker tool). */
    deactivate() {
      if (moveMode) setMoveMode(false);
    },
  };
}

/** Round to 1 decimal for display without trailing-float noise. */
function round(v) {
  return Math.round(v * 10) / 10;
}

/** Tiny element helper (mirrors controls.js / channelInputs.js). */
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
