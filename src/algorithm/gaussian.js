/**
 * gaussian.js — Separable Gaussian blur.
 *
 * Pure function. The kernel is normalized to sum to 1 so blurring never
 * changes overall image brightness (a classic, easy-to-miss bug).
 */

/**
 * Build a normalized 1-D Gaussian kernel.
 * @param {number} sigma
 * @returns {{ kernel: Float32Array, radius: number }}
 */
export function gaussianKernel1D(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  const twoSigmaSq = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / twoSigmaSq);
    kernel[i + radius] = v;
    sum += v;
  }
  // Normalize — values must sum to 1.
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return { kernel, radius };
}

/**
 * Apply a separable Gaussian blur (horizontal pass then vertical pass).
 * Edges are handled by clamping to the nearest valid pixel.
 *
 * @param {Float32Array} src - grayscale, length = width * height
 * @param {number} width
 * @param {number} height
 * @param {number} sigma
 * @returns {Float32Array} blurred image, same dimensions
 */
export function gaussianBlur(src, width, height, sigma) {
  const { kernel, radius } = gaussianKernel1D(sigma);
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);

  // Horizontal pass: src -> tmp
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = clamp(x + k, 0, width - 1);
        acc += src[row + sx] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }

  // Vertical pass: tmp -> out
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = clamp(y + k, 0, height - 1);
        acc += tmp[sy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = acc;
    }
  }

  return out;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
