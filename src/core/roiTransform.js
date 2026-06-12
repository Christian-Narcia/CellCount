/**
 * roiTransform.js — Rotate / translate an ROI polygon (pure, DOM-free, testable).
 *
 * The AOI mask is rasterised from a polygon (core/rasterize.js). To let the user
 * rotate the loaded ROI by a number of degrees and reposition it by dragging, we
 * apply a rigid-body transform to the ORIGINAL polygon vertices and rasterise the
 * result — keeping the source polygon untouched so repeated edits never drift.
 *
 * Rotation pivots around the polygon's bounding-box centre (a stable point of the
 * UNTRANSFORMED polygon), then the whole shape is translated by (dx, dy) image
 * pixels. Angle is in degrees, clockwise in screen space (y points down).
 */

/** Bounding-box centre of a polygon: [cx, cy]. */
export function polygonCenter(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/**
 * Apply { angle (deg), dx, dy } to a polygon, rotating about `center` (defaults to
 * the polygon's bbox centre). Returns a NEW polygon; the input is not mutated.
 *
 * @param {Array<[number,number]>} polygon
 * @param {{ angle?: number, dx?: number, dy?: number }} [transform]
 * @param {[number,number]|null} [center] - rotation pivot (else bbox centre)
 * @returns {Array<[number,number]>}
 */
export function transformPolygon(polygon, transform = {}, center = null) {
  if (!polygon || !polygon.length) return polygon;
  const { angle = 0, dx = 0, dy = 0 } = transform;
  const [cx, cy] = center || polygonCenter(polygon);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return polygon.map(([x, y]) => {
    const ox = x - cx;
    const oy = y - cy;
    return [cx + ox * cos - oy * sin + dx, cy + ox * sin + oy * cos + dy];
  });
}

/** True when a transform leaves the polygon unchanged (no rotation, no move). */
export function isIdentity({ angle = 0, dx = 0, dy = 0 } = {}) {
  return angle === 0 && dx === 0 && dy === 0;
}
