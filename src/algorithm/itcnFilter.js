/**
 * itcnFilter.js — ITCN's convolution stage (`filter2()` in Itcn_.java).
 *
 * Produces the blob-response map the peak search runs on. Three details are load-
 * bearing for Fiji parity; all three are transcribed from the plugin source:
 *
 *  1. POLARITY BY INVERSION, NOT BY SIGN FLIP. ITCN's kernel always has a negative
 *     centre lobe, so it always responds POSITIVELY to blobs that are DARK in the
 *     filtered image, and the peak search always looks for MAXIMA. To find BRIGHT
 *     nuclei it therefore feeds the filter `255 - pixel`:
 *         Detect Dark Peaks OFF (bright nuclei / fluorescence) -> pix = 255 - raw
 *         Detect Dark Peaks ON  (dark nuclei / brightfield)    -> pix = raw
 *     Because the kernel is zero-mean the constant 255 cancels, so this is exactly
 *     equivalent to negating the response — but it is written ITCN's way so the
 *     code reads against the source.
 *
 *  2. ZERO PADDING. Taps that fall outside the image are skipped, i.e. treated as 0
 *     — NOT clamped or reflected. This darkens the response near the border, which
 *     is why ITCN also excludes a 1px border in the peak search.
 *
 *  3. HALF-PIXEL OFFSET ON EVEN WIDTHS. The kernel is sampled on the half-integer
 *     grid (see itcnKernel.js) but applied with an INTEGER centre offset of
 *     floor((width-1)/2) — Java integer division. For width=20 the kernel spans
 *     n = -9.5..9.5 yet is centred on tap index 9, so the filter is offset by half a
 *     pixel. Reproduced deliberately: removing it shifts peaks relative to Fiji.
 *
 * PERFORMANCE. ITCN convolves directly: width^2 taps per pixel (400 at the default
 * width of 20), which is why the plugin is slow. We use an exact separable
 * factorization instead. Writing r2 = n1^2 + n2^2, the raw LoG
 *     h(n1,n2) = (r2 - 2s^2) * exp(-r2 / 2s^2) / s^4
 * is RANK 2, because r2 - 2s^2 = (n1^2 - s^2) + (n2^2 - s^2):
 *     h(n1,n2) = [ u(n1)*e(n2) + e(n1)*u(n2) ] / s^4,
 *     where e(n) = exp(-n^2 / 2s^2)  and  u(n) = (n^2 - s^2) * e(n).
 * The zero-mean offset that ITCN subtracts is a constant, so it contributes a plain
 * box sum. That gives three 1-D horizontal passes and three 1-D vertical passes —
 * O(width) per pixel instead of O(width^2), same result to floating-point rounding.
 * `itcnResponseDirect()` below is the literal O(width^2) version, kept because the
 * test suite asserts the two agree.
 *
 * Pure functions.
 */

import { buildItcnKernel, itcnSigma } from './itcnKernel.js';

/**
 * Map a raw channel into ITCN's filter input: 8-bit, with the polarity that makes
 * the nuclei of interest DARK (so the negative-centre kernel peaks positively).
 *
 * @param {Float32Array|Float64Array} gray - raw intensity, 0-255
 * @param {boolean} darkPeaks - true = nuclei are dark (brightfield); false = bright
 * @returns {Float64Array}
 */
export function toFilterInput(gray, darkPeaks) {
  const n = gray.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // ITCN reads an 8-bit ImageProcessor: (0xff & byte). Round/clamp to match the
    // "Image > Type > 8-bit" conversion a Fiji user does before running the plugin.
    let v = Math.round(gray[i]);
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    out[i] = darkPeaks ? v : 255 - v;
  }
  return out;
}

/**
 * ITCN blob response (separable fast path).
 *
 * @param {Float32Array|Float64Array} gray - raw channel intensity, 0-255
 * @param {number} imgW
 * @param {number} imgH
 * @param {number} width - ITCN "Width" = nucleus diameter, px
 * @param {boolean} darkPeaks
 * @returns {Float64Array} response, row-major [y * imgW + x]
 */
