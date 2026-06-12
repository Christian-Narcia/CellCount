/**
 * overlay.js — Draws detected cell markers onto the overlay canvas.
 *
 * Stateless renderer: give it a list of groups and it paints them. Two kinds:
 *   • 'cell' (default) — per-channel cells, a small filled dot of FIXED radius
 *                        (MARKER_STYLE.dotRadius, independent of R) in the
 *                        channel's colour, with a number label. A fixed tiny dot
 *                        keeps dense images readable (Phase 11; replaced the old
 *                        radius-R ring).
 *   • 'dot'            — co-localized cells, a larger filled disc in the combo's
 *                        mixed colour (sized from Co-R, no label), drawn on top.
 *                        Its dark edge + larger size keep it distinct from the
 *                        per-channel dots.
 *   • 'manual'         — user-placed markers (Phase 11): a small outlined SQUARE,
 *                        so hand-placed annotations read differently from the
 *                        round detection dots regardless of colour.
 * A group may carry its own `radius` (Co-R for 'dot' groups); per-channel 'cell'
 * groups ignore it and use the fixed dot radius.
 * Appearance defaults come from config (MARKER_STYLE).
 */

import { MARKER_STYLE } from '../config.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{ cells: Array<{x:number,y:number}>, color: string, kind?: 'cell'|'dot', radius?: number }>} groups
 * @param {number} radius - default radius in image px (used by 'dot' groups that omit their own)
 * @param {typeof MARKER_STYLE} [style]
 */
export function drawMarkerGroups(ctx, groups, radius, style = MARKER_STYLE) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.lineWidth = style.lineWidth;
  ctx.font = style.labelFont;
  ctx.textBaseline = 'middle';

  for (const group of groups) {
    const { cells, color, kind = 'cell' } = group;
    if (!cells || !cells.length) continue;

    if (kind === 'dot') {
      // Co-localization disc: sized from Co-R, floored well above the per-channel
      // dot so the two never read the same. Dark edge for contrast.
      const r = group.radius != null ? group.radius : radius;
      const dotRadius = Math.max(style.dotRadius + 2, r * 0.35);
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      for (const cell of cells) {
        ctx.beginPath();
        ctx.arc(cell.x, cell.y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      continue;
    }

    if (kind === 'manual') {
      // Outlined square so hand-placed markers are distinct from round dots.
      const half = style.dotRadius + 1.5;
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      for (const cell of cells) {
        ctx.beginPath();
        ctx.rect(cell.x - half, cell.y - half, half * 2, half * 2);
        ctx.fill();
        ctx.stroke();
      }
      continue;
    }

    // Per-channel cells: small fixed-radius filled dot + number label.
    const r = style.dotRadius;
    ctx.fillStyle = color;
    cells.forEach((cell, i) => {
      ctx.beginPath();
      ctx.arc(cell.x, cell.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (style.showLabels) {
        ctx.fillText(String(i + 1), cell.x + r + 2, cell.y);
      }
    });
  }
}
