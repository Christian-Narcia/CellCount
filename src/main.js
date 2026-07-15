/**
 * main.js — Application entry point.
 *
 * Thin orchestration layer: it owns the wiring between modules but contains no
 * business logic itself. Each concern (loading, decoding, channel extraction,
 * compositing, detection, rendering, export) lives in its own module and is
 * composed here.
 *
 * Data model: R/G/B/Gray channel images plus an optional ImageJ .roi region of
 * interest are loaded independently. Each channel is decoded and reduced to a
 * grayscale matrix; the ROI polygon is parsed and rasterised to a 0/1 AOI mask
 * (once, at the image size). The first CHANNEL image sets the reference dims; a
 * ROI loaded earlier is rasterised as soon as that size is known.
 *
 * Two clearly separated paths:
 *   • DISPLAY   — buildComposite() tints/blends the channels for the screen.
 *                 Colour/opacity/visibility/mode changes call recompose() only.
 *   • DETECTION — the worker detects each channel INDEPENDENTLY (mask applied
 *                 first), keyed results come back per channel. Triggered by a
 *                 channel file change or a detection-param change. Co-localization
 *                 across channels is the next phase.
 */

import {
  DEFAULT_PARAMS,
  CHANNELS,
  ROI_INPUT,
  APP_VERSION,
  MARKER_STYLE,
  channelName,
  comboName,
} from './config.js';
import { decodeFile } from './core/imageDecoder.js';
import { colocalize, colocalizationByCell, colocalizeAll } from './algorithm/colocalize.js';
import { extractChannel, maskCoverage, sameSize } from './core/channelExtract.js';
import { parseRoi, roiTypeName } from './core/roiParser.js';
import { rasterizePolygon, maskContains } from './core/rasterize.js';
import { transformPolygon, polygonCenter } from './core/roiTransform.js';
import { createHistory } from './core/history.js';
import { initChannelInputs } from './ui/channelInputs.js';
import { createRoiControls } from './ui/roiControls.js';
import { createManualMarkers } from './ui/manualMarkers.js';
import { createMarkerStyle } from './ui/markerStyle.js';
import { createLabelToggle } from './ui/labelToggle.js';
import { buildComposite } from './ui/composite.js';
import { createCanvasLayers } from './ui/canvasLayers.js';
import { drawAoiBoundary } from './ui/aoiBoundary.js';
import { createViewport } from './ui/viewport.js';
import { initControls } from './ui/controls.js';
import { drawMarkerGroups } from './ui/overlay.js';
import { createResultsModal } from './ui/resultsTable.js';
import { createChannelShortcuts, createEditShortcuts } from './ui/shortcuts.js';
import { downloadCsv } from './export/csv.js';
import { downloadPng } from './export/png.js';
import { registerPWA } from './pwa.js';

