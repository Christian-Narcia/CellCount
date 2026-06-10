/**
 * grayscale.js — RGBA → single-channel grayscale, with optional inversion.
 *
 * Pure function. No DOM, no globals. Safe to run inside a Web Worker.
 */

/**
 * Convert an RGBA byte buffer to a Float32 grayscale buffer (range 0–255).
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba - length = width * height * 4
 * @param {number} width
 * @param {number} height
 * @param {boolean} [invert=false] - if true, pixel = 255 - pixel
 * @returns {Float32Array} grayscale intensities, length = width * height
 */
export function rgbaToGrayscale(rgba, width, height, invert = false) {
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    // Rec. 601 luma — perceptually weighted grayscale.
    const g = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    out[i] = invert ? 255 - g : g;
  }
  return out;
}
