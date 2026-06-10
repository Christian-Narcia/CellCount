/**
 * nms.js — Non-maximum suppression by spatial distance.
 *
 * Given scored candidate points, keep the strongest while enforcing a minimum
 * separation (Dmin) between any two accepted points. Pure function.
 */

/**
 * @typedef {{ x: number, y: number, strength: number, intensity: number }} Candidate
 */

/**
 * @param {Candidate[]} candidates
 * @param {number} Dmin - minimum Euclidean distance between accepted points
 * @returns {Candidate[]} accepted points, strongest first
 */
export function nonMaxSuppression(candidates, Dmin) {
  // Strongest candidates win ties for their neighborhood.
  const sorted = candidates.slice().sort((a, b) => b.strength - a.strength);
  const accepted = [];
  const dminSq = Dmin * Dmin;

  for (const c of sorted) {
    let ok = true;
    for (const a of accepted) {
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      if (dx * dx + dy * dy < dminSq) {
        ok = false;
        break;
      }
    }
    if (ok) accepted.push(c);
  }
  return accepted;
}
