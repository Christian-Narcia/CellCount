/**
 * png.js — Flatten the canvas stack to a single PNG and download it (Phase 11).
 *
 * The on-screen view is three aligned, same-size canvases (composite → AOI
 * boundary → marker overlay). To export the view we draw them onto one offscreen
 * canvas at image resolution, in stacking order, then toBlob() → object-URL
 * download — 100% client-side, like the CSV export.
 *
 * SecurityError note: toBlob() throws if any canvas was "tainted" by cross-origin
 * image data. All pixels here come from local File objects (no remote URLs are
 * ever drawn), so the canvases stay clean and export succeeds.
 */

/**
 * Composite the given canvases (bottom→top) onto a new offscreen canvas at the
 * first canvas's resolution.
 * @param {HTMLCanvasElement[]} canvases - stacking order, all the same size
 * @returns {HTMLCanvasElement}
 */
export function flattenLayers(canvases) {
  const [first] = canvases;
  const out = document.createElement('canvas');
  out.width = first.width;
  out.height = first.height;
  const ctx = out.getContext('2d');
  for (const c of canvases) ctx.drawImage(c, 0, 0);
  return out;
}

/**
 * Derive the export file name from a SOURCE image file name — the DAPI channel's
 * upload (config EXPORT_NAME_CHANNEL), so the exported view lands beside the image
 * it was counted from ("slide7_DAPI.tif" → "slide7_DAPI.png").
 *
 * The extension is replaced rather than appended (a ".tif" download named ".png"
 * confuses both the OS and the user), and path separators are stripped — some
 * browsers report a relative path for a folder-dropped file, and a "/" in a
 * download name is silently rejected.
 *
 * @param {string|null|undefined} sourceName - e.g. the loaded DAPI file's name
 * @param {string} [fallback] - used when no source file name is available
 * @returns {string} a .png file name
 */
export function pngNameFrom(sourceName, fallback = 'cell-counts.png') {
  const base = String(sourceName == null ? '' : sourceName)
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '') // drop the extension (.tif/.tiff/.png/.jpg…)
    .trim();
  return base ? `${base}.png` : fallback;
}

/**
 * Flatten the stack and trigger a browser download of the result as a PNG.
 * @param {HTMLCanvasElement[]} canvases - stacking order (base → aoi → overlay)
 * @param {string} [filename]
 */
export function downloadPng(canvases, filename = 'cell-counts.png') {
  const out = flattenLayers(canvases);
  out.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
