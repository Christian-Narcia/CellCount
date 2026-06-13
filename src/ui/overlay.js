/**
 * overlay.js — Draws detected cell markers onto the overlay canvas.
 *
 * Stateless renderer: give it a list of groups and it paints them. Two kinds:
 *   • 'cell' (default) — per-channel cells, in the channel's colour with a number
 *                        label. Its SHAPE follows the group's `markerStyle`
 *                        (Phase 11 user toggle, ui/markerStyle.js):
 *                          'dots'  → a small filled dot of FIXED radius
 *                                    (MARKER_STYLE.dotRadius, independent of R) —
 *                                    keeps dense images readable (the default).
 *                          'rings' → an unfilled circle at the group's own
 *                                    `radius` (the channel's detected R) — the
 *                                    original look, shows R relative to each cell.
 *                        Defaults to 'dots' when `markerStyle` is omitted.
 *   • 'dot'            — co-localized cells, a larger filled disc in the combo's
 *                        mixed colour (sized from Co-R, no label), drawn on top.
 *                        Its dark edge + larger size keep it distinct from the
 *                        per-channel dots.
 *   • 'manual'         — user-placed markers (Phase 11): a small outlined SQUARE,
 *                        so hand-placed annotations read differently from the
 *                        round detection dots regardless of colour. Numbered from
 *                        the group's `labelStart` so the labels continue that
 *                        channel's detected sequence (detected 1…N, manual N+1…).
 * A group may carry its own `radius` (Co-R for 'dot' groups; channel R for 'cell'
 * rings) and `labelStart` ('manual' groups); other kinds ignore them.
 * Appearance defaults come from config (MARKER_STYLE).
 */

import { MARKER_STYLE } from '../config.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{ cells: Array<{x:number,y:number}>, color: string, kind?: 'cell'|'dot'|'manual', radius?: number, markerStyle?: 'dots'|'rings', labelStart?: number }>} groups
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
      // A SQUARE so hand-placed markers are distinct from the round detection
      // markers, with a number label continuing that channel's detected sequence
      // (labelStart). The square's fill tracks the marker-style toggle so it stays
      // distinct from whichever detection look is active:
      //   'dots'  → FILLED square  (pairs with filled-dot detections)
      //   'rings' → HOLLOW square  (pairs with ring detections; still square, so
      //             square≠circle keeps manual vs detected readable)
      const asRings = group.markerStyle === 'rings';
      const half = asRings ? style.dotRadius + 3 : style.dotRadius + 1.5;
      const start = group.labelStart != null ? group.labelStart : 1;
      cells.forEach((cell, i) => {
        ctx.beginPath();
        ctx.rect(cell.x - half, cell.y - half, half * 2, half * 2);
        if (asRings) {
          // Dark backing stroke + colour stroke, no fill → a clean hollow square.
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = style.lineWidth + 1.5;
          ctx.stroke();
          ctx.strokeStyle = color;
          ctx.lineWidth = style.lineWidth;
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.fill();
          ctx.stroke();
        }
        if (style.showLabels) {
          ctx.fillStyle = color;
          ctx.fillText(String(start + i), cell.x + half + 2, cell.y);
        }
      });
      ctx.lineWidth = style.lineWidth; // restore (the ring path mutated it)
      continue;
    }

    // Per-channel cells + number label. Shape follows the group's markerStyle:
    //   'rings' → stroked circle at the channel's own R (group.radius)
    //   'dots'  → filled dot of fixed radius (default)
    const asRings = group.markerStyle === 'rings';
    const r = asRings ? (group.radius != null ? group.radius : radius) : style.dotRadius;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    cells.forEach((cell, i) => {
      ctx.beginPath();
      ctx.arc(cell.x, cell.y, r, 0, Math.PI * 2);
      if (asRings) ctx.stroke();
      else ctx.fill();
      if (style.showLabels) {
        ctx.fillStyle = color;
        ctx.fillText(String(i + 1), cell.x + r + 2, cell.y);
      }
    });
  }
}