// ---- DOM references -------------------------------------------------------
const el = {
  channelInputs: document.getElementById('channel-inputs'),
  roiControls: document.getElementById('roi-controls'),
  manualTools: document.getElementById('manual-tools'),
  markerTools: document.getElementById('marker-tools'),
  labelTools: document.getElementById('label-tools'),
  placeholder: document.getElementById('stage-placeholder'),
  baseCanvas: document.getElementById('base-canvas'),
  aoiCanvas: document.getElementById('aoi-canvas'),
  overlayCanvas: document.getElementById('overlay-canvas'),
  controls: document.getElementById('controls'),
  count: document.getElementById('cell-count'),
  countLabel: document.getElementById('cell-count-label'),
  status: document.getElementById('status'),
  breakdown: document.getElementById('count-breakdown'),
  exportBtn: document.getElementById('export-btn'),
  exportPngBtn: document.getElementById('export-png-btn'),
  viewBtn: document.getElementById('view-btn'),
  appVersion: document.getElementById('app-version'),
  stage: document.getElementById('stage'),
  canvasWrap: document.getElementById('canvas-wrap'),
  zoomToolbar: document.getElementById('zoom-toolbar'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  zoomFit: document.getElementById('zoom-fit'),
  zoomPct: document.getElementById('zoom-pct'),
};

// ---- App state ------------------------------------------------------------
const layers = createCanvasLayers(el.baseCanvas, el.aoiCanvas, el.overlayCanvas);
const viewport = createViewport({
  container: el.stage,
  content: el.canvasWrap,
  onChange: (scale) => {
    el.zoomPct.textContent = `${Math.round(scale * 100)}%`;
  },
});
const worker = new Worker(new URL('./workers/detector.worker.js', import.meta.url), {
  type: 'module',
});
const resultsModal = createResultsModal();

// Undo stack (Phase 14A). Holds SNAPSHOTS of the user's edit state — see
// editSnapshot() below for what's in one and history.js for why snapshots rather
// than inverse commands. main.js owns it because it's the only module that can see
// all three pieces of edit state (manual markers, exclusions, the ROI transform).
const history = createHistory({
  onChange: () => {
    manualMarkers.setCanUndo(history.canUndo());
    manualMarkers.setCanRedo(history.canRedo());
  },
});

// ROI rotate/move editor. Owns the live transform; on a live edit (drag/typing)
// we re-rasterise + redraw the boundary, and on commit we re-detect (the mask
// gate changed). See ui/roiControls.js.
const roiControls = createRoiControls(el.roiControls, {
  moveTarget: el.overlayCanvas,
  getScale: () => viewport.getScale(),
  onTransform: () => {
    if (!dims || !roi) return; // editor can be open before any channel is loaded
    applyRoi();
    drawAoiBoundary(layers.aoiCtx, maskMatrix, dims.width, dims.height);
  },
  onCommit: () => {
    if (dims && roi) runDetection();
  },
  onActivate: () => manualMarkers.deactivate(), // only one canvas tool at a time
  // Undo (Phase 14B): fires once at the START of a gesture (drag / typing burst /
  // Reset), so one drag is one Ctrl+Z rather than one per animation frame.
  onBeforeTransform: () => history.push(editSnapshot()),
});

// Manual-marker tool. Owns the hand-placed, CHANNEL-ATTRIBUTED markers; on a
// change we just re-render + re-count (no detection — they're annotations). Each
// marker belongs to a channel (counts toward that channel's total). Shares the
// overlay canvas with the ROI move tool, so each switches the other off on activation.
const manualMarkers = createManualMarkers(el.manualTools, {
  canvas: el.overlayCanvas,
  channels: CHANNELS,
  onActivate: () => roiControls.deactivate(),
  onChange: () => {
    // Manual markers participate in co-localization (effectiveResults), so a
    // placement/removal must refresh the combos too — not just the markers/counts.
    recolocalize();
    renderMarkers();
    updateCounts();
    updateResultAvailability();
  },
  // Detected markers eligible to be excluded — scoped to the SELECTED channel,
  // each with its ORIGINAL lastResults index, plus the exclude/reset hooks.
  getDetectedMarkers: (activeKey) => excludableDetectedMarkers(activeKey),
  onExcludeDetected: (key, index) => excludeDetected(key, index),
  onReset: () => resetMarkerEdits(),
  // Undo (Phase 14A): the tool calls this immediately BEFORE it mutates anything, so
  // what we stack is the state as it was before the edit. A 'reset' with nothing to
  // reset is skipped, so an idle Reset click can't push a no-op undo step.
  onBeforeChange: (kind) => {
    if (kind === 'reset' && !hasMarkerEdits()) return;
    history.push(editSnapshot());
  },
  onUndo: () => undoEdit(),
  onRedo: () => redoEdit(),
});

// Per-channel marker SHAPE toggle (dots vs rings). Display-only: a change just
// repaints the overlay (no re-detection), same path as a colour change.
const markerStyle = createMarkerStyle(el.markerTools, {
  onChange: () => renderMarkers(),
});

// Number-label toggle (button + the H key). Display-only, and narrower than the
// shape toggle: it drops the numbers beside the markers, leaving the markers
// themselves untouched. Same repaint-only path as above.
const labelToggle = createLabelToggle(el.labelTools, {
  onChange: () => renderMarkers(),
});

/** Loaded inputs. dims is the shared {width,height}; null until first load. */
const channels = Object.fromEntries(CHANNELS.map((c) => [c.key, null])); // Float32Array per channel
let roi = null;             // parsed ImageJ ROI ({ polygon, bbox, … }) or null
let maskMatrix = null;      // ROI rasterised to a Uint8Array 0/1 (the AOI mask), or null
let dims = null;            // { width, height } — set by the first CHANNEL image
let lastResults = {};       // { r: cells[], g: cells[], ... } from the worker
let lastColoc = {};         // { 'r+g': cells[], ... } from the coloc pass
const colocDotsOn = new Set(); // combo keys whose dots the user has switched on (default: all off)
// Auto-detected cells the user has manually excluded (Phase 11), keyed by channel
// → Set of indices into that channel's lastResults array. Excluded cells are NOT
// removed from lastResults (re-detection would restore them); instead every read
// site filters them out (includedFor/includedResults). Cleared on every re-detect,
// since new results replace the arrays and old indices are meaningless.
const excludedCells = Object.fromEntries(CHANNELS.map((c) => [c.key, new Set()]));
let busy = false;           // a detection is in flight
let queued = false;         // a newer detection request arrived while busy
let lastDetectSig = null;   // signature of the last dispatched detection (see below)

/** Channel keys eligible for co-localization, in declaration order. */
const COLOC_KEYS = CHANNELS.filter((c) => c.coloc).map((c) => c.key);

// ---- Controls -------------------------------------------------------------
const controls = initControls(el.controls, onParamsChange);

/**
 * A signature of every channel's RESOLVED detection params (each channel's own
 * R/Dmin/T plus the global mode/fluorescent). Co-R is
 * deliberately excluded — it only affects co-localization, not detection. If this
 * string changes we re-run the worker; if it doesn't, the change was Co-R (or a
 * display setting) and we just re-run the cheap co-localization pass.
 */
const detectionSignature = () =>
  JSON.stringify(
    CHANNELS.map((c) => {
      const p = controls.getChannelParams(c.key);
      return [p.R, p.Dmin, p.T, p.thresholdMode, p.fluorescent];
    })
  );

/**
 * A control changed. If any channel's detection params changed, re-run the
 * worker; otherwise (Co-R only) just re-run the cheap co-localization pass on the
 * existing per-channel results. Reads state straight from `controls`, so it works
 * the same whether the change was a per-channel slider or a global control.
 */
function onParamsChange() {
  if (detectionSignature() !== lastDetectSig) {
    runDetection();
  } else if (anyChannelLoaded()) {
    recolocalize();
    renderMarkers();
    updateCounts();
  }
}

// ---- Channel / ROI loading -----------------------------------------------
const channelKeys = new Set(CHANNELS.map((c) => c.key));
const inputs = initChannelInputs(el.channelInputs, {
  onError: (msg) => setStatus(msg, true),
  onComposite: () => recompose(), // display-only change → repaint, no re-detect
  onClear: (key) => {
    if (key === ROI_INPUT.key) {
      roi = null;
      maskMatrix = null;
      roiControls.hide();
    } else {
      channels[key] = null;
    }
    // Undoing an edit made against a file that's no longer loaded would restore
    // markers/exclusions for an image the user can't see — drop the stack instead.
    history.clear();
    if (noInputsLoaded()) resetStage();
    else refresh();
  },
  onFile: (key, file) => (key === ROI_INPUT.key ? loadRoi(file) : loadChannel(key, file)),
});

// Keyboard shortcuts: each channel's `shortcutKey` (R/G/B/Y) toggles that
// channel's visibility (simple toggle). Only fires for loaded channels and never
// while typing in a field. See ui/shortcuts.js.
const shortcutKeyMap = Object.fromEntries(
  CHANNELS.filter((c) => c.shortcutKey).map((c) => [c.shortcutKey, c.key])
);
createChannelShortcuts({
  keyMap: shortcutKeyMap,
  isLoaded: (key) => Boolean(channels[key]),
  toggle: (key) => inputs.toggleVisibility(key),
});

async function loadChannel(key, file) {
  try {
    inputs.setStatus(key, `decoding ${file.name}…`);
    const image = await decodeFile(file);

    // Every channel must share one set of dimensions.
    if (dims && !sameSize(image, dims)) {
      inputs.setStatus(key, `${image.width}×${image.height} ≠ ${dims.width}×${dims.height} — ignored`, true);
      setStatus(`"${file.name}" dimensions don't match the loaded images.`, true);
      return;
    }
    const firstChannel = !dims;
    if (!dims) dims = { width: image.width, height: image.height };

    const { component } = CHANNELS.find((c) => c.key === key);
    channels[key] = extractChannel(image, component);
    inputs.setStatus(key, `${file.name} · ${image.width}×${image.height}`);

    // A ROI loaded before any channel was deferred — rasterise it now that we
    // know the image size.
    if (firstChannel && roi) applyRoi();

    history.clear(); // a new file: the edits on the stack were made against other data
    refresh();
  } catch (err) {
    inputs.setStatus(key, `failed: ${err.message}`, true);
    setStatus(`Failed to load ${file.name}: ${err.message}`, true);
  }
}

/**
 * Load an ImageJ .roi: parse the polygon, then rasterise it to the AOI mask. The
 * raster needs the image size, so if no channel is loaded yet we keep the parsed
 * ROI and rasterise on the first channel load (loadChannel above).
 */
async function loadRoi(file) {
  try {
    inputs.setStatus(ROI_INPUT.key, `parsing ${file.name}…`);
    roi = parseRoi(await file.arrayBuffer());
    roiControls.show(roi.rotation); // seed rotation from the file, reveal the editor
    // A different polygon: a stacked transform ({angle,dx,dy}) would now be undone
    // onto the WRONG shape, so the stack goes with the old ROI.
    history.clear();
    if (dims) {
      applyRoi();
      refresh(); // re-detect within the new ROI + redraw its boundary
    } else {
      inputs.setStatus(ROI_INPUT.key, `${roiTypeName(roi.type)} · applies when a channel loads`);
    }
  } catch (err) {
    roi = null;
    maskMatrix = null;
    roiControls.hide();
    inputs.setStatus(ROI_INPUT.key, `failed: ${err.message}`, true);
    setStatus(`Failed to load ${file.name}: ${err.message}`, true);
  }
}

/**
 * Rasterise the parsed ROI to the AOI mask at the current image size, applying
 * the user's rotate/move transform first (pivoting about the original polygon's
 * centre so repeated edits never drift). Re-run on every live transform edit.
 */
function applyRoi() {
  if (!roi || !dims) return;
  const t = roiControls.getTransform();
  // Pivot about the ORIGINAL polygon centre so rotation stays stable across edits.
  const polygon = transformPolygon(roi.polygon, t, polygonCenter(roi.polygon));

  // Warn against the TRANSFORMED bounds — the shape may now extend off-image.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX < 0 || minY < 0 || maxX > dims.width || maxY > dims.height) {
    setStatus(
      `ROI bounds (${Math.round(minX)},${Math.round(minY)})–(${Math.round(maxX)},${Math.round(maxY)}) extend beyond the ${dims.width}×${dims.height} image.`,
      true
    );
  }

  maskMatrix = rasterizePolygon(polygon, dims.width, dims.height);
  const pct = Math.round(maskCoverage(maskMatrix) * 100);
  const deg = Math.round(t.angle * 10) / 10;
  const rot = deg !== 0 ? ` · ${deg}°` : ''; // omit when not rotated
  inputs.setStatus(ROI_INPUT.key, `${roiTypeName(roi.type)} · ${pct}% inside${rot}`);
}

