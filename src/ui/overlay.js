/**
 * overlay.js — Draws detected cell markers onto the overlay canvas.
 *
 * Stateless renderer: give it a list of groups and it paints them. Two kinds:
 *   • 'ring' (default) — per-channel cells, an unfilled circle (radius R) in the
 *                        channel's colour, with a number label.
 *   • 'dot'            — co-localized cells, a small filled disc in the combo's
 *                        mixed colour (no label), drawn on top of the rings.
 * Each group may carry its own `radius` (so per-channel R draws the right ring
 * size — Phase 9); groups without one fall back to the default `radius` arg.
 * Appearance defaults come from config (MARKER_STYLE).
 */

import { MARKER_STYLE } from '../config.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{ cells: Array<{x:number,y:number}>, color: string, kind?: 'ring'|'dot', radius?: number }>} groups
 * @param {number} radius - default ring radius in image px (used when a group omits its own)
 * @param {typeof MARKER_STYLE} [style]
 */
export function drawMarkerGroups(ctx, groups, radius, style = MARKER_STYLE) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.lineWidth = style.lineWidth;
  ctx.font = style.labelFont;
  ctx.textBaseline = 'middle';

  for (const group of groups) {
    const { cells, color, kind = 'ring' } = group;
    if (!cells || !cells.length) continue;
    const r = group.radius != null ? group.radius : radius;

    if (kind === 'dot') {
      const dotRadius = Math.max(2, r * 0.35);
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'; // thin dark edge for contrast
      for (const cell of cells) {
        ctx.beginPath();
        ctx.arc(cell.x, cell.y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      continue;
    }

    // Rings + number labels.
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    cells.forEach((cell, i) => {
      ctx.beginPath();
      ctx.arc(cell.x, cell.y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (style.showLabels) {
        ctx.fillText(String(i + 1), cell.x + r + 2, cell.y);
      }
    });
  }
}
