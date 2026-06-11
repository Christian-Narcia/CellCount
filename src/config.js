/**
 * config.js — Single source of truth for all tunable defaults and constants.
 *
 * Keep ALL magic numbers here. UI, algorithm, and worker read from this file so
 * that changing a default never requires hunting through the codebase.
 */

/** Detection parameters (also the initial slider values). */
export const DEFAULT_PARAMS = Object.freeze({
  /** Expected cell radius in pixels. Drives the Gaussian sigma. */
  R: 10,
  /** Minimum allowed separation between two cell centers, in pixels. */
  Dmin: 20,
  /** Threshold value (0–255). Meaning depends on `thresholdMode`. */
  T: 30,
  /** How T is interpreted — see SELECTS / algorithm/threshold.js. */
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
 * per-channel colour pickers land (Phase 4).
 */
export const CHANNELS = Object.freeze([
  { key: 'r', label: 'Red channel', component: 0, defaultColor: '#ff0000', coloc: true },
  { key: 'g', label: 'Green channel', component: 1, defaultColor: '#00ff00', coloc: true },
  { key: 'b', label: 'Blue channel', component: 2, defaultColor: '#0000ff', coloc: true },
  // Gray is a reference/brightfield layer — detected + counted, but excluded from
  // co-localization combinations (set coloc:true if you want it to participate).
  { key: 'gray', label: 'Gray channel', component: 'luma', defaultColor: '#ffffff', coloc: true },
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
  { key: 'T', label: 'Threshold (T)', min: 0, max: 255, step: 1, unit: '', recompute: 'detect', perChannel: true },
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
    options: [
      { value: 'log', label: 'LoG strength' },
      { value: 'intensity', label: 'Pixel intensity (0–255)' },
    ],
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

/** Overlay marker appearance. The ring radius is the detected cell radius R. */
export const MARKER_STYLE = Object.freeze({
  color: '#00e5ff',
  lineWidth: 1.5,
  showLabels: true,
  labelColor: '#ffffff',
  labelFont: '11px system-ui, sans-serif',
});

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
