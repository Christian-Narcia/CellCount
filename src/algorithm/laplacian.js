/**
 * laplacian.js — Discrete Laplacian (second spatial derivative).
 *
 * Applied to a Gaussian-blurred image this yields the Laplacian-of-Gaussian
 * (LoG) response. Pure function.
 */

// 3x3 discrete Laplacian kernel: ∂²/∂x² + ∂²/∂y².
const LAPLACIAN = [0, 1, 0, 1, -4, 1, 0, 1, 0];

/**
 * Apply the 3x3 Laplacian. Edges clamp to nearest valid pixel.
 *
 * @param {Float32Array} src - (blurred) grayscale, length = width * height
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} LoG response (signed), same dimensions
 */
export function laplacian(src, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const sy = clamp(y + dy, 0, height - 1);
        for (let dx = -1; dx <= 1; dx++) {
          const sx = clamp(x + dx, 0, width - 1);
          acc += src[sy * width + sx] * LAPLACIAN[ki++];
        }
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
