/**
 * rasterize.js — Fill a polygon into a binary pixel mask (pure, DOM-free).
 *
 * Produces the AOI mask the worker consumes: a Uint8Array of length
 * width*height, 1 = inside the ROI, 0 = outside. Done ONCE on ROI load (it's the
 * expensive step), never per detection.
 *
 * Uses the even-odd (ray-casting) rule, evaluated a whole scanline at a time:
 * for each pixel-row we find where the row crosses the polygon edges, sort the
 * crossings, and fill the spans between consecutive pairs. That is exactly the
 * per-pixel ray-cast test, just batched per row so it's cheap even for large
 * images. Pixels are tested at their centre (x+0.5, y+0.5); the half-open edge
 * rule (yi ≤ yc < yj) keeps shared vertices from being counted twice.
 */

/**
 * @param {Array<[number,number]>} polygon - absolute pixel vertices (closed area)
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} length width*height, 1 inside / 0 outside
 */
export function rasterizePolygon(polygon, width, height) {
  const mask = new Uint8Array(width * height);
  if (!polygon || polygon.length < 3) return mask;

  // Limit work to the polygon's vertical extent.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of polygon) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(height - 1, Math.ceil(maxY));

  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5; // sample at the pixel-row centre
    xs.length = 0;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const yi = polygon[i][1];
      const yj = polygon[j][1];
      // Edge crosses this scanline? (half-open to avoid double-counting vertices)
      if ((yi <= yc && yj > yc) || (yj <= yc && yi > yc)) {
        const xi = polygon[i][0];
        const xj = polygon[j][0];
        const t = (yc - yi) / (yj - yi);
        xs.push(xi + t * (xj - xi));
      }
    }

    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Fill pixels whose centre lies between the two crossings.
      let xa = Math.ceil(xs[k] - 0.5);
      let xb = Math.floor(xs[k + 1] - 0.5);
      if (xa < 0) xa = 0;
      if (xb > width - 1) xb = width - 1;
      const row = y * width;
      for (let x = xa; x <= xb; x++) mask[row + x] = 1;
    }
  }
  return mask;
}
