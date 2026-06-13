/**
 * config.js — Single source of truth for all tunable defaults and constants.
 *
 * Keep ALL magic numbers here. UI, algorithm, and worker read from this file so
 * that changing a default never requires hunting through the codebase.
 */

/** Tool version, shown in the panel footer. Bump on release. */
export const APP_VERSION = '0.1.0';

/** Detection parameters (also the initial slider values). */
export const DEFAULT_PARAMS = Object.freeze({
  /** Expected cell radius in pixels. Drives the Gaussian sigma. */
  R: 10,
  /** Minimum allowed separation between two cell centers, in pixels. */
  Dmin: 20,
  /**
   * Threshold value. Its RANGE and MEANING depend on `thresholdMode`:
   *   • 'log'       → a RELATIVE LoG threshold on the Fiji/ImageJ ITCN 0.0–10.0
   *                   scale (internally value/10 = fraction of the peak response;
   *                   default). Bit-depth independent — identical on 8- and 16-bit.
   *   • 'intensity' → an ABSOLUTE pixel value 0–255.
   * See THRESHOLD_MODES below + algorithm/threshold.js. The T slider re-ranges to
   * match the selected mode (controls.js), so 2.0 here is "20% of peak response".
   */
  T: 2,
  /** How T is interpreted — see THRESHOLD_MODES / algorithm/threshold.js. */
  thresholdMode: 'log',
  /**
   * Fluorescent mode: bright cells on dark background (no inversion needed).
   * Defaults ON — this is a fluorescence tool (R/G/B channels, co-localization),
   * so the out-of-box image is bright-cells-on-dark. Turn OFF for brightfield
   * (dark cells on bright bg), which inverts before detection. See detect.js.
   */
  fluorescent: true,
  /**
   * Co-localization radius (px): two cells in different channels co-localize if
   * within this distance. Suggested ~1 cell diameter; defaults to R. Changing it
   * re-runs the co-localization pass only (not detection). See colocalize.js.
   */
  coR: 10,
});

/**
 * Channel inputs — drives the multi-channel loader (Phase 2). Each channel is a
 * SEPARATE image file; `component` is what gets extracted from that file — an
 * RGBA byte index (R=0, G=1, B=2) or 'luma' for a grayscale image — and
 * `defaultColor` is the colour it's composited with for display until
 * per-channel colour pickers land (Phase 4). `shortcutKey` is the keyboard key
 * that toggles this channel's visibility (Phase 11; ui/shortcuts.js).
 */
export const CHANNELS = Object.freeze([
  { key: 'r', label: 'Red channel', component: 0, defaultColor: '#ff0000', coloc: true, shortcutKey: 'r' },
  { key: 'g', label: 'Green channel', component: 1, defaultColor: '#00ff00', coloc: true, shortcutKey: 'g' },
  { key: 'b', label: 'Blue channel', component: 2, defaultColor: '#0000ff', coloc: true, shortcutKey: 'b' },
  // Gray is a reference/brightfield layer — detected + counted, but excluded from
  // co-localization combinations (set coloc:true if you want it to participate).
  // Its visibility shortcut is Y (Gray's slot is the 4th; R/G/B are taken).
  { key: 'gray', label: 'Gray channel', component: 'luma', defaultColor: '#ffffff', coloc: true, shortcutKey: 'y' },
]);

/**
 * Region-of-interest input — an ImageJ .roi polygon file (parsed by
 * core/roiParser.js and rasterised to a binary mask). Replaces the old image-mask
 * concept; `accept` restricts the slot to .roi files.
 */
export const ROI_INPUT = Object.freeze({
  key: 'roi',
  label: 'Region of interest (.roi)',
  accept: ['.roi'],
});

/**
 * Compositing defaults + modes (Phase 4). These drive the DISPLAY only — colour,
 * opacity, visibility, and blend mode never affect detection (which runs on a
 * style-independent source). See composite.js.
 */
export const COMPOSITE = Object.freeze({
  /** Initial per-channel opacity, percent. */
  defaultOpacity: 100,
  /** Initial blend mode. */
  defaultMode: 'additive',
  modes: [
    { value: 'additive', label: 'Additive (fluorescence)' },
    { value: 'opacity', label: 'Opacity blend' },
  ],
});

