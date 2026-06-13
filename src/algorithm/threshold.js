/**
 * threshold.js — Step D: filter blob candidates by a threshold.
 *
 * Two modes (chosen in the UI). T's RANGE differs per mode — the slider re-ranges
 * to match (config.js THRESHOLD_MODES / controls.js):
 *
 *   'intensity'  T is an absolute pixel value (0–255). A candidate is kept if
 *                its (inverted) grayscale intensity ≥ T. Intuitive, but tied to
 *                absolute brightness — sensitive to uneven illumination.
 *
 *   'log'        T is a *relative* LoG-strength threshold on the Fiji/ImageJ ITCN
 *                0.0–10.0 scale. `scale` (10) converts it to a 0–1 fraction of the
 *                strongest blob response in the image; a candidate is kept if its
 *                LoG strength is at least (T / scale) × (max strength). This is how
 *                the real ITCN plugin thresholds — robust to illumination and
 *                independent of bit depth.
 *
 * Pure function.
 */

/**
 * @param {Array<{intensity:number,strength:number}>} candidates
 * @param {'intensity'|'log'} mode
 * @param {number} T - slider value: 'log' on the 0–10 Fiji scale, 'intensity' 0–255
 * @param {number} [scale=1] - divisor mapping a 'log' T to a 0–1 peak fraction (10 for Fiji)
 * @returns {Array} filtered candidates
 */
export function applyThreshold(candidates, mode, T, scale = 1) {
  if (mode === 'log') {
    let maxStrength = 0;
    for (const c of candidates) {
      if (c.strength > maxStrength) maxStrength = c.strength;
    }
    const minStrength = (T / scale) * maxStrength; // T/scale = 0–1 fraction of the peak
    return candidates.filter((c) => c.strength >= minStrength);
  }

  // Default: absolute intensity threshold.
  return candidates.filter((c) => c.intensity >= T);
}
