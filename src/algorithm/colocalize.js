/**
 * colocalize.js — Co-localization pass over per-channel cell lists.
 *
 * Runs after per-channel detection (on the main thread — it's cheap distance
 * math, not pixel work). For each combination of eligible loaded channels it
 * finds cells that co-locate across all members of the combo within a radius
 * Co-R. Pure and DOM-free.
 *
 * Combinations reported: EVERY combination of loaded eligible channels of size
 * ≥ 2 — all pairs, all triples, … up to the full set. E.g. for R/G/B loaded:
 * R+G, R+B, G+B, R+G+B; add Gray and you also get R+Gray, …, R+G+B, …, R+G+B+Gray.
 * (So a partial combo like R+G+B is always reported even when more channels are
 * eligible — it is not collapsed into only the full set.)
 *
 * A cell in the combo's ANCHOR channel (the first, in the given key order)
 * qualifies as co-localized if every OTHER channel in the combo has a cell
 * within Co-R of it; the reported position is the anchor cell's. (Anchor-based
 * matching is the standard ITCN approach; the count is read as "anchor cells
 * that also appear in the other channel(s)".)
 */

/**
 * @param {Record<string, Array<{x:number,y:number}>>} perChannel
 * @param {string[]} keys - eligible channel keys IN ORDER (e.g. ['r','g','b'])
 * @param {number} coR - co-localization radius in px
 * @returns {Record<string, Array<{x:number,y:number,channels:string[]}>>}
 *          keyed by combo (e.g. 'r+g'), each an array of co-localized cells
 */
export function colocalize(perChannel, keys, coR) {
  const loaded = keys.filter((k) => perChannel[k] && perChannel[k].length);
  const combos = buildCombos(loaded);
  const r2 = coR * coR;
  const result = {};

  for (const combo of combos) {
    const [anchor, ...rest] = combo;
    const out = [];
    for (const cell of perChannel[anchor]) {
      let ok = true;
      for (const other of rest) {
        if (!hasNeighborWithin(perChannel[other], cell, r2)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push({ x: cell.x, y: cell.y, channels: combo });
    }
    result[combo.join('+')] = out;
  }
  return result;
}

/**
 * Per-cell, SYMMETRIC co-localization: for every cell in every eligible loaded
 * channel, which OTHER channels have a cell within Co-R of it. Unlike colocalize()
 * (anchor-based, for counting combos), this is symmetric — a cell in G that sits
 * near an R cell reports 'r', and vice-versa — which is what the CSV's
 * `colocalized_with` column needs (one truthful answer per detected cell).
 *
 * @param {Record<string, Array<{x:number,y:number}>>} perChannel
 * @param {string[]} keys - eligible channel keys (e.g. ['r','g','b'])
 * @param {number} coR - co-localization radius in px
 * @returns {Record<string, string[][]>} keyed by channel; out[ch][i] is the list
 *          of other channels co-localized with perChannel[ch][i], in `keys` order.
 */
export function colocalizationByCell(perChannel, keys, coR) {
  const loaded = keys.filter((k) => perChannel[k] && perChannel[k].length);
  const r2 = coR * coR;
  const out = {};
  for (const ch of loaded) {
    out[ch] = perChannel[ch].map((cell) =>
      loaded.filter((other) => other !== ch && hasNeighborWithin(perChannel[other], cell, r2))
    );
  }
  return out;
}

/**
 * Every combination (subset) of `keys` of size ≥ 2, ordered by size ascending then
 * by the channel order in `keys` — e.g. [r,g,b] → r+g, r+b, g+b, r+g+b. So adding
 * a 4th eligible channel yields all pairs, all triples, and the 4-way set (and the
 * existing triples like r+g+b are kept, not replaced by the full set).
 */
export function buildCombos(keys) {
  const combos = [];
  for (let size = 2; size <= keys.length; size++) {
    addSubsetsOfSize(keys, size, 0, [], combos);
  }
  return combos;
}

/** Recursively collect every size-`size` subset of keys[start..] into `out`. */
function addSubsetsOfSize(keys, size, start, current, out) {
  if (current.length === size) {
    out.push(current.slice());
    return;
  }
  // Stop early when not enough keys remain to reach `size`.
  for (let i = start; i <= keys.length - (size - current.length); i++) {
    current.push(keys[i]);
    addSubsetsOfSize(keys, size, i + 1, current, out);
    current.pop();
  }
}

/**
 * True if any cell in `cells` lies within sqrt(r2) of `target`.
 * Linear scan — fine for typical counts; swap in a spatial grid if lists get huge.
 */
function hasNeighborWithin(cells, target, r2) {
  for (const c of cells) {
    const dx = c.x - target.x;
    const dy = c.y - target.y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}
