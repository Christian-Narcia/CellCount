/**
 * csv.js — Build and download a CSV of detected cells, 100% client-side.
 *
 * Uses Blob + object URL — no server round-trip, nothing leaves the browser.
 *
 * The file has two parts (Phase 10):
 *   1. A SUMMARY BLOCK of `#`-prefixed comment lines at the top — per-channel and
 *      per-combination totals, the AOI pixel area, and the colour assigned to each
 *      channel (for reproducibility). `#` lets spreadsheet/pandas importers skip it.
 *   2. The PER-CELL TABLE — one row per detected cell across all channels, with
 *      columns: cell_id, channel, x, y, intensity, inside_aoi, colocalized_with.
 *
 * The per-channel lists are the EFFECTIVE cells (main.js effectiveResults): detected
 * cells minus any the user excluded, PLUS hand-placed manual markers, merged and
 * tagged. So a manual marker is just another cell in its channel — counted in the
 * summary and co-localized like any cell. Per cell: DETECTED cells carry a numeric
 * `intensity` and `inside_aoi=true` (detection is AOI-masked); MANUAL cells carry
 * `intensity=null` (blank in the CSV) and an `inside` flag computed from the mask
 * (they can land outside the ROI). `colocalized_with` is the `+`-joined list of OTHER
 * channels co-localized within Co-R (symmetric — see colocalize.js colocalizationByCell).
 */

import { colocalizationByCell } from '../algorithm/colocalize.js';

/**
 * @param {Record<string, Array<{x:number,y:number,intensity:number|null,inside?:boolean}>>} perChannel
 *        EFFECTIVE cells per channel (detected−excluded + manual). `intensity` is
 *        null for manual cells; `inside` defaults to true (detected cells).
 * @param {Object} [options]
 * @param {Record<string, Array>} [options.coloc] - combo → cells (for the summary totals)
 * @param {string[]} [options.colocKeys] - eligible channel keys for co-localization
 * @param {number} [options.coR] - co-localization radius (px)
 * @param {Record<string, {color:string}>} [options.styles] - per-channel display styles (colours)
 * @param {number|null} [options.aoiArea] - AOI area in pixels (mask 1-count, or full image)
 * @returns {string} CSV text (summary block + header + rows)
 */
export function resultsToCsv(perChannel, options = {}) {
  const { coloc = {}, colocKeys = [], coR = 0, styles = {}, aoiArea = null } = options;
  const channels = Object.keys(perChannel);

  // ---- Summary block (commented so the data table stays parseable) ----
  const summary = ['# ITCN Cell Counter — results', `# Generated: ${new Date().toISOString()}`];
  if (aoiArea != null) summary.push(`# AOI area (px): ${aoiArea}`);
  summary.push('#', '# Channel,Color,Count');
  for (const ch of channels) {
    const color = (styles[ch] && styles[ch].color) || '';
    summary.push(`# ${ch},${color},${perChannel[ch].length}`);
  }
  const comboKeys = Object.keys(coloc);
  if (comboKeys.length) {
    summary.push('#', '# Combination,Count');
    for (const combo of comboKeys) summary.push(`# ${combo},${coloc[combo].length}`);
  }
  summary.push('#');

  // ---- Per-cell table ----
  const byCell = colocalizationByCell(perChannel, colocKeys, coR);
  const header = 'cell_id,channel,x,y,intensity,inside_aoi,colocalized_with';
  const rows = [];
  let id = 1;
  for (const ch of channels) {
    const cellColoc = byCell[ch] || [];
    perChannel[ch].forEach((c, i) => {
      const colocWith = (cellColoc[i] || []).join('+');
      const intensity = c.intensity == null ? '' : Math.round(c.intensity);
      const inside = c.inside == null ? true : c.inside;
      rows.push(`${id++},${ch},${c.x},${c.y},${intensity},${inside},${colocWith}`);
    });
  }

  return [...summary, header, ...rows].join('\n');
}

/**
 * Trigger a browser download of the per-channel results as a CSV file.
 * @param {Record<string, Array>} perChannel
 * @param {Object} [options] - see resultsToCsv
 * @param {string} [filename]
 */
export function downloadCsv(perChannel, options = {}, filename = 'cell-counts.csv') {
  const blob = new Blob([resultsToCsv(perChannel, options)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
