/**
 * viewport.js — Zoom & pan for the image stage.
 *
 * Applies a single CSS transform (`translate(tx,ty) scale(s)`) to the content
 * element — the canvas-wrap that holds BOTH the base image and the marker
 * overlay. Because the transform is on their shared parent, the image and the
 * circles zoom and pan together and stay perfectly aligned. No per-canvas math.
 *
 * Coordinates are kept in the container's local pixel space (origin = container
 * top-left), so cursor-centered zoom is exact regardless of page scroll.
 */

const MIN_SCALE = 0.05;
const MAX_SCALE = 64;
const WHEEL_STEP = 1.15;
const BUTTON_STEP = 1.4;

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.container - clips the content; receives wheel/pointer
 * @param {HTMLElement} opts.content   - the canvas-wrap to transform
 * @param {(scale: number) => void} [opts.onChange] - notified when scale changes
 */
export function createViewport({ container, content, onChange = () => {} }) {
  let scale = 1;
  let tx = 0;
  let ty = 0;

  function apply() {
    content.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    // Crisp pixels when magnified past native so individual cells are verifiable.
    content.classList.toggle('is-pixelated', scale >= 2);
    onChange(scale);
  }

  /** Natural (untransformed) size of the content = the image dimensions. */
  function contentSize() {
    const base = content.firstElementChild; // base canvas
    return { w: base ? base.width : 0, h: base ? base.height : 0 };
  }

  /** Zoom by `factor` keeping the point (px,py) [container coords] fixed. */
  function zoomAt(px, py, factor) {
    const next = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
    const k = next / scale;
    tx = px - k * (px - tx);
    ty = py - k * (py - ty);
    scale = next;
    apply();
  }

  function zoomAtCenter(factor) {
    const r = container.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, factor);
  }

  /** Scale the image to fit the container and center it. */
  function fit() {
    const { w, h } = contentSize();
    if (!w || !h) return;
    const r = container.getBoundingClientRect();
    const margin = 24;
    scale = clamp(
      Math.min((r.width - margin) / w, (r.height - margin) / h),
      MIN_SCALE,
      MAX_SCALE
    );
    tx = (r.width - w * scale) / 2;
    ty = (r.height - h * scale) / 2;
    apply();
  }

  /** Set an absolute scale, centered on the container (e.g. 1 = 100% / 1:1). */
  function zoomTo(target) {
    const r = container.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, clamp(target, MIN_SCALE, MAX_SCALE) / scale);
  }

  // ---- Wheel zoom (cursor-centered) ----
  container.addEventListener(
    'wheel',
    (e) => {
      if (!contentSize().w) return;
      e.preventDefault();
      const r = container.getBoundingClientRect();
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
    },
    { passive: false }
  );

  // ---- Drag to pan ----
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  container.addEventListener('pointerdown', (e) => {
    if (!contentSize().w) return;
    // Only pan from the image itself — let overlaid UI (zoom toolbar) work.
    if (e.target.tagName !== 'CANVAS' && e.target !== container) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    container.setPointerCapture(e.pointerId);
    container.classList.add('is-panning');
  });
  container.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });
  const endPan = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      container.releasePointerCapture(e.pointerId);
    } catch {}
    container.classList.remove('is-panning');
  };
  container.addEventListener('pointerup', endPan);
  container.addEventListener('pointercancel', endPan);

  return {
    fit,
    reset: fit,
    zoomTo,
    zoomIn: () => zoomAtCenter(BUTTON_STEP),
    zoomOut: () => zoomAtCenter(1 / BUTTON_STEP),
    getScale: () => scale,
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
