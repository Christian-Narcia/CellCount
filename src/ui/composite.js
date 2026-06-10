/**
 * composite.js — Merge the loaded channel matrices into RGBA images.
 *
 * Two products, deliberately separate:
 *
 * buildComposite() builds the DISPLAY image only. It honours each channel's
 * colour, opacity, and visibility plus a global blend mode (additive or opacity),
 * using pixel-level math (no CSS opacity) so the painted pixels are physically
 * correct. Detection is entirely separate — the worker detects each channel from
 * its own grayscale matrix — so nothing here ever affects the cell counts.
 *
 * Channels that aren't loaded contribute nothing.
 */

import { CHANNELS } from '../config.js';

/** Default per-channel colours, parsed once from config. */
const DEFAULT_COLORS = Object.freeze(
  Object.fromEntries(CHANNELS.map((c) => [c.key, hexToRgb(c.defaultColor)]))
);

/**
 * @typedef {Object} ChannelStyle
 * @property {string} color   - '#rrggbb' tint
 * @property {number} opacity - 0–100
 * @property {boolean} visible
 */

/**
 * Build the colour-composited DISPLAY image.
 *
 * @param {number} width
 * @param {number} height
 * @param {Record<string, Float32Array|null>} channels - grayscale matrices (0–255)
 * @param {{ styles?: Record<string, ChannelStyle>, mode?: 'additive'|'opacity' }} [settings]
 * @returns {ImageData}
 */
export function buildComposite(width, height, channels, settings = {}) {
  const { styles = {}, mode = 'additive' } = settings;
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);

  // Resolve the visible, loaded channels (in declaration order) to draw params.
  const active = CHANNELS.filter((c) => channels[c.key] && (styles[c.key] ? styles[c.key].visible : true)).map(
    (c) => {
      const s = styles[c.key] || {};
      return {
        data: channels[c.key],
        color: s.color ? hexToRgb(s.color) : DEFAULT_COLORS[c.key],
        alpha: (s.opacity == null ? 100 : s.opacity) / 100,
      };
    }
  );

  for (let i = 0; i < n; i++) {
    let r = 0;
    let g = 0;
    let b = 0;
    if (mode === 'opacity') {
      // Standard alpha compositing, channels painted bottom→top over black.
      for (const { data, color, alpha } of active) {
        const v = data[i] / 255; // intensity scales the tint toward black
        r = color.r * v * alpha + r * (1 - alpha);
        g = color.g * v * alpha + g * (1 - alpha);
        b = color.b * v * alpha + b * (1 - alpha);
      }
    } else {
      // Additive merge — co-located signal brightens toward the mixed colour.
      for (const { data, color, alpha } of active) {
        const v = data[i] * alpha;
        r += (v * color.r) / 255;
        g += (v * color.g) / 255;
        b += (v * color.b) / 255;
      }
    }
    const j = i * 4;
    out[j] = r; // Uint8Clamped rounds + clamps to 0–255
    out[j + 1] = g;
    out[j + 2] = b;
    out[j + 3] = 255;
  }
  return new ImageData(out, width, height);
}

/** '#rrggbb' → { r, g, b } (0–255). */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
