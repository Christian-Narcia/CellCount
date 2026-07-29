/**
 * config.js — Single source of truth for all tunable defaults and constants.
 *
 * Keep ALL magic numbers here. UI, algorithm, and worker read from this file so
 * that changing a default never requires hunting through the codebase.
 */

/**
 * Tool version, shown in the panel footer.
 *
 * NOT the release switch — bump VERSION in service-worker.js instead; that is what
 * ships a new build and what the footer ultimately displays (main.js overwrites the
 * footer with the version reported by the worker actually serving the page). This
 * constant is only the value shown before that round-trip finishes, and the fallback
 * where there is no service worker at all (opened over file://). Keeping it in step
 * with the worker is cosmetic, not functional.
 */
export const APP_VERSION = '0.1.09';

/**
 * Detection parameters (also the initial slider values).
 *
 * These are ITCN's own defaults, translated into this tool's parameter names. The
 * ITCN plugin ships Width=20, Minimum Distance=10, Threshold=0.2 — and because our
 * R is a RADIUS where ITCN's Width is a DIAMETER (R = Width/2), that lands on
 * R=10, Dmin=10, T=0.2. Loading an image and pressing go should now give the same
 * count Fiji gives with its own defaults.
 */
export const DEFAULT_PARAMS = Object.freeze({
  /**
   * Expected cell RADIUS in pixels. ITCN's "Width" field is the DIAMETER, so
   * Width = 2R — a Fiji user who types Width=20 uses R=10 here. R drives the
   * sigma, the kernel size, and the local-max radius (see DERIVE below).
   */
  R: 10,
  /**
   * Minimum allowed separation between two cell centers, in pixels — ITCN's
   * "Minimum Distance". ITCN defaults it to Width/2, i.e. exactly R, and its
   * dialog re-derives it from Width every time Width changes.
   */
  Dmin: 10,
  /**
   * Threshold value. Its RANGE and MEANING depend on `thresholdMode`:
   *   • 'itcn'      → an ABSOLUTE bar on the LoG blob response, on ITCN's own
   *                   0.0–10.0 scale. Fiji's default is 0.2. NOT a fraction of the
   *                   image's strongest blob — see THRESHOLD_MODES.
   *   • 'intensity' → an ABSOLUTE pixel value 0–255 (not an ITCN feature).
   * The T slider re-ranges to match the selected mode (controls.js).
   */
  T: 0.2,
  /** How T is interpreted — see THRESHOLD_MODES / algorithm/detect.js. */
  thresholdMode: 'itcn',
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
 *
 * PER-CHANNEL DETECTION DEFAULTS. `params` seeds this channel's OWN R/Dmin/T
 * (the per-channel detection sliders; keys must match the `perChannel` SLIDERS).
 * Every channel is tuned independently — there is no "link channels" mode — so
 * give each the starting values that suit its stain. Anything omitted here falls
 * back to DEFAULT_PARAMS. (Threshold mode and fluorescent stay global.)
 *
 * `exportName: true` marks the ONE channel whose uploaded file name is reused for
 * the exported PNG (DAPI — the nuclear stain, so the export sits next to the image
 * the count is keyed to). See EXPORT_NAME_CHANNEL / export/png.js.
 */
export const CHANNELS = Object.freeze([
  { key: 'r', label: 'EdU channel', short: 'EdU', component: 0, defaultColor: '#ff0000', coloc: true, shortcutKey: 'r', params: { R: 5, Dmin: 9, T: 0.5 } },
  { key: 'g', label: 'GFP channel', short: 'GFP', component: 1, defaultColor: '#00ff00', coloc: true, shortcutKey: 'g', params: { R: 6, Dmin: 10, T: 1.2 } },
  { key: 'b', label: 'DAPI channel', short: 'DAPI', component: 2, defaultColor: '#0000ff', coloc: true, shortcutKey: 'b', exportName: true, params: { R: 7, Dmin: 2, T: 0.4 } },
  // The luma channel is a reference/brightfield layer — detected + counted, but excluded from
  // co-localization combinations (set coloc:true if you want it to participate).
  // Its visibility shortcut is Y (its slot is the 4th; R/G/B are taken).
  { key: 'gray', label: 'CC1 channel', short: 'CC1', component: 'luma', defaultColor: '#ffffff', coloc: true, shortcutKey: 'y', params: { R: 6, Dmin: 9, T: 0.4 } },
]);

/**
 * The channel whose uploaded file name names the exported PNG (the `exportName`
 * flag above — DAPI). null if no channel is flagged, in which case the export falls
 * back to its default name. Only one channel should carry the flag; the first wins.
 */
export const EXPORT_NAME_CHANNEL = (CHANNELS.find((c) => c.exportName) || {}).key || null;

/**
 * Display names for a channel key. Internal keys stay r/g/b/gray (they index the
 * RGBA component and the worker payload); the display name is what the UI and the
 * results table show — e.g. 'gray' → 'CC1'.
 *
 * MUTABLE at runtime: the per-channel "edit" button (ui/controls.js) renames a
 * channel via setChannelName(). Everything that shows a channel name reads it
 * through channelName()/comboName() live, so a rename flows straight to the count
 * chips and the "View results" table with no other wiring. Seeded from each
 * channel's `short`.
 */
const channelDisplayNames = Object.fromEntries(CHANNELS.map((c) => [c.key, c.short]));

/** Short display name for a channel key ('gray' → 'CC1'). */
export const channelName = (key) => channelDisplayNames[key] || String(key).toUpperCase();

/**
 * Rename a channel at runtime (the per-channel edit button). A blank/whitespace
 * name is ignored so a channel can never lose its label. Returns the name now in
 * effect for that key.
 */
export function setChannelName(key, name) {
  const trimmed = String(name == null ? '' : name).trim();
  if (trimmed) channelDisplayNames[key] = trimmed;
  return channelName(key);
}

/** Display name for a co-localization combo key ('r+gray' → 'EdU+CC1'). */
export const comboName = (combo) => String(combo).split('+').map(channelName).join('+');

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
 * range/step, because T means a genuinely different thing in each mode:
 *
 *   • 'itcn'      T is ITCN's own threshold: an ABSOLUTE bar on the LoG blob
 *                 response. The response is in units of 8-bit intensity (the
 *                 kernel is normalized by the sum of its Gaussian — see
 *                 algorithm/itcnKernel.js), so T is a minimum blob CONTRAST, not a
 *                 percentage of anything. ITCN's dialog exposes exactly this range
 *                 — 0.0–10.0, step 0.1 — and defaults to 0.2. Type the number you
 *                 would type in Fiji.
 *
 *                 ⚠ It is NOT a fraction of the strongest blob in the image. An
 *                 earlier build divided by the image maximum and called that "the
 *                 Fiji 0–10 scale"; that misread ITCN's `thresPrecision = 10`
 *                 constant, which is only the integer quantization of the plugin's
 *                 threshold SCROLLBAR (scroll value = 10 x threshold), not a user-
 *                 facing scale. Normalizing by the image max also couples every
 *                 cell to the brightest object in frame: one saturated speck raises
 *                 the bar and silently drops real, dimmer nuclei.
 *
 *   • 'intensity' T is an ABSOLUTE pixel value (0–255). A candidate is kept only
 *                 if its underlying intensity ≥ T. NOT an ITCN feature — a
 *                 convenience gate this tool adds. (The decoder normalises all
 *                 images, including 16-bit TIFFs, to a 0–255 display range, so this
 *                 range is correct regardless of source bit depth.)
 *
 * `T` is the slider config (min/max/step/unit) to swap in when that mode is
 * selected; `default` seeds a sensible value when the value can't be carried over.
 * Switching modes rescales the current knob to the same RELATIVE position in the
 * new range (controls.js), so the slider never jumps to an extreme.
 */
export const THRESHOLD_MODES = Object.freeze([
  {
    value: 'itcn',
    label: 'LoG response (ITCN, absolute)',
    T: { min: 0, max: 10, step: 0.1, unit: '', default: 0.2 },
  },
  {
    value: 'intensity',
    label: 'Pixel intensity (absolute 0–255)',
    T: { min: 0, max: 255, step: 1, unit: '', default: 30 },
  },
]);

/** The T slider range/scale for a given threshold mode (falls back to the first). */
export function thresholdRange(mode) {
  return (THRESHOLD_MODES.find((m) => m.value === mode) || THRESHOLD_MODES[0]).T;
}

/** T slider range for the out-of-box mode — keeps SLIDERS in sync with DEFAULT_PARAMS. */
const T_RANGE = thresholdRange(DEFAULT_PARAMS.thresholdMode);

/**
 * UI slider definitions — drives control-panel generation. `recompute` says what
 * a change triggers: 'detect' re-runs the worker; 'coloc' only re-runs the
 * (cheap) co-localization pass on the existing per-channel results.
 *
 * `perChannel: true` marks a slider that is tuned independently per channel
 * (Phase 9). Each channel always gets its own copy of these sliders, seeded from
 * that channel's CHANNELS[*].params; there is no shared/linked mode. Flip the
 * flag to opt a parameter in/out of per-channel tuning — controls.js, the worker,
 * and main.js all derive their behaviour from it. Non-per-channel sliders
 * (e.g. Co-R) are always global.
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
 * Whether each channel's per-channel detection sliders (R/Dmin/T) start LOCKED.
 * A lock button in the top-right of every channel group flips this at runtime;
 * this is just the initial state. Locking disables that group's sliders so the
 * carefully-set defaults can't be nudged by accident — a purely UI guard, it
 * never changes the values themselves. See controls.js.
 */
export const LOCK_DEFAULT = true;

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
  dotRadius: 0.75,
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
 * Number-label toggle — a DISPLAY-only switch for the numeric labels drawn next to
 * the detection / manual markers (overlay.js reads MARKER_STYLE.showLabels). Hiding
 * them leaves every marker exactly as it was; it only removes the numbers, so dense
 * images stay readable. `shortcutKey` is the keyboard key that flips it, and it is
 * shown in the button's own name. See ui/labelToggle.js.
 */
export const MARKER_LABELS = Object.freeze({
  /** Labels start visible. */
  default: true,
  shortcutKey: 'h',
});

/**
 * Per-channel MARKER visibility toggle — a DISPLAY-only switch (sibling of the
 * "Hide numbers" toggle above) for the per-channel detection markers themselves
 * (the dots OR rings, whichever the marker-style toggle currently shows). Hiding
 * them clears the detection markers + their number labels from the overlay so the
 * raw composite can be inspected; co-localization dots and hand-placed manual
 * squares are UNAFFECTED. `shortcutKey` flips it and is shown in the button's name.
 * See ui/markerToggle.js.
 */
export const MARKER_DOTS = Object.freeze({
  /** Markers start visible. */
  default: true,
  shortcutKey: 'd',
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
 * Relationship helpers — everything the detector derives from the cell radius R.
 *
 * These are ITCN's constants, transcribed from `Itcn_.java`, not chosen by us. They
 * all key off ITCN's "Width" field, which is the nucleus DIAMETER — so width = 2R.
 * Centralized here so the mapping lives in exactly one place.
 *
 * ⚠ Do NOT "fix" sigma to R/sqrt(2). That is the textbook Lindeberg scale (it puts
 * the LoG zero-crossing on the cell radius) and it is a perfectly defensible choice
 * — but it is not what ITCN does, and this tool's contract is to reproduce ITCN's
 * counts. ITCN uses sigma = (width - 1)/3, which for R=10 is 6.33 rather than 7.07.
 * An earlier build used R/sqrt(2) and over-smoothed by ~12%.
 */
export const DERIVE = Object.freeze({
  /** ITCN's "Width" (nucleus diameter, px) from our radius R. */
  filterWidth: (R) => 2 * R,
  /** ITCN's Gaussian sigma: (width - 1) / 3. */
  sigma: (R) => (2 * R - 1) / 3,
  /** Local-max verification radius: floor(width / 3). */
  epsilon: (R) => Math.floor((2 * R) / 3),
  /** Image-edge exclusion, px. ITCN skips a 1px border of the search region. */
  border: 1,
});