/**
 * Threshold modes — drive BOTH the "Threshold mode" dropdown AND the T slider's
 * range/scale, because T means a genuinely different thing in each mode:
 *
 *   • 'log'       T is a RELATIVE LoG-strength threshold on the Fiji/ImageJ ITCN
 *                 0.0–10.0 decimal scale (so ITCN users see the number they know).
 *                 Internally T / `scale` (T/10) is the fraction of the strongest
 *                 LoG blob response a candidate must reach — e.g. 2.0 keeps peaks
 *                 ≥ 20% of the peak strength. Independent of bit depth — the same
 *                 T behaves identically on 8-bit and 16-bit images.
 *   • 'intensity' T is an ABSOLUTE pixel value (0–255). A candidate is kept only
 *                 if its underlying intensity ≥ T. (The decoder normalises all
 *                 images — including 16-bit TIFFs — to a 0–255 display range, so
 *                 this single range is correct regardless of source bit depth.)
 *
 * `T` is the slider config (min/max/step/unit) to swap in when that mode is
 * selected; `default` seeds a sensible value when the value can't be carried over.
 * `scale` is the divisor that converts the slider value to the algorithm's native
 * unit (10 maps the Fiji 0–10 'log' scale to a 0–1 fraction; 1 leaves 'intensity'
 * as raw pixels). Switching modes rescales the current knob to the same RELATIVE
 * position in the new range (controls.js), so the slider never jumps to an extreme.
 */
export const THRESHOLD_MODES = Object.freeze([
  {
    value: 'log',
    label: 'LoG strength (Fiji 0–10)',
    T: { min: 0, max: 10, step: 0.1, unit: '', default: 2 },
    scale: 10,
  },
  {
    value: 'intensity',
    label: 'Pixel intensity (absolute 0–255)',
    T: { min: 0, max: 255, step: 1, unit: '', default: 30 },
    scale: 1,
  },
]);

/** The T slider range/scale for a given threshold mode (falls back to the first). */
export function thresholdRange(mode) {
  return (THRESHOLD_MODES.find((m) => m.value === mode) || THRESHOLD_MODES[0]).T;
}

/**
 * The divisor that converts a mode's slider value to the algorithm's native unit:
 * 10 for the Fiji-style 'log' scale (→ a 0–1 fraction of the peak), 1 for the
 * absolute 'intensity' mode. Used by detect.js when calling applyThreshold.
 */
export function thresholdScale(mode) {
  const m = THRESHOLD_MODES.find((x) => x.value === mode) || THRESHOLD_MODES[0];
  return m.scale ?? 1;
}

/** T slider range for the out-of-box mode — keeps SLIDERS in sync with DEFAULT_PARAMS. */
const T_RANGE = thresholdRange(DEFAULT_PARAMS.thresholdMode);

/**
 * UI slider definitions — drives control-panel generation. `recompute` says what
 * a change triggers: 'detect' re-runs the worker; 'coloc' only re-runs the
 * (cheap) co-localization pass on the existing per-channel results.
 *
 * `perChannel: true` marks a slider that can be tuned independently per channel
 * (Phase 9). When the channels are LINKED (the default), one shared value drives
 * every channel; UNLINKED, each channel gets its own copy of these sliders. Flip
 * the flag to opt a parameter in/out of per-channel tuning — controls.js, the
 * worker, and main.js all derive their behaviour from it. Non-per-channel
 * sliders (e.g. Co-R) are always global.
 */
export const SLIDERS = Object.freeze([
  { key: 'R', label: 'Cell radius (R)', min: 1, max: 60, step: 1, unit: 'px', recompute: 'detect', perChannel: true },
  { key: 'Dmin', label: 'Min separation (Dmin)', min: 1, max: 120, step: 1, unit: 'px', recompute: 'detect', perChannel: true },
  // Range/scale is mode-dependent — seeded from the default mode here and
  // re-ranged live when the threshold mode changes (THRESHOLD_MODES / controls.js).
  { key: 'T', label: 'Threshold (T)', min: T_RANGE.min, max: T_RANGE.max, step: T_RANGE.step, unit: T_RANGE.unit, recompute: 'detect', perChannel: true },
  { key: 'coR', label: 'Co-loc radius (Co-R)', min: 1, max: 120, step: 1, unit: 'px', recompute: 'coloc' },
]);