/**
 * A channel/mask file was added or removed: rebuild BOTH the display composite
 * and the detection source, repaint every layer, and re-detect.
 */
function refresh() {
  if (!dims || !anyChannelLoaded()) {
    // Only a ROI loaded so far — nothing to display/detect yet.
    setStatus('Load at least one channel image to detect.');
    return;
  }
  const display = buildComposite(dims.width, dims.height, channels, inputs.getCompositeSettings());
  layers.setImage(display); // resizes + clears every layer
  // AOI boundary sits below the markers and only changes with the ROI, so
  // (re)draw it here, after the layers are sized to the current image.
  drawAoiBoundary(layers.aoiCtx, maskMatrix, dims.width, dims.height);
  el.stage.classList.add('has-image');
  el.placeholder.hidden = true;
  el.exportPngBtn.disabled = false; // the view can be exported whenever an image is shown
  if (el.zoomToolbar.hidden) {
    el.zoomToolbar.hidden = false;
    viewport.fit();
  }
  runDetection();
}

/**
 * A display-only setting changed (colour/opacity/visibility/blend mode): repaint
 * just the composite layer — no resize, no re-detection. Coalesced with rAF so
 * dragging an opacity slider doesn't repaint faster than the screen refreshes.
 */
let recomposeQueued = false;
function recompose() {
  if (!dims || !anyChannelLoaded() || recomposeQueued) return;
  recomposeQueued = true;
  requestAnimationFrame(() => {
    recomposeQueued = false;
    const display = buildComposite(dims.width, dims.height, channels, inputs.getCompositeSettings());
    layers.setComposite(display); // base layer only — AOI untouched
    // Marker colour + visibility follow the channel styles, so repaint them too
    // (still no re-detection — the cell coordinates haven't changed).
    renderMarkers();
    // The headline depends on which channels are ACTIVE (visible), and chip
    // colours follow the marker colours, so refresh the counts display too.
    updateCounts();
  });
}

