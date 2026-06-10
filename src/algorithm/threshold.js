/**
 * threshold.js — Step D: filter blob candidates by a threshold.
 *
 * Two modes (chosen in the UI):
 *
 *   'intensity'  T is an absolute pixel value (0–255). A candidate is kept if
 *                its (inverted) grayscale intensity ≥ T. Intuitive, but tied to
 *                absolute brightness — sensitive to uneven illumination.
 *
 *   'log'        T is a *relative* sensitivity (0–255 → 0–100% of the strongest
 *                blob response). A candidate is kept if its LoG strength is at
 *                least that fraction of the max strength in the image. This is
 *                how the real ITCN plugin thresholds — robust to illumination.
 *
 * Pure function.
 */

/**
 * @param {Array<{intensity:number,strength:number}>} candidates
 * @param {'intensity'|'log'} mode
 * @param {number} T - 0–255
 * @returns {Array} filtered candidates
 */
export function applyThreshold(candidates, mode, T) {
  if (mode === 'log') {
    let maxStrength = 0;
    for (const c of candidates) {
      if (c.strength > maxStrength) maxStrength = c.strength;
    }
    const minStrength = (T / 255) * maxStrength; // relative cutoff
    return candidates.filter((c) => c.strength >= minStrength);
  }

  // Default: absolute intensity threshold.
  return candidates.filter((c) => c.intensity >= T);
}
