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

import { DERIVE, thresholdScale } from '../config.js';
import { rgbaToGrayscale } from './grayscale.js';
import { gaussianBlur } from './gaussian.js';
import { laplacian } from './laplacian.js';
import { applyThreshold } from './threshold.js';
import { nonMaxSuppression } from './nms.js';

/**
 * @typedef {Object} DetectParams
 * @property {number} R      - expected cell radius (px)
 * @property {number} Dmin   - minimum separation between cells (px)
 * @property {number} T      - threshold: Fiji 0–10 ('log') or absolute 0–255 ('intensity')
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
 * AOI MASKING is a pure SPATIAL RESTRICTION: it controls WHERE cells are counted,
 * never the image content the detector sees or the sensitivity bar it uses. So we
 * run the full LoG pipeline on the WHOLE image and only at the end keep peaks
 * whose centre lies inside the ROI.
 *
 *   WHY NOT zero-out everything outside the ROI before blurring (the obvious
 *   "mask first" approach)? Two bugs:
 *     1. The relative 'log' threshold is `(T/10) × max blob strength` (T on the
 *        Fiji 0–10 scale). If the max
 *        is taken over only the in-ROI content, then drawing a smaller ROI that
 *        excludes the brightest cells LOWERS the bar and detects MORE faint cells
 *        — a smaller region yielding a higher count, which is wrong and confusing.
 *        Computing the reference over the full image keeps the bar ROI-independent,
 *        so the in-ROI result is always a strict subset of the whole-image result.
 *     2. Zeroing creates an artificial high-contrast EDGE along the ROI boundary
 *        whenever the background isn't ~0, and the Laplacian fires on it → false
 *        detections just inside the edge (the very thing todo.txt Phase 6 warns
 *        about). Not touching the pixels avoids the edge entirely.
 *   A blob centred OUTSIDE the ROI keeps its peak outside (Gaussian blur doesn't
 *   move an isolated peak), so the centre-in-ROI test cleanly excludes it without
 *   needing to blank the region. The mask is applied AFTER thresholding (so it
 *   can't change the bar) and BEFORE NMS (so an out-of-ROI peak can't suppress an
 *   in-ROI one).
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

  // Step A: map into bright-blob space (no masking here — see the note above).
  const n = width * height;
  const proc = new Float32Array(n);
  for (let i = 0; i < n; i++) proc[i] = fluorescent ? gray[i] : 255 - gray[i];

  // Step B + C: Laplacian of Gaussian.
  const sigma = DERIVE.sigma(R);
  const blurred = gaussianBlur(proc, width, height, sigma);
  const log = laplacian(blurred, width, height);

  // Local maxima of -LoG (bright-blob centres) over the WHOLE image, so the
  // relative threshold reference below is image-global and ROI-independent.
  const nbRadius = Math.max(1, Math.round(R / 2));
  const peaks = findLocalMaxima(log, proc, width, height, nbRadius);

  // Step D: threshold (intensity or relative LoG — reference is the global max).
  // thresholdScale maps the 'log' Fiji 0–10 value to a 0–1 peak fraction.
  let candidates = applyThreshold(peaks, thresholdMode, T, thresholdScale(thresholdMode));
  // AOI restriction: keep only cells whose centre is inside the ROI. After the
  // threshold (so the ROI never moves the bar), before NMS (so an out-of-ROI peak
  // can't suppress an in-ROI one).
  if (mask) candidates = candidates.filter((c) => mask[c.y * width + c.x] === 1);

  // Step E: min separation.
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
 * Scan for pixels that are a local maximum of -LoG within `nbRadius` over the
 * whole image. Records both blob strength and underlying intensity so the
 * threshold step can filter by either. Background (LoG ≈ 0) is skipped cheaply via
 * strength > 0. (AOI restriction happens after thresholding — see detectChannel.)
 */
function findLocalMaxima(log, gray, width, height, nbRadius) {
  const candidates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
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
