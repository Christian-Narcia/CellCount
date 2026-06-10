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

import { DEFAULT_PARAMS, CHANNELS, ROI_INPUT } from './config.js';
import { decodeFile } from './core/imageDecoder.js';
import { colocalize, colocalizationByCell } from './algorithm/colocalize.js';
import { extractChannel, maskCoverage, sameSize } from './core/channelExtract.js';
import { parseRoi, roiTypeName } from './core/roiParser.js';
import { rasterizePolygon } from './core/rasterize.js';
import { initChannelInputs } from './ui/channelInputs.js';
import { buildComposite } from './ui/composite.js';
import { createCanvasLayers } from './ui/canvasLayers.js';
import { drawAoiBoundary } from './ui/aoiBoundary.js';
import { createViewport } from './ui/viewport.js';
import { initControls } from './ui/controls.js';
import { drawMarkerGroups } from './ui/overlay.js';
import { createResultsModal } from './ui/resultsTable.js';
import { downloadCsv } from './export/csv.js';

// ---- DOM references -------------------------------------------------------
const el = {
  channelInputs: document.getElementById('channel-inputs'),
  placeholder: document.getElementById('stage-placeholder'),
  baseCanvas: document.getElementById('base-canvas'),
  aoiCanvas: document.getElementById('aoi-canvas'),
  overlayCanvas: document.getElementById('overlay-canvas'),
  controls: document.getElementById('controls'),
  count: document.getElementById('cell-count'),
  status: document.getElementById('status'),
  breakdown: document.getElementById('count-breakdown'),
  exportBtn: document.getElementById('export-btn'),
  viewBtn: document.getElementById('view-btn'),
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

/** Loaded inputs. dims is the shared {width,height}; null until first load. */
const channels = Object.fromEntries(CHANNELS.map((c) => [c.key, null])); // Float32Array per channel
let roi = null;             // parsed ImageJ ROI ({ polygon, bbox, … }) or null
let maskMatrix = null;      // ROI rasterised to a Uint8Array 0/1 (the AOI mask), or null
let dims = null;            // { width, height } — set by the first CHANNEL image
let lastResults = {};       // { r: cells[], g: cells[], ... } from the worker
let lastColoc = {};         // { 'r+g': cells[], ... } from the coloc pass
let busy = false;           // a detection is in flight
let queued = false;         // a newer detection request arrived while busy
let lastDetectSig = null;   // signature of the last dispatched detection (see below)

/** Channel keys eligible for co-localization, in declaration order. */
const COLOC_KEYS = CHANNELS.filter((c) => c.coloc).map((c) => c.key);

// ---- Controls -------------------------------------------------------------
const controls = initControls(el.controls, onParamsChange);

/**
 * A signature of every channel's RESOLVED detection params (per-channel R/Dmin/T
 * when unlinked, shared otherwise, plus the global mode/fluorescent). Co-R is
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
 * the same whether the change was a shared, per-channel, or link-toggle event.
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
    } else {
      channels[key] = null;
    }
    if (noInputsLoaded()) resetStage();
    else refresh();
  },
  onFile: (key, file) => (key === ROI_INPUT.key ? loadRoi(file) : loadChannel(key, file)),
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
    if (dims) {
      applyRoi();
      refresh(); // re-detect within the new ROI + redraw its boundary
    } else {
      inputs.setStatus(ROI_INPUT.key, `${roiTypeName(roi.type)} · applies when a channel loads`);
    }
  } catch (err) {
    roi = null;
    maskMatrix = null;
    inputs.setStatus(ROI_INPUT.key, `failed: ${err.message}`, true);
    setStatus(`Failed to load ${file.name}: ${err.message}`, true);
  }
}

/** Rasterise the parsed ROI to the AOI mask at the current image size. */
function applyRoi() {
  if (!roi || !dims) return;
  const { bbox } = roi;
  if (bbox.left < 0 || bbox.top < 0 || bbox.right > dims.width || bbox.bottom > dims.height) {
    setStatus(
      `ROI bounds (${bbox.left},${bbox.top})–(${bbox.right},${bbox.bottom}) extend beyond the ${dims.width}×${dims.height} image.`,
      true
    );
  }
  maskMatrix = rasterizePolygon(roi.polygon, dims.width, dims.height);
  const pct = Math.round(maskCoverage(maskMatrix) * 100);
  inputs.setStatus(ROI_INPUT.key, `${roiTypeName(roi.type)} · ${pct}% inside`);
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
  });
}

