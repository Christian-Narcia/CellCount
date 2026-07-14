/**
 * itcnKernel.js — ITCN's Laplacian-of-Gaussian kernel.
 *
 * A faithful port of `findKernal()` in the ITCN plugin's Itcn_.java (Kuo & Byun,
 * UCSB). Every constant here is transcribed from that source, not inferred — the
 * details below are what make Fiji's threshold value (default 0.2) mean the same
 * thing in this tool as it does in the plugin.
 *
 *   width   ITCN's "Width" field: the nucleus DIAMETER in pixels. It sets BOTH
 *           the scale and the kernel's side length — the kernel is width x width.
 *   sigma   = (width - 1) / 3.   NOT R/sqrt(2), and not the Lindeberg r/sqrt(2);
 *           ITCN picks its own constant.
 *
 * The kernel is sampled on the grid n = -(width-1)/2 .. +(width-1)/2 in steps of 1,
 * so for an EVEN width the samples land on half-integers (-9.5, -8.5, ... 9.5 for
 * width=20) and there is no sample at the exact centre. That is ITCN's behaviour and
 * it is reproduced deliberately; see itcnFilter.js for the matching half-pixel offset.
 *
 * Two normalizations are applied, in this order:
 *   1. subtract the mean of the raw LoG, then DIVIDE BY THE SUM OF THE GAUSSIAN
 *      (`hgSum`). This is the step that fixes the response's absolute scale: it
 *      turns the raw LoG into the analytic grad^2 G (the 1/(2*pi*sigma^2) Gaussian
 *      prefactor), so the response is in units of 8-bit intensity and an ABSOLUTE
 *      threshold like 0.2 is meaningful.
 *   2. subtract the mean again. Algebraically a no-op (step 1 already zeroed it);
 *      kept only so the port stays line-for-line with the original.
 *
 * Pure function.
 */

/**
 * ITCN's sigma for a given filter width (= nucleus diameter, px).
 * @param {number} width
 * @returns {number}
 */
export function itcnSigma(width) {
  return (width - 1.0) / 3.0;
}

/**
 * Build ITCN's width x width LoG kernel.
 *
 * The kernel has a NEGATIVE centre lobe and a positive surround (standard grad^2 G),
 * so a blob that is DARK in the filtered image produces a POSITIVE peak. ITCN gets
 * bright-nucleus detection by inverting the image instead of flipping the kernel —
 * see itcnFilter.js.
 *
 * @param {number} width - nucleus diameter in px (kernel is width x width)
 * @returns {{ kernel: Float64Array, sigma: number, width: number }}
 *          kernel is row-major, indexed [i + width * j]
 */
export function buildItcnKernel(width) {
  const sigma = itcnSigma(width);
  const variance = sigma * sigma;
  const n = width * width;

  const hg = new Float64Array(n); // Gaussian
  const h = new Float64Array(n); // raw LoG
  let hgSum = 0;
  let hSum = 0;

  const bounds = (width - 1.0) / 2.0;

  let index = 0;
  for (let n1 = -bounds; n1 <= bounds; n1++) {
    for (let n2 = -bounds; n2 <= bounds; n2++) {
      const r2 = n1 * n1 + n2 * n2;
      hg[index] = Math.exp(-r2 / (2 * variance));
      hgSum += hg[index];
      h[index] = ((r2 - 2 * variance) * hg[index]) / (variance * variance);
      hSum += h[index];
      index++;
    }
  }

  // Normalization 1: zero-mean, then scale by the Gaussian's mass. This is what
  // puts the response on an absolute, intensity-referenced scale.
  const mean = hSum / n;
  for (let i = 0; i < n; i++) h[i] = (h[i] - mean) / hgSum;

  // Normalization 2: ITCN re-centres the kernel a second time. Already ~0; kept for
  // exactness with the original.
  let kSum = 0;
  for (let i = 0; i < n; i++) kSum += h[i];
  const kOffset = kSum / n;
  for (let i = 0; i < n; i++) h[i] -= kOffset;

  return { kernel: h, sigma, width };
}