function resetStage() {
  dims = null;
  roi = null;
  maskMatrix = null;
  roiControls.hide();
  manualMarkers.clear();
  lastResults = {};
  lastColoc = {};
  for (const c of CHANNELS) excludedCells[c.key].clear();
  history.clear(); // a new stage: every edit the stack refers to is gone
  lastDetectSig = null;
  layers.clearOverlay();
  layers.clearAoi();
  el.stage.classList.remove('has-image');
  el.placeholder.hidden = false;
  el.zoomToolbar.hidden = true;
  el.count.textContent = '0';
  if (el.countLabel) el.countLabel.textContent = 'cells';
  el.breakdown.textContent = '';
  el.exportBtn.disabled = true;
  el.exportPngBtn.disabled = true;
  el.viewBtn.disabled = true;
  resultsModal.close();
  setStatus('Load one or more channels to begin.');
}

const anyChannelLoaded = () => [...channelKeys].some((k) => channels[k]);
const noInputsLoaded = () => !anyChannelLoaded() && !roi;

// ---- Detection (worker round-trip) ---------------------------------------
/**
 * Dispatch a detection run using the CURRENT controls state. Takes no args so the
 * queued-rerun path always picks up the latest params. Ships the shared params
 * plus per-channel overrides + the link flag; the worker resolves them per channel.
 */
function runDetection() {
  if (!dims || !anyChannelLoaded()) return;
  if (busy) {
    queued = true; // re-run with the latest params once the worker frees up
    return;
  }
  busy = true;
  lastDetectSig = detectionSignature();
  setStatus('Detecting…');

  // Transfer COPIES of each loaded channel's grayscale buffer (and the mask) so
  // the originals stay intact for re-runs and recompositing. The worker detects
  // each channel independently — detection is style-independent.
  const chBufs = {};
  const transfer = [];
  for (const key of channelKeys) {
    if (channels[key]) {
      const copy = channels[key].buffer.slice(0);
      chBufs[key] = copy;
      transfer.push(copy);
    } else {
      chBufs[key] = null;
    }
  }
  let maskBuf = null;
  if (maskMatrix) {
    maskBuf = maskMatrix.buffer.slice(0);
    transfer.push(maskBuf);
  }

  const channelParams = Object.fromEntries(CHANNELS.map((c) => [c.key, controls.getChannelParams(c.key)]));
  worker.postMessage(
    {
      channels: chBufs,
      mask: maskBuf,
      width: dims.width,
      height: dims.height,
      params: controls.getParams(),
      channelParams,
    },
    transfer
  );
}

