/**
 * channelExtract.js — Pull a single channel out of a decoded image. Pure,
 * DOM-free functions — the data-shaping half of the loading pipeline.
 *
 * Each channel file is decoded to RGBA (imageDecoder.js) and then reduced here
 * to one independent grayscale intensity matrix, ready for the detector. (The
 * AOI mask comes from a separate ImageJ .roi file — see core/roiParser.js +
 * core/rasterize.js — not from an image, so there's no mask parser here.)
 */

/**
 * Extract one channel from an RGBA image as a Float32 intensity matrix.
 *
 * Channel files are typically single-channel captures saved as grayscale (R=G=B)
 * or tinted to their colour — taking the named component covers both: a grayscale
 * file yields its intensity, a tinted file yields just that dye's signal. Pass
 * 'luma' for a true grayscale image to use the perceptual luminance instead,
 * which is robust even if the file carries a slight colour cast.
 *
 * @param {ImageData} imageData
 * @param {0|1|2|'luma'} component - RGBA byte offset (R=0, G=1, B=2) or 'luma'
 * @returns {Float32Array} length = width * height, values 0–255
 */
export function extractChannel(imageData, component) {
  const { width, height, data } = imageData;
  const n = width * height;
  const out = new Float32Array(n);
  if (component === 'luma') {
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      out[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    }
  } else {
    for (let i = 0; i < n; i++) {
      out[i] = data[i * 4 + component];
    }
  }
  return out;
}

/** Fraction (0–1) of a binary AOI mask that is inside — for UI feedback. */
export function maskCoverage(mask) {
  let inside = 0;
  for (let i = 0; i < mask.length; i++) inside += mask[i];
  return mask.length ? inside / mask.length : 0;
}

/**
 * Check two images share dimensions.
 * @returns {boolean} true when width AND height match
 */
export function sameSize(a, b) {
  return a.width === b.width && a.height === b.height;
}
