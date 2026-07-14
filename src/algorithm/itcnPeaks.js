/**
 * itcnPeaks.js — ITCN's peak search (`find_local_max()` in Itcn_.java).
 *
 * ITCN does NOT collect every local maximum and then suppress. It runs a single
 * greedy loop:
 *
 *   repeat:
 *     take the strongest pixel that is still AVAILABLE (and > 0)
 *     if it is >= all its neighbours within `epsilon`  -> count it as a nucleus
 *     either way, mark every pixel within `minDist` of it UNAVAILABLE
 *   until nothing is left above 0
 *
 * Three things about this are easy to get wrong, and all three are reproduced here
 * because they change the count:
 *
 *  - THE VERIFY STEP READS SUPPRESSED PIXELS. Availability gates which pixel gets
 *    PICKED, but the >= comparison is against the raw response, including pixels
 *    already suppressed by an earlier nucleus. That is what makes the check
 *    meaningful: it rejects points sitting on the shoulder of a nucleus that has
 *    already been counted.
 *
 *  - SUPPRESSION HAPPENS EVEN WHEN THE POINT IS REJECTED. In the original the
 *    `minDist` suppression loop sits OUTSIDE the accept/reject branch, so a
 *    rejected shoulder still clears its whole disk. (This also makes the original's
 *    `mask[x][y] = false` in the else-branch redundant.)
 *
 *  - THE VERIFY NEIGHBOURHOOD EXCLUDES THE AXES. The original's guard is
 *    `i != 0 && j != 0` — an AND, not an OR — so the entire row i=0 and column j=0
 *    are left out of the disk. Almost certainly a typo for `||` in the 2006 code,
 *    but it is what ships in the plugin, so matching Fiji's counts requires keeping
 *    it. Fixing it would make the check slightly stricter and drop a few peaks.
 *
 * The original rescans the whole image for the global maximum on every iteration
 * (O(pixels * peaks) — a large part of why the plugin is slow). Sorting the
 * candidates once is equivalent: suppression only ever removes pixels, so the
 * strongest still-available pixel is always the next one in descending order. Ties
 * are broken the way the original's scan order breaks them — its comparison is a
 * strict `>` over an x-outer, y-inner scan, so among equal values the smallest x
 * (then smallest y) wins.
 *
 * Pure function.
 */

/**
 * @param {Float64Array} resp - response map, ALREADY soft-thresholded to max(0, S - t)
 * @param {number} imgW
 * @param {number} imgH
 * @param {number} epsilon - local-max verification radius (ITCN: floor(width / 3))
 * @param {number} minDist - suppression radius (ITCN's "Minimum Distance")
 * @param {Uint8Array|null} mask - 1 inside ROI / 0 outside; null = whole image
 * @param {number} [border=1] - px of the image edge to exclude (ITCN uses 1)
 * @returns {Array<{x:number,y:number,strength:number}>} peaks, strongest first
 */
export function findItcnPeaks(resp, imgW, imgH, epsilon, minDist, mask = null, border = 1) {
  // Verification neighbourhood: disk of radius `epsilon`, MINUS the two axes.
  const nbr = [];
  const eps = Math.floor(epsilon);
  for (let i = -eps; i <= eps; i++) {
    for (let j = -eps; j <= eps; j++) {
      if (i !== 0 && j !== 0 && i * i + j * j <= epsilon * epsilon) nbr.push([i, j]);
    }
  }

  // Suppression disk: radius `minDist`, including the centre.
  const supp = [];
  const md = Math.trunc(minDist);
  for (let i = -md; i <= md; i++) {
    for (let j = -md; j <= md; j++) {
      if (i * i + j * j <= minDist * minDist) supp.push([i, j]);
    }
  }

  // available[] doubles as ITCN's `mask`: the ROI gate, the border exclusion, and
  // the running record of what has been suppressed.
  const available = new Uint8Array(imgW * imgH);
  const candidates = [];
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const idx = y * imgW + x;
      const inBorder =
        x < border || x >= imgW - border || y < border || y >= imgH - border;
      const inRoi = !mask || mask[idx] === 1;
      if (inBorder || !inRoi) continue;
      available[idx] = 1;
      if (resp[idx] > 0) candidates.push(idx);
    }
  }

  // Descending strength; ties -> smallest x, then smallest y (the original's scan order).
  candidates.sort((a, b) => {
    const d = resp[b] - resp[a];
    if (d !== 0) return d;
    const ax = a % imgW;
    const bx = b % imgW;
    if (ax !== bx) return ax - bx;
    return a - b;
  });

  const peaks = [];
  for (const idx of candidates) {
    if (!available[idx]) continue;

    const x = idx % imgW;
    const y = (idx - x) / imgW;
    const strength = resp[idx];

    // Verify against the RAW response (suppressed pixels included).
    let isMax = true;
    for (let k = 0; k < nbr.length; k++) {
      const nx = x + nbr[k][0];
      const ny = y + nbr[k][1];
      if (nx < 0 || nx >= imgW || ny < 0 || ny >= imgH) continue; // original: caught + ignored
      if (strength < resp[ny * imgW + nx]) {
        isMax = false;
        break;
      }
    }

    if (isMax) peaks.push({ x, y, strength });

    // Suppress the disk whether or not the point was accepted.
    for (let k = 0; k < supp.length; k++) {
      const nx = x + supp[k][0];
      const ny = y + supp[k][1];
      if (nx < 0 || nx >= imgW || ny < 0 || ny >= imgH) continue;
      available[ny * imgW + nx] = 0;
    }
  }

  return peaks;
}
