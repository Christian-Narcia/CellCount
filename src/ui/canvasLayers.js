/**
 * canvasLayers.js — Manages the aligned canvas stack (bottom to top):
 *
 *   1. base    — the composite image (merged channels). Canvas 1.
 *   2. aoi     — the AOI mask boundary (dashed outline). Redrawn on mask change.
 *   3. overlay — cell markers + labels. Topmost. Redrawn on each detection.
 *
 * All three share one pixel size, so coordinates map 1:1 between layers and the
 * image — no scaling math at draw time. (Zoom/pan is applied to their shared
 * parent by viewport.js, so the layers always stay registered.)
 *
 * NB: there are intentionally no per-channel DOM canvases. Compositing is done
 * with pixel-level math directly on the extracted channel matrices (composite.js),
 * which is more accurate than reading back from intermediate canvases; individual
 * channel viewing arrives with the Phase 4 visibility toggles.
 */

export function createCanvasLayers(baseCanvas, aoiCanvas, overlayCanvas) {
  const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
  const aoiCtx = aoiCanvas.getContext('2d');
  const overlayCtx = overlayCanvas.getContext('2d');
  const all = [baseCanvas, aoiCanvas, overlayCanvas];

  /** Resize every layer and paint the source image onto the base layer. */
  function setImage(imageData) {
    const { width, height } = imageData;
    for (const c of all) {
      c.width = width; // setting size also clears the canvas
      c.height = height;
    }
    baseCtx.putImageData(imageData, 0, 0);
  }

  /**
   * Repaint just the composite (base) layer — same dimensions, no resize. Used
   * for display-only redraws (colour/opacity/visibility/blend changes) so the
   * AOI boundary and markers above it are left untouched.
   */
  function setComposite(imageData) {
    baseCtx.putImageData(imageData, 0, 0);
  }

  function clearOverlay() {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  function clearAoi() {
    aoiCtx.clearRect(0, 0, aoiCanvas.width, aoiCanvas.height);
  }

  return {
    baseCanvas,
    aoiCanvas,
    overlayCanvas,
    baseCtx,
    aoiCtx,
    overlayCtx,
    setImage,
    setComposite,
    clearOverlay,
    clearAoi,
    get width() {
      return baseCanvas.width;
    },
    get height() {
      return baseCanvas.height;
    },
  };
}