worker.onmessage = (e) => {
  busy = false;
  const data = e.data;

  if (!data.ok) {
    setStatus(`Detection error: ${data.error}`, true);
  } else {
    lastResults = data.perChannel;
    // New arrays replace the old ones, so prior exclusion indices are meaningless.
    for (const c of CHANNELS) excludedCells[c.key].clear();
    // …and so are the ones sitting in the undo stack: index 7 in the OLD results is a
    // different cell (or no cell) in the new ones, so restoring it would silently
    // exclude the wrong cell. Strip the exclusions from every stacked snapshot, but
    // KEEP the stack — manual markers and the ROI transform survive a re-detection
    // untouched and are still perfectly undoable. (Clearing the whole stack instead
    // would break undoing marker edits made before an ROI move, since an ROI move
    // re-detects — and in 14B it would make a second consecutive ROI undo impossible.)
    history.map((snap) => ({ ...snap, excluded: {} }));
    recolocalize();
    renderMarkers();
    updateCounts();
    setStatus(`Detected in ${data.took.toFixed(0)} ms`);
    updateResultAvailability();
  }

  // Re-run with the latest params if a request arrived while we were busy.
  if (queued) {
    queued = false;
    runDetection();
  }
};

/**
 * One channel's detected cells with the user-excluded ones removed (Phase 11). The
 * single chokepoint every read site (markers, counts, coloc, report, CSV) funnels
 * through, so an excluded cell vanishes everywhere consistently. Returns the live
 * array untouched when nothing is excluded (the common case — no copy).
 */
function includedFor(key) {
  const list = lastResults[key];
  if (!list) return [];
  const ex = excludedCells[key];
  return ex && ex.size ? list.filter((_, i) => !ex.has(i)) : list;
}

/** All channels' detected cells, exclusions removed — the per-channel map for coloc/report/CSV. */
function includedResults() {
  const out = {};
  for (const c of CHANNELS) if (lastResults[c.key]) out[c.key] = includedFor(c.key);
  return out;
}

/**
 * Detected markers the manual-edit tool may exclude — restricted to the SELECTED
 * channel (`activeKey`): you can only prune detections of the channel you're
 * editing, never another channel's even if it's visible. Returns only its
 * not-yet-excluded cells, each carrying its ORIGINAL lastResults index. Empty when
 * the selected channel is unloaded or hidden (its markers aren't drawn → not clickable).
 */
function excludableDetectedMarkers(activeKey) {
  if (!activeKey) return {};
  const { styles } = inputs.getCompositeSettings();
  const visible = !styles[activeKey] || styles[activeKey].visible;
  const list = lastResults[activeKey];
  if (!list || !list.length || !visible) return {};
  const ex = excludedCells[activeKey];
  const arr = [];
  for (let i = 0; i < list.length; i++) {
    if (ex && ex.has(i)) continue;
    arr.push({ x: list[i].x, y: list[i].y, index: i });
  }
  return { [activeKey]: arr };
}

/** Exclude one auto-detected cell, then refresh everything that reads detections. */
function excludeDetected(key, index) {
  if (!excludedCells[key]) return;
  excludedCells[key].add(index);
  recolocalize(); // excluded cells must not participate in co-localization
  renderMarkers();
  updateCounts();
  updateResultAvailability();
}

/** "Reset" in the manual tool: clear every exclusion (manual lists already cleared) + refresh. */
function resetMarkerEdits() {
  for (const c of CHANNELS) excludedCells[c.key].clear();
  recolocalize();
  renderMarkers();
  updateCounts();
  updateResultAvailability();
}

// ---- Undo (Phase 14A) -----------------------------------------------------
/**
 * The user's whole EDIT state, deep-copied — one entry on the undo stack.
 *   manual   — the hand-placed markers, per channel.
 *   excluded — the pruned auto-detections, per channel, as index ARRAYS (a Set isn't
 *              worth keeping here; we rebuild it on restore).
 *   roi      — the ROI's rotate/move transform ({angle,dx,dy}).
 * Nothing else is undoable: sliders, colours, visibility and file loads are either
 * trivially re-set or are whole-state changes where undo would surprise more than help.
 */
function editSnapshot() {
  return {
    manual: manualMarkers.getSnapshot(),
    excluded: Object.fromEntries(CHANNELS.map((c) => [c.key, [...excludedCells[c.key]]])),
    roi: roiControls.getTransform(),
  };
}

/**
 * Restore a snapshot, then refresh ONCE. Every piece of state goes back first and the
 * repaint/re-detect happens at the end — restoring piecemeal would re-detect against a
 * half-restored state.
 * recolocalize() is not optional here: an un-excluded cell has to rejoin the co-loc
 * combos, and a removed manual marker has to leave them, or the chips and the
 * headline would disagree with the overlay.
 *
 * The ROI transform (Phase 14B) is the expensive half. Restoring it moves the AOI mask,
 * which is a detection GATE — so it needs a re-rasterise, a boundary redraw AND a worker
 * round-trip. That only happens when the transform actually differs: a marker-only undo
 * must stay a pure repaint, so we compare the three numbers rather than re-detecting
 * unconditionally.
 */