function resetStage() {
  dims = null;
  roi = null;
  maskMatrix = null;
  lastResults = {};
  lastColoc = {};
  lastDetectSig = null;
  layers.clearOverlay();
  layers.clearAoi();
  el.stage.classList.remove('has-image');
  el.placeholder.hidden = false;
  el.zoomToolbar.hidden = true;
  el.count.textContent = '0';
  el.breakdown.textContent = '';
  el.exportBtn.disabled = true;
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
      linked: controls.isLinked(),
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
    recolocalize();
    renderMarkers();
    updateCounts();
    setStatus(`Detected in ${data.took.toFixed(0)} ms`);
    const noCells = totalCells() === 0;
    el.exportBtn.disabled = noCells;
    el.viewBtn.disabled = noCells;
  }

  // Re-run with the latest params if a request arrived while we were busy.
  if (queued) {
    queued = false;
    runDetection();
  }
};

/** Recompute co-localization combos from the current per-channel results + Co-R. */
function recolocalize() {
  lastColoc = colocalize(lastResults, COLOC_KEYS, controls.getParams().coR);
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
  // Per-channel rings — each at that channel's own R (per-channel tuning, Phase 9).
  for (const c of CHANNELS) {
    const cells = lastResults[c.key];
    if (!cells || !cells.length || !visible(c.key)) continue;
    groups.push({ cells, color: colorOf(c.key), kind: 'ring', radius: controls.getChannelParams(c.key).R });
  }
  // Co-localization dots on top, only when all member channels are visible.
  const coR = controls.getParams().coR;
  for (const combo of Object.keys(lastColoc)) {
    const cells = lastColoc[combo];
    if (!cells.length) continue;
    const members = combo.split('+');
    if (!members.every(visible)) continue;
    groups.push({ cells, color: mixColors(members.map(colorOf)), kind: 'dot', radius: coR });
  }
  drawMarkerGroups(layers.overlayCtx, groups, controls.getParams().R);
}

/** Total count + per-channel and per-combo chips. */
function updateCounts() {
  el.count.textContent = String(totalCells());
  const { styles } = inputs.getCompositeSettings();
  const colorOf = (key) => (styles[key] && styles[key].color) || colorFromConfig(key);
  const parts = [];
  for (const c of CHANNELS) {
    const cells = lastResults[c.key];
    if (!cells) continue;
    parts.push(chip(colorOf(c.key), c.key.toUpperCase(), cells.length));
  }
  for (const combo of Object.keys(lastColoc)) {
    const label = combo.split('+').map((k) => k.toUpperCase()).join('+');
    parts.push(chip(mixColors(combo.split('+').map(colorOf)), label, lastColoc[combo].length));
  }
  el.breakdown.innerHTML = parts.join('');
}

const chip = (color, label, n) =>
  `<span class="count-chip"><span class="count-chip__dot" style="background:${color}"></span>${label} ${n}</span>`;
const totalCells = () => CHANNELS.reduce((sum, c) => sum + (lastResults[c.key] ? lastResults[c.key].length : 0), 0);
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
  if (!totalCells()) return;
  const { styles } = inputs.getCompositeSettings();
  downloadCsv(lastResults, {
    coloc: lastColoc,
    colocKeys: COLOC_KEYS,
    coR: controls.getParams().coR,
    styles,
    aoiArea: aoiPixelArea(),
  });
});

/** AOI area in pixels: the mask's inside-count, or the whole image when no ROI. */
function aoiPixelArea() {
  if (!dims) return null;
  if (!maskMatrix) return dims.width * dims.height;
  let n = 0;
  for (let i = 0; i < maskMatrix.length; i++) if (maskMatrix[i]) n++;
  return n;
}

// ---- View results (modal) -------------------------------------------------
el.viewBtn.addEventListener('click', () => {
  if (totalCells()) resultsModal.open(buildReport());
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
  const byCell = colocalizationByCell(lastResults, COLOC_KEYS, coR);

  const channels = [];
  for (const c of CHANNELS) {
    const cells = lastResults[c.key];
    if (!cells) continue;
    channels.push({ key: c.key, label: c.key.toUpperCase(), color: colorOf(c.key), count: cells.length });
  }

  const combos = [];
  for (const combo of Object.keys(lastColoc)) {
    const members = combo.split('+');
    combos.push({
      key: combo,
      label: members.map((k) => k.toUpperCase()).join('+'),
      color: mixColors(members.map(colorOf)),
      count: lastColoc[combo].length,
    });
  }

  const cells = [];
  let id = 1;
  for (const c of CHANNELS) {
    const list = lastResults[c.key];
    if (!list) continue;
    const cc = byCell[c.key] || [];
    list.forEach((cell, i) => {
      cells.push({
        id: id++,
        channel: c.key,
        x: cell.x,
        y: cell.y,
        intensity: Math.round(cell.intensity),
        colocalizedWith: (cc[i] || []).join('+'),
      });
    });
  }

  return { total: totalCells(), aoiArea: aoiPixelArea(), channels, combos, cells };
}

// ---- Helpers --------------------------------------------------------------
function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle('is-error', isError);
}

setStatus('Load one or more channels to begin.');
console.info('ITCN Cell Counter ready. Default params:', DEFAULT_PARAMS);
