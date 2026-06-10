/**
 * imageDecoder.js — File → ImageData.
 *
 * Two paths:
 *   • TIFF (.tif/.tiff)  → decoded with UTIF (handles 8-bit and 16-bit).
 *   • PNG/JPG            → decoded by the browser via createImageBitmap.
 *
 * UTIF is loaded as a global (see the <script> tag in index.html). We read it
 * lazily so this module doesn't hard-crash if TIFF support isn't needed.
 */

import { isTiff } from './fileLoader.js';

/**
 * Decode a File into an ImageData (RGBA).
 * @param {File} file
 * @returns {Promise<ImageData>}
 */
export async function decodeFile(file) {
  return isTiff(file) ? decodeTiff(file) : decodeStandard(file);
}

async function decodeTiff(file) {
  const UTIF = globalThis.UTIF;
  if (!UTIF) {
    throw new Error('UTIF library not loaded — cannot decode TIFF files.');
  }
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw new Error('No images found in TIFF.');

  const page = ifds[0]; // first page only for now
  UTIF.decodeImage(buffer, page);
  const rgba = UTIF.toRGBA8(page); // Uint8Array, normalized to display range
  return new ImageData(new Uint8ClampedArray(rgba.buffer), page.width, page.height);
}

async function decodeStandard(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
