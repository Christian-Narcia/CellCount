/**
 * detect.js — the ITCN detection pipeline.
 *
 * A faithful port of the ITCN ImageJ plugin (Kuo & Byun, UCSB — `Itcn_.java`), so
 * that the same parameters produce the same counts here as they do in Fiji. The
 * three stages map one-to-one onto the plugin's `run()`:
 *
 *   1. CONVOLVE with ITCN's width x width LoG kernel      -> itcnFilter.js
 *   2. SOFT-THRESHOLD the response: S = max(0, S - T)     -> here
 *   3. GREEDY peak search with a minDist suppression disk -> itcnPeaks.js
 *
 * PARAMETER MAPPING. ITCN's "Width" field is the nucleus DIAMETER; this tool's R is
 * the RADIUS, so width = 2R. A Fiji user with Width=20 uses R=10 here. Everything
 * else follows from width (see config.js DERIVE):
 *
 *   sigma   = (width - 1) / 3        NOT R/sqrt(2)
 *   kernel  = width x width          (a tight ~1.5 sigma truncation)
 *   epsilon = floor(width / 3)       local-max verification radius
 *
 * THE THRESHOLD IS ABSOLUTE. This is the parameter that most often gets mis-ported.
 * ITCN compares the response against T directly — T is a fixed bar in units of 8-bit
 * intensity, made meaningful by the kernel's 1/sum(Gaussian) normalization
 * (itcnKernel.js). It is NOT a fraction of the strongest blob in the image. An
 * earlier build here normalized by the image maximum, which coupled every cell's
 * fate to the brightest object in the field: adding one saturated speck could LOWER
 * the count of everything else, and the same cells counted differently depending on
 * what else was in frame. Fiji's default T = 0.2 on this absolute scale.
 *
 * AOI MASKING is a spatial gate on the peak search, exactly as in ITCN: masked-out
 * pixels are never selected as peaks and so can never suppress an in-ROI one. With
 * the threshold now absolute, the ROI cannot move the detection bar at all — the
 * in-ROI count is always a strict subset of the whole-image count.
 *
 * Pure and DOM-free: the single entry point the worker calls per channel, and
 * unit-testable directly in Node.
 */

import { DERIVE } from '../config.js';
import { rgbaToGrayscale } from './grayscale.js';
import { itcnResponse } from './itcnFilter.js';
import { findItcnPeaks } from './itcnPeaks.js';

/**
 * @typedef {Object} DetectParams
 * @property {number} R      - expected cell RADIUS (px). ITCN's Width = 2R.
 * @property {number} Dmin   - minimum separation between cells (px). ITCN default = R.
 * @property {number} T      - threshold: absolute response ('itcn', Fiji default 0.2)
 *                             or absolute pixel value 0-255 ('intensity')
 * @property {boolean} fluorescent - bright cells on dark bg. Equivalent to ITCN's
 *                             "Detect Dark Peaks" being UNCHECKED.
 * @property {'itcn'|'intensity'} [thresholdMode]
 */

/**
 * Detect cells in a single grayscale channel, optionally restricted to an AOI.
 *
 * @param {Float32Array} gray - raw channel intensity (0-255), NOT inverted
 * @param {number} width - image width
 * @param {number} height - image height
 * @param {DetectParams} params
 * @param {Uint8Array|null} [mask] - 1 inside AOI / 0 outside; null = whole image
 * @returns {Array<{x:number,y:number,intensity:number,strength:number}>}
 */
export function detectChannel(gray, width, height, params, mask = null) {
  const { R, Dmin, T, fluorescent, thresholdMode = 'itcn' } = params;

  const filterWidth = DERIVE.filterWidth(R); // ITCN "Width" (diameter)
  const darkPeaks = !fluorescent; // ITCN "Detect Dark Peaks"

  // 1. Convolve. Peaks are MAXIMA of this response (itcnFilter.js explains why the
  //    polarity is handled by inverting the image rather than flipping the kernel).
  const resp = itcnResponse(gray, width, height, filterWidth, darkPeaks);

  // 2. Soft-threshold: everything below T is flattened to exactly 0 and the rest is
  //    shifted down. Zeroed pixels can never be picked as peaks, so this is the
  //    detection bar. In 'intensity' mode the response bar is off (T gates the
  //    underlying pixel value instead, below).
  const t = thresholdMode === 'intensity' ? 0 : T;
  if (t > 0) {
    for (let i = 0; i < resp.length; i++) {
      resp[i] = resp[i] < t ? 0 : resp[i] - t;
    }
  }

  // 3. Greedy peak search: verify within epsilon, suppress within Dmin.
  const epsilon = DERIVE.epsilon(R);
  const peaks = findItcnPeaks(resp, width, height, epsilon, Dmin, mask, DERIVE.border);

  // Report the intensity in "bright-blob space" (what the detector effectively saw),
  // so it reads high for a detected cell in either mode.
  const cells = peaks.map((p) => {
    const raw = gray[p.y * width + p.x];
    return {
      x: p.x,
      y: p.y,
      intensity: fluorescent ? raw : 255 - raw,
      strength: p.strength,
    };
  });

  if (thresholdMode === 'intensity') return cells.filter((c) => c.intensity >= T);
  return cells;
}

/**
 * Legacy single-image entry: grayscale an RGBA buffer then detect (no mask).
 * Kept for direct/unit use; the worker calls detectChannel per channel.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @returns {{ cells: Array }}
 */
export function detect(rgba, width, height, params) {
  const gray = rgbaToGrayscale(rgba, width, height, false); // raw; detectChannel handles polarity
  return { cells: detectChannel(gray, width, height, params) };
}
