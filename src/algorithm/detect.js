/**
 * detect.js — ITCN detection pipeline orchestrator.
 *
 * Composes the individual algorithm steps into the full Laplacian-of-Gaussian
 * blob detector. Pure and DOM-free: this is the single entry point the worker
 * calls per channel, and it can also be unit-tested directly in Node.
 *
 * Pipeline:  (invert + AOI mask) → Gaussian blur → Laplacian → local extrema
 *            → threshold → NMS
 */

import { DERIVE } from '../config.js';
import { rgbaToGrayscale } from './grayscale.js';
import { gaussianBlur } from './gaussian.js';
import { laplacian } from './laplacian.js';
import { applyThreshold } from './threshold.js';
import { nonMaxSuppression } from './nms.js';

/**
 * @typedef {Object} DetectParams
 * @property {number} R      - expected cell radius (px)
 * @property {number} Dmin   - minimum separation between cells (px)
 * @property {number} T      - intensity threshold (0–255)
 * @property {boolean} fluorescent - bright cells on dark bg → no inversion
 * @property {'log'|'intensity'} [thresholdMode]
 */

/**
 * Detect cells in a single grayscale channel, optionally restricted to an AOI.
 *
 * The detector finds BRIGHT blobs (negative LoG centres). So we first map the
 * channel into "bright-blob space":
 *   • fluorescent → cells are already bright → keep as-is.
 *   • brightfield → cells are dark → invert so they become bright peaks.
 * (This is intentionally the reverse of todo.txt Step A — see the project README.)
 *
 * AOI MASKING is applied HERE, before blurring: pixels outside the ROI are set
 * to the BACKGROUND level so the detector never fires there. In our bright-blob
 * convention the background is 0 (dark), so masked-out pixels → 0.
 *
 *   NB: the todo says "set masked-out pixels to MaxIntensity". That is correct
 *   for the OPPOSITE (dark-valley) convention, where fluorescent images are
 *   inverted so cells become dark valleys and the background becomes bright —
 *   there you fill outside-ROI bright so it's never a valley. We use the reversed
 *   bright-blob convention (fluorescent = no inversion, cells are bright peaks),
 *   so the equivalent background fill is 0, NOT MaxIntensity. Filling with
 *   MaxIntensity here would turn the whole outside-ROI region into one giant
 *   bright blob and cause false detections. Same intent, convention-flipped value.
 *
 * Because the inside background is also ~0, the ROI edge introduces no bright
 * step and produces no false blobs — and we additionally drop any peak whose
 * centre falls outside the mask. Mask first, detect second.
 *
 * @param {Float32Array} gray - raw channel intensity (0–255), NOT yet inverted
 * @param {number} width
 * @param {number} height
 * @param {DetectParams} params
 * @param {Uint8Array|null} [mask] - 1 inside AOI / 0 outside; null = whole image
 * @returns {Array<{x:number,y:number,intensity:number,strength:number}>}
 */
export function detectChannel(gray, width, height, params, mask = null) {
  const { R, Dmin, T, fluorescent, thresholdMode = 'log' } = params;

  // Step A: map into bright-blob space and apply the AOI mask.
  const n = width * height;
  const proc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = fluorescent ? gray[i] : 255 - gray[i];
    if (mask && mask[i] === 0) v = 0; // outside AOI → background
    proc[i] = v;
  }

  // Step B + C: Laplacian of Gaussian.
  const sigma = DERIVE.sigma(R);
  const blurred = gaussianBlur(proc, width, height, sigma);
  const log = laplacian(blurred, width, height);

  // Local maxima of -LoG (bright-blob centres), confined to the AOI.
  const nbRadius = Math.max(1, Math.round(R / 2));
  const peaks = findLocalMaxima(log, proc, width, height, nbRadius, mask);

  // Step D: threshold (intensity or relative LoG). Step E: min separation.
  const candidates = applyThreshold(peaks, thresholdMode, T);
  return nonMaxSuppression(candidates, Dmin);
}

/**
 * Legacy single-image entry: grayscale an RGBA buffer then detect (no mask).
 * Kept for direct/unit use; the worker now calls detectChannel per channel.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @returns {{ cells: Array }}
 */
export function detect(rgba, width, height, params) {
  const gray = rgbaToGrayscale(rgba, width, height, false); // raw; detectChannel inverts
  return { cells: detectChannel(gray, width, height, params) };
}

/**
 * Scan for pixels that are a local maximum of -LoG within `nbRadius`, inside the
 * AOI. Records both blob strength and underlying intensity so the threshold step
 * can filter by either. Background (LoG ≈ 0) is skipped cheaply via strength > 0.
 */
function findLocalMaxima(log, gray, width, height, nbRadius, mask) {
  const candidates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask && mask[idx] === 0) continue; // never detect outside the AOI

      const strength = -log[idx]; // bright-blob centres have strength > 0
      if (strength <= 0) continue;

      if (isLocalMax(log, width, height, x, y, nbRadius, log[idx])) {
        candidates.push({ x, y, intensity: gray[idx], strength });
      }
    }
  }
  return candidates;
}

/** True if log[x,y] is the minimum (i.e. -LoG is the max) in its neighborhood. */
function isLocalMax(log, width, height, x, y, r, centerVal) {
  const x0 = Math.max(0, x - r);
  const x1 = Math.min(width - 1, x + r);
  const y0 = Math.max(0, y - r);
  const y1 = Math.min(height - 1, y + r);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (xx === x && yy === y) continue;
      // Center must be the strongest (most negative LoG) in the window.
      if (log[yy * width + xx] < centerVal) return false;
    }
  }
  return true;
}