function restoreEdit(snap) {
  manualMarkers.restore(snap.manual);
  for (const c of CHANNELS) {
    const set = excludedCells[c.key];
    set.clear();
    for (const i of snap.excluded[c.key] || []) set.add(i);
  }

  const roiMoved = roi && dims && !sameTransform(snap.roi, roiControls.getTransform());
  if (roiMoved) {
    roiControls.setTransform(snap.roi);
    applyRoi(); // re-rasterise the mask at the restored transform
    drawAoiBoundary(layers.aoiCtx, maskMatrix, dims.width, dims.height);
  }

  recolocalize();
  renderMarkers();
  updateCounts();
  updateResultAvailability();

  // Last: the mask gate moved, so the detected cells themselves are now wrong. The
  // worker's reply repaints and re-counts again — that second pass is the authoritative
  // one, and it also clears the exclusions we just restored (their indices point into
  // results that are about to be replaced; see the staleness rule in worker.onmessage).
  if (roiMoved) runDetection();
}

/** Do two ROI transforms describe the same position/rotation? (undo is a no-op if so) */
function sameTransform(a, b) {
  if (!a || !b) return !a === !b;
  const near = (p, q) => Math.abs(p - q) < 1e-6;
  return near(a.angle, b.angle) && near(a.dx, b.dx) && near(a.dy, b.dy);
}

/** Ctrl+Z / the "Undo" button: step back one edit. No-op when the stack is empty. */
function undoEdit() {
  const prev = history.undo(editSnapshot());
  if (prev) restoreEdit(prev);
}

/** Ctrl+Shift+Z / Ctrl+Y / the "Redo" button: step forward again. No-op when empty. */
function redoEdit() {
  const next = history.redo(editSnapshot());
  if (next) restoreEdit(next);
}

/** True when there is any marker edit to undo — used to skip a no-op "Reset" entry. */
function hasMarkerEdits() {
  return manualMarkers.total() > 0 || CHANNELS.some((c) => excludedCells[c.key].size > 0);
}

// Ctrl+Z / Cmd+Z → undo; Ctrl+Shift+Z or Ctrl+Y → redo.
createEditShortcuts({ onUndo: () => undoEdit(), onRedo: () => redoEdit() });

/**
 * Per-channel EFFECTIVE cells = detected (exclusions removed) PLUS the channel's
 * hand-placed manual markers, each tagged. This is the canonical cell set for
 * co-localization AND reporting: a manual marker behaves exactly like a detected
 * cell — it can co-localize, so it feeds the overlapping headline, the combo chips,
 * the results modal, and the CSV (matching the "as if it were a detected cell"
 * contract). Each cell: { x, y, intensity:number|null, manual:bool, inside:bool }.
 * Detected cells are inside the AOI by construction; manual ones are tested per point.
 */
function effectiveResults() {
  const manualByChannel = manualMarkers.getChannelMarkers();
  const out = {};
  for (const c of CHANNELS) {
    const hasDetected = Boolean(lastResults[c.key]);
    const manual = manualByChannel[c.key] || [];
    if (!hasDetected && !manual.length) continue;
    const list = [];
    if (hasDetected) {
      for (const cell of includedFor(c.key)) {
        list.push({ x: cell.x, y: cell.y, intensity: cell.intensity, manual: false, inside: true });
      }
    }
    for (const m of manual) {
      list.push({
        x: m.x,
        y: m.y,
        intensity: null,
        manual: true,
        inside: dims ? maskContains(maskMatrix, dims.width, dims.height, m.x, m.y) : true,
      });
    }
    out[c.key] = list;
  }
  return out;
}

/** Recompute co-localization combos from the EFFECTIVE results (manual markers included) + Co-R. */
function recolocalize() {
  lastColoc = colocalize(effectiveResults(), COLOC_KEYS, controls.getParams().coR);
}

/**
 * Paint per-channel rings (each in its channel colour) plus co-localization dots
 * (in the combo's mixed colour). Hidden channels hide their rings, and a combo's
 * dots show only when every member channel is visible. Colours come from styles,
 * so this also runs on a display-only change (no re-detection).
 */
function renderMarkers() {
  const { styles } = inputs.getCompositeSettings();
  const visible = (key) => !styles[key] || styles[key].visible;
  const colorOf = (key) => (styles[key] && styles[key].color) || colorFromConfig(key);

  const groups = [];
  // Per-channel cells — dots or rings (user toggle, Phase 11), with user-excluded
  // cells filtered out. Rings draw at the channel's OWN resolved R, so each group
  // carries its radius.
  const shape = markerStyle.getStyle();
  for (const c of CHANNELS) {
    const cells = includedFor(c.key);
    if (!cells.length || !visible(c.key)) continue;
    groups.push({
      cells,
      color: colorOf(c.key),
      kind: 'cell',
      markerStyle: shape,
      radius: controls.getChannelParams(c.key).R,
    });
  }
  // Co-localization dots on top: OFF by default — only drawn for combos the user
  // has switched on (click its chip) and whose member channels are all visible.
  const coR = controls.getParams().coR;
  for (const combo of Object.keys(lastColoc)) {
    const cells = lastColoc[combo];
    if (!cells.length || !colocDotsOn.has(combo)) continue;
    const members = combo.split('+');
    if (!members.every(visible)) continue;
    groups.push({ cells, color: mixColors(members.map(colorOf)), kind: 'dot', radius: coR });
  }
  // Hand-placed markers on top — one group per channel, drawn as squares in that
  // channel's marker colour and hidden when the channel is hidden (same as its dots).
  // Labels continue that channel's detected sequence (detected 1…N → manual N+1…).
  const manualByChannel = manualMarkers.getChannelMarkers();
  for (const c of CHANNELS) {
    const list = manualByChannel[c.key];
    if (!list || !list.length || !visible(c.key)) continue;
    groups.push({
      cells: list,
      color: colorOf(c.key),
      kind: 'manual',
      markerStyle: shape, // hollow square in rings mode, filled in dots mode
      labelStart: includedFor(c.key).length + 1,
    });
  }
  // The label toggle is the only per-render override of the marker appearance.
  drawMarkerGroups(layers.overlayCtx, groups, controls.getParams().R, {
    ...MARKER_STYLE,
    showLabels: labelToggle.getShowLabels(),
  });
}

