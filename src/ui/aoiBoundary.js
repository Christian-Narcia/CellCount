/**
 * aoiBoundary.js — Trace the AOI mask edge as a dashed outline.
 *
 * Layer 3 of the canvas stack: drawn once when the mask loads (it never changes
 * with detection params), below the marker overlay. A pixel is on the boundary
 * when it is INSIDE the AOI but has at least one OUTSIDE 4-neighbour (or sits on
 * the image edge). Those boundary pixels are stippled on a coarse grid so the
 * 1px outline reads as a dashed line at any zoom.
 *
 * Stateless renderer: give it a context + mask, it paints. Appearance comes from
 * config (AOI_STYLE).
 */

import { AOI_STYLE } from '../config.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Uint8Array|null} mask - 1 inside / 0 outside; null clears the layer
 * @param {number} width
 * @param {number} height
 * @param {typeof AOI_STYLE} [style]
 */
export function drawAoiBoundary(ctx, mask, width, height, style = AOI_STYLE) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!mask) return;

  ctx.fillStyle = style.color;
  const dash = Math.max(1, style.dash);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;

      const onEdge =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !mask[i - 1] ||
        !mask[i + 1] ||
        !mask[i - width] ||
        !mask[i + width];
      if (!onEdge) continue;

      // Stipple: draw only every other dash-sized step so the outline is dashed.
      if (Math.floor((x + y) / dash) % 2 !== 0) continue;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}