/**
 * Whether per-channel detection sliders start LINKED (one shared value for every
 * channel). The link toggle in the control panel flips this at runtime; this is
 * just the initial state. See controls.js.
 */
export const LINK_DEFAULT = true;

/** Dropdown definitions — also generated into the control panel. */
export const SELECTS = Object.freeze([
  {
    key: 'thresholdMode',
    label: 'Threshold mode',
    // Options are derived from THRESHOLD_MODES so the dropdown, the T slider's
    // range, and the algorithm all read from one source of truth.
    options: THRESHOLD_MODES.map((m) => ({ value: m.value, label: m.label })),
    // Selecting an option also re-ranges the T slider(s) — see controls.js.
    reranges: 'T',
  },
]);

/** Checkbox definitions — generated into the control panel. */
export const TOGGLES = Object.freeze([
  { key: 'fluorescent', label: 'Fluorescent mode' },
]);

/** Accepted file extensions / MIME hints for the loader. */
export const ACCEPTED_TYPES = Object.freeze({
  extensions: ['.tif', '.tiff', '.png', '.jpg', '.jpeg'],
  tiff: ['.tif', '.tiff'],
});

/**
 * Overlay marker appearance. Per-channel cells are drawn as a small filled dot of
 * fixed radius `dotRadius` (image px, INDEPENDENT of the detection radius R) so
 * markers stay readable on dense images. Co-localization dots are sized from Co-R
 * (see overlay.js) and kept larger than `dotRadius` so the two are distinguishable.
 */
export const MARKER_STYLE = Object.freeze({
  color: '#00e5ff',
  /** Fixed per-channel dot radius in image px (not tied to R). */
  dotRadius: 1.5,
  lineWidth: 1.5,
  showLabels: true,
  labelColor: '#ffffff',
  labelFont: '11px system-ui, sans-serif',
});

/**
 * Per-channel marker SHAPE choice (Phase 11) — a DISPLAY-only toggle, never a
 * re-detection. Two looks for the per-channel detection markers:
 *   • 'dots'  — a small filled dot of fixed radius (MARKER_STYLE.dotRadius,
 *               independent of R). Less visually noisy on dense images (default).
 *   • 'rings' — an unfilled circle at the channel's own detected R, so the user
 *               can see the detection radius relative to each cell (original look).
 * Co-localization dots and hand-placed (manual) squares are UNAFFECTED — they are
 * always their own shape regardless of this setting. See ui/markerStyle.js +
 * overlay.js drawMarkerGroups().
 */
export const MARKER_STYLES = Object.freeze({
  default: 'dots',
  options: [
    { value: 'dots', label: 'Dots' },
    { value: 'rings', label: 'Rings' },
  ],
});

/**
 * Manual markers (Phase 11) — dots the user places by hand. Each is CHANNEL-
 * ATTRIBUTED: the user picks which channel a new marker belongs to (ui/
 * manualMarkers.js), so it counts toward that channel's total and is exported as
 * that channel id — exactly as if it were a detected cell. They are never part of
 * detection or co-localization. Drawn in the channel's marker colour as a small
 * outlined square (overlay.js 'manual' kind) so they stay distinct from the round
 * detection dots and hide with the channel.
 */

/**
 * AOI boundary appearance — the dashed edge of the loaded mask. Amber so it
 * stands out against the cyan markers. `dash` is the on/off cycle length (px)
 * used to stipple the 1px boundary so it reads as a dashed outline.
 */
export const AOI_STYLE = Object.freeze({
  color: '#ffcc00',
  dash: 4,
});

/**
 * Relationship helpers — derived defaults the algorithm uses.
 * Centralized so the "sigma = R / sqrt(2)" rule lives in exactly one place.
 */
export const DERIVE = Object.freeze({
  /** Gaussian sigma so the LoG zero-crossing lands at the cell radius. */
  sigma: (R) => R / Math.SQRT2,
});