/**
 * The headline "big number" (Phase 12). The naive sum of all channels is NOT
 * meaningful for multi-channel fluorescence (it double-counts co-localized cells),
 * so instead:
 *   • 0 active channels → 0.
 *   • 1 active channel  → that channel's own count (detected + its manual markers).
 *   • ≥2 active channels → the OVERLAPPING count: cells co-localized across ALL
 *     currently-active channels within Co-R (the intersection, not a sum).
 * "Active" = loaded AND visible (eye on). The per-channel / per-combo breakdown
 * chips still show the full picture; this is only the single headline number.
 */
function headlineCount() {
  const active = activeChannelKeys();
  if (active.length === 0) return 0;
  if (active.length === 1) {
    const k = active[0];
    return includedFor(k).length + manualMarkers.count(k);
  }
  // ≥2 active: overlap across all active channels — manual markers participate as
  // cells (effectiveResults), so hand-placed markers move the overlapping number.
  return colocalizeAll(effectiveResults(), active, controls.getParams().coR);
}

/** Loaded AND visible channel keys, in declaration order ("active" channels). */
function activeChannelKeys() {
  const { styles } = inputs.getCompositeSettings();
  return CHANNELS.filter((c) => channels[c.key] && (!styles[c.key] || styles[c.key].visible)).map((c) => c.key);
}

/**
 * Headline number + label + per-channel and per-combo chips. A channel's manual
 * markers are folded into that channel's count (not tracked as a separate group).
 */
function updateCounts() {
  const active = activeChannelKeys();
  el.count.textContent = String(headlineCount());
  // Clarify what the number means: a single channel's count vs the cross-channel overlap.
  if (el.countLabel) el.countLabel.textContent = active.length > 1 ? 'overlapping' : 'cells';
  const { styles } = inputs.getCompositeSettings();
  const colorOf = (key) => (styles[key] && styles[key].color) || colorFromConfig(key);
  const parts = [];
  for (const c of CHANNELS) {
    const detected = includedFor(c.key).length; // excluded cells removed
    const manual = manualMarkers.count(c.key);
    if (!lastResults[c.key] && !manual) continue; // nothing loaded/placed for this channel
    parts.push(chip(colorOf(c.key), channelName(c.key), detected + manual));
  }
  for (const combo of Object.keys(lastColoc)) {
    const label = comboName(combo);
    const color = mixColors(combo.split('+').map(colorOf));
    parts.push(comboChip(color, label, lastColoc[combo].length, combo, colocDotsOn.has(combo)));
  }
  el.breakdown.innerHTML = parts.join('');
}

const manualCount = () => manualMarkers.total();

/** Enable export/view when there's anything to report (detected or manual). */
function updateResultAvailability() {
  const any = totalCells() + manualCount() > 0;
  el.exportBtn.disabled = !any;
  el.viewBtn.disabled = !any;
}

const chip = (color, label, n) =>
  `<span class="count-chip"><span class="count-chip__dot" style="background:${color}"></span>${label} ${n}</span>`;

/** A clickable combo chip — toggles whether that combination draws its dots. */
const comboChip = (color, label, n, combo, on) =>
  `<span class="count-chip count-chip--combo${on ? ' is-on' : ''}" data-combo="${combo}" title="Show/hide ${label} dots">` +
  `<span class="count-chip__dot" style="background:${color}"></span>${label} ${n}</span>`;
const totalCells = () => CHANNELS.reduce((sum, c) => sum + includedFor(c.key).length, 0);
const colorFromConfig = (key) => (CHANNELS.find((c) => c.key === key) || {}).defaultColor || '#ffffff';

/** Additive mix of hex colours, clamped — the marker colour for a co-loc combo. */
function mixColors(hexes) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const h of hexes) {
    r += parseInt(h.slice(1, 3), 16);
    g += parseInt(h.slice(3, 5), 16);
    b += parseInt(h.slice(5, 7), 16);
  }
  const cl = (v) => Math.min(255, v);
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}

worker.onerror = (e) => {
  busy = false;
  setStatus(`Worker error: ${e.message}`, true);
};