export function itcnResponse(gray, imgW, imgH, width, darkPeaks) {
  const sigma = itcnSigma(width);
  const variance = sigma * sigma;
  const bounds = (width - 1.0) / 2.0;
  const off = Math.floor((width - 1) / 2); // Java int division — see note 3 above

  // 1-D factors on the same (possibly half-integer) grid the kernel uses.
  const e = new Float64Array(width);
  const u = new Float64Array(width);
  let eSum = 0;
  let hSum = 0;
  for (let k = 0; k < width; k++) {
    const n = k - bounds;
    e[k] = Math.exp(-(n * n) / (2 * variance));
    u[k] = (n * n - variance) * e[k];
    eSum += e[k];
  }
  // hgSum = sum of the 2-D Gaussian = (sum of the 1-D Gaussian)^2.
  const hgSum = eSum * eSum;
  // hSum = sum of the raw 2-D LoG = 2 * uSum * eSum / s^4.
  let uSum = 0;
  for (let k = 0; k < width; k++) uSum += u[k];
  hSum = (2 * uSum * eSum) / (variance * variance);

  // Final kernel = (raw - mean) / hgSum  =>  response = A*(rank-2 part) - B*(box sum)
  const A = 1 / (variance * variance * hgSum);
  const B = hSum / (width * width) / hgSum;

  const pix = toFilterInput(gray, darkPeaks);
  const n = imgW * imgH;

  // --- horizontal passes (zero-padded) ---
  const He = new Float64Array(n); // pix * e
  const Hu = new Float64Array(n); // pix * u
  const Hb = new Float64Array(n); // pix * 1 (box)
  for (let y = 0; y < imgH; y++) {
    const row = y * imgW;
    for (let x = 0; x < imgW; x++) {
      let se = 0;
      let su = 0;
      let sb = 0;
      const lo = Math.max(0, off - x);
      const hi = Math.min(width, imgW + off - x);
      for (let i = lo; i < hi; i++) {
        const p = pix[row + x + i - off];
        se += e[i] * p;
        su += u[i] * p;
        sb += p;
      }
      He[row + x] = se;
      Hu[row + x] = su;
      Hb[row + x] = sb;
    }
  }

  // --- vertical passes (zero-padded) ---
  const out = new Float64Array(n);
  for (let y = 0; y < imgH; y++) {
    const lo = Math.max(0, off - y);
    const hi = Math.min(width, imgH + off - y);
    for (let x = 0; x < imgW; x++) {
      let vu = 0; // u over He
      let ve = 0; // e over Hu
      let vb = 0; // box over Hb
      for (let j = lo; j < hi; j++) {
        const idx = (y + j - off) * imgW + x;
        vu += u[j] * He[idx];
        ve += e[j] * Hu[idx];
        vb += Hb[idx];
      }
      out[y * imgW + x] = A * (vu + ve) - B * vb;
    }
  }

  return out;
}

/**
 * Literal O(width^2) transcription of ITCN's filter2(). Slow; used by the tests as
 * the oracle that itcnResponse() is checked against.
 *
 * @returns {Float64Array} response, row-major [y * imgW + x]
 */
export function itcnResponseDirect(gray, imgW, imgH, width, darkPeaks) {
  const { kernel } = buildItcnKernel(width);
  const pix = toFilterInput(gray, darkPeaks);
  const out = new Float64Array(imgW * imgH);
  const off = Math.floor((width - 1) / 2);

  for (let x = 0; x < imgW; x++) {
    for (let y = 0; y < imgH; y++) {
      let acc = 0;
      for (let i = 0; i < width; i++) {
        const sx = x + i - off;
        if (sx < 0 || sx >= imgW) continue;
        for (let j = 0; j < width; j++) {
          const sy = y + j - off;
          if (sy < 0 || sy >= imgH) continue;
          acc += kernel[i + width * j] * pix[sy * imgW + sx];
        }
      }
      out[y * imgW + x] = acc;
    }
  }
  return out;
}