// ---- Zoom controls --------------------------------------------------------
el.zoomIn.addEventListener('click', () => viewport.zoomIn());
el.zoomOut.addEventListener('click', () => viewport.zoomOut());
el.zoomFit.addEventListener('click', () => viewport.fit());
el.zoomPct.addEventListener('click', () => viewport.zoomTo(1)); // 1:1

// ---- Export ---------------------------------------------------------------
el.exportBtn.addEventListener('click', () => {
  if (!totalCells() && !manualCount()) return;
  const { styles } = inputs.getCompositeSettings();
  // Export the EFFECTIVE results (detected minus exclusions, plus manual markers):
  // dropped cells never appear, and manual markers export as their own channel with
  // co-localization computed like any cell.
  downloadCsv(effectiveResults(), {
    coloc: lastColoc,
    colocKeys: COLOC_KEYS,
    coR: controls.getParams().coR,
    styles,
    aoiArea: aoiPixelArea(),
  });
});

// Flatten the visible canvas stack (composite → AOI boundary → markers) to a PNG.
el.exportPngBtn.addEventListener('click', () => {
  if (!dims) return;
  downloadPng([layers.baseCanvas, layers.aoiCanvas, layers.overlayCanvas]);
});

/** AOI area in pixels: the mask's inside-count, or the whole image when no ROI. */
function aoiPixelArea() {
  if (!dims) return null;
  if (!maskMatrix) return dims.width * dims.height;
  let n = 0;
  for (let i = 0; i < maskMatrix.length; i++) if (maskMatrix[i]) n++;
  return n;
}

// ---- Co-loc dot toggles (click a combo chip to show/hide its dots) --------
el.breakdown.addEventListener('click', (e) => {
  const chipEl = e.target.closest('[data-combo]');
  if (!chipEl) return;
  const combo = chipEl.dataset.combo;
  if (colocDotsOn.has(combo)) colocDotsOn.delete(combo);
  else colocDotsOn.add(combo);
  chipEl.classList.toggle('is-on', colocDotsOn.has(combo));
  renderMarkers();
});

// ---- View results (modal) -------------------------------------------------
el.viewBtn.addEventListener('click', () => {
  if (totalCells() || manualCount()) resultsModal.open(buildReport());
});

/**
 * Assemble the plain report the results modal renders: per-channel + per-combo
 * counts (with their display colours) and the full per-cell list, each cell
 * tagged with the channels it co-localizes with (symmetric, within Co-R). All
 * colour/label logic lives here so the modal stays a pure renderer.
 */
function buildReport() {
  const { styles } = inputs.getCompositeSettings();
  const colorOf = (key) => (styles[key] && styles[key].color) || colorFromConfig(key);
  const coR = controls.getParams().coR;
  // Detected + manual, merged: manual markers count and co-localize like detections.
  const effective = effectiveResults();
  const byCell = colocalizationByCell(effective, COLOC_KEYS, coR);

  const channels = [];
  for (const c of CHANNELS) {
    const manual = manualMarkers.count(c.key);
    if (!lastResults[c.key] && !manual) continue;
    const count = effective[c.key] ? effective[c.key].length : 0;
    channels.push({ key: c.key, label: channelName(c.key), color: colorOf(c.key), count });
  }

  const combos = [];
  for (const combo of Object.keys(lastColoc)) {
    const members = combo.split('+');
    combos.push({
      key: combo,
      label: comboName(combo),
      color: mixColors(members.map(colorOf)),
      count: lastColoc[combo].length,
    });
  }

  // One row per effective cell (detected + manual interleaved per channel); manual
  // cells have a blank intensity but otherwise report their co-localization like any cell.
  const cells = [];
  let id = 1;
  for (const c of CHANNELS) {
    const list = effective[c.key];
    if (!list) continue;
    const cc = byCell[c.key] || [];
    list.forEach((cell, i) => {
      cells.push({
        id: id++,
        channel: channelName(c.key),
        x: cell.x,
        y: cell.y,
        intensity: cell.manual ? '' : Math.round(cell.intensity),
        colocalizedWith: (cc[i] || []).map(channelName).join('+'),
      });
    });
  }

  return { total: totalCells() + manualCount(), aoiArea: aoiPixelArea(), channels, combos, cells };
}

// ---- Helpers --------------------------------------------------------------
function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle('is-error', isError);
}

function showVersion(version) {
  if (el.appVersion) el.appVersion.textContent = `Version ${version}`;
}

showVersion(APP_VERSION);
setStatus('Load one or more channels to begin.');
console.info(`ITCN Cell Counter v${APP_VERSION} ready. Default params:`, DEFAULT_PARAMS);

// Register the service worker for offline support + surface update banner. The
// version it reports back is the one actually SERVING this page, which is the only
// trustworthy number once a cached build is involved — see pwa.js. APP_VERSION
// above is just the placeholder until that round-trip completes.
registerPWA((version) => {
  if (!version || version === APP_VERSION) return;
  showVersion(version);
  console.info(`Served by service worker v${version} (bundle says v${APP_VERSION}).`);
});
