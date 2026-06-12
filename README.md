# ITCN Cell Counter

A 100% client-side cell counter. Load microscopy images in the browser — one
file per channel (R/G/B plus a Gray layer), plus an optional ImageJ `.roi` region
of interest — and it detects nuclei using a Laplacian-of-Gaussian (LoG) blob
detector with non-maximum suppression — the same approach as the classic ITCN
ImageJ plugin.

**Nothing is uploaded.** All decoding and computation happens in your browser;
the heavy math runs in a Web Worker so the UI stays responsive.

## Run locally

ES-module Web Workers require the files to be served over HTTP (not `file://`).
Use any static server from the project root:

```bash
# Python
python -m http.server 8000
# or Node
npx serve .
```

Then open <http://localhost:8000>.

### Viewing & verifying

Once an image is loaded:

- **Scroll wheel** zooms in/out centered on the cursor.
- **Click + drag** pans the image.
- The **toolbar** (top-right) has zoom −/+, **Fit**, and a percentage button that
  resets to **1:1 (100%)**.

Zoom applies to the base image and the marker overlay together, so circles stay
aligned with cells at every level. Past 200% the raw pixel grid is shown so you
can check circle-vs-cell placement pixel-for-pixel.

## Architecture

The codebase is deliberately modular — each concern is isolated so changes stay
local. Dependencies flow one direction: `main.js` wires modules together but
holds no logic of its own.

```
src/
├── config.js              ← single source of truth for all defaults/constants
├── main.js                ← entry point; composes the modules below
│
├── algorithm/             ← pure, DOM-free functions (also run inside worker)
│   ├── grayscale.js       ·  RGBA → grayscale (+ optional inversion)
│   ├── gaussian.js        ·  separable, normalized Gaussian blur
│   ├── laplacian.js       ·  discrete Laplacian (→ LoG with the blur)
│   ├── nms.js             ·  non-maximum suppression by distance
│   ├── detect.js          ·  detectChannel(): per-channel pipeline (+ AOI mask)
│   └── colocalize.js      ·  cross-channel co-localization within Co-R
│
├── workers/
│   └── detector.worker.js ←  module worker; detects each channel independently
│
├── core/
│   ├── fileLoader.js      ·  drag-drop + file input → File (per slot, by type)
│   ├── imageDecoder.js    ·  File → ImageData (TIFF via UTIF, else browser)
│   ├── channelExtract.js  ·  ImageData → per-channel grayscale matrix
│   ├── roiParser.js       ·  ImageJ .roi binary → absolute polygon (+ rotation)
│   ├── roiTransform.js    ·  rotate/translate an ROI polygon (pure)
│   └── rasterize.js       ·  polygon → binary AOI mask (scanline fill) + point test
│
├── ui/
│   ├── channelInputs.js   ·  R/G/B/Gray + mask slots + per-channel style controls
│   ├── composite.js       ·  merge channel matrices → display image (styled)
│   ├── canvasLayers.js    ·  aligned stack: composite · AOI boundary · markers
│   ├── aoiBoundary.js     ·  trace the mask edge as a dashed outline
│   ├── roiControls.js     ·  rotate (degrees) + drag-to-move the loaded ROI
│   ├── manualMarkers.js   ·  click-to-place/remove channel-attributed manual markers
│   ├── controls.js        ·  slider/toggle panel (generated from config); link
│   │                          toggle + per-channel R/Dmin/T sliders
│   ├── overlay.js         ·  marker rendering (fixed-radius dots + co-loc discs)
│   ├── shortcuts.js       ·  keyboard R/G/B/Y → toggle channel visibility
│   └── resultsTable.js    ·  "View results" modal (summary + per-cell tables)
│
└── export/
    ├── csv.js             ·  Blob-based CSV (summary block + per-cell rows)
    └── png.js             ·  flatten the canvas stack → PNG download
```

### Why it's easy to change

- **New parameter?** Add one entry to `SLIDERS` in `config.js`; the panel and
  message protocol pick it up automatically. Add `perChannel: true` and it also
  gains an independent per-channel slider under the "Link channels" toggle.
- **Swap the algorithm?** `detect.js` is the only file the worker calls. Replace
  its internals (or import OpenCV.js) without touching UI or loading code.
- **Different marker look?** Edit `MARKER_STYLE` in `config.js`.
- **Testable core.** Everything in `algorithm/` is pure and importable in Node,
  so detection can be unit-tested without a browser.

## Detection pipeline

`grayscale → Gaussian blur (σ = R/√2) → Laplacian → local extrema → threshold → NMS (≥ Dmin)`

| Param  | Meaning                              | Default |
| ------ | ------------------------------------ | ------- |
| `R`    | expected cell radius (px)            | 10      |
| `Dmin` | minimum separation between cells (px)| 20      |
| `T`    | threshold (0–255, see modes below)   | 30      |
| threshold mode | `log` or `intensity`         | log     |
| fluorescent | bright cells on dark background | **on**  |

### The math, briefly

- **σ = R / √2** places the LoG zero-crossings at the cell radius `R`, so a cell
  of radius `R` produces the strongest response.
- A **bright blob** yields a strongly **negative** LoG value at its center, so
  cell centers are local *minima* of the LoG (local maxima of `−LoG`, the
  "strength"). The Gaussian kernel is normalized to sum to 1 so blurring never
  shifts brightness.
- **Inversion** follows the real ITCN "detect bright peaks" convention: in
  *fluorescent* mode cells are already bright (no inversion); in *brightfield*
  the image is inverted so dark cells become bright peaks. (This is deliberately
  the reverse of the loose wording in `todo.txt` — see the note in `detect.js`.)

### Threshold modes

- **`log`** (default) — `T` is a *relative* sensitivity (0–255 → 0–100% of the
  strongest blob response in the image). This matches how the real ITCN plugin
  thresholds and is robust to illumination gradients.
- **`intensity`** — `T` is an absolute pixel value (0–255); a candidate is kept
  if its (inverted) intensity ≥ `T`. Intuitive, but sensitive to uneven
  illumination.

## Status

Phases 1–10 (+ 2.5) complete — the multi-channel counter is functionally whole:
scaffold, the loading pipeline (separate R/G/B/Gray slots + an ImageJ `.roi` slot,
per-channel extraction with Gray using luminance, dimension validation), the
aligned canvas stack (composite → dashed AOI boundary → marker overlay), channel
compositing (per-channel opacity/visibility + Additive/Opacity blend, all
pixel-level; each channel's **composite colour is fixed** at its config default and
the per-channel colour picker controls **marker colour only**), **per-channel
detection**, and **cross-channel co-localization**.

The AOI is an **ImageJ `.roi` polygon**: a custom binary parser
(`core/roiParser.js`) reads the format and `core/rasterize.js` fills it (scanline
even-odd) into the binary mask the worker uses — done once on load. Detection runs
the full LoG + NMS pipeline **independently on each channel** in a Web Worker. The
**AOI is a pure spatial restriction**: detection runs on the whole image and only
cells whose centre falls inside the ROI are kept. This keeps the relative `log`
threshold reference image-global, so a smaller ROI can only ever *reduce* the count
(the in-ROI result is a strict subset of the whole-image result) — never raise it.
A co-localization pass then matches cells across channels within a **Co-R** radius
(every pair + the full set; **Gray is excluded by default** — set `coloc: true` on
the Gray channel in `config.js` to include it). The overlay shows per-channel dots
(small, fixed-radius) plus larger mixed-colour
co-localization discs; the panel shows a total plus per-channel and per-combo
counts. Display styling and Co-R never re-run detection — counts are stable. CSV
exports one row per cell tagged with its channel.

**Detection params are per-channel** (Phase 9): a "Link channels" toggle (default
on) shares one R/Dmin/T set across all channels; unlink it to tune each channel's
R/Dmin/T independently. The worker merges per-channel overrides onto the shared
params. Threshold mode, fluorescent mode, and Co-R remain global.

**ROI editing** (Phase 11): once an `.roi` loads, a small editor appears to
**rotate** it (degrees — seeded from the file's stored rotation at header offset
36) and **reposition** it by toggling "Move ROI" and dragging on the image. Edits
re-rasterise the mask and re-run detection; the current angle is shown in the ROI
slot status. An **"Add markers"** tool lets you click the image to place (or click
a marker to remove) **channel-attributed** manual markers: a channel selector picks
which channel a new marker belongs to, and a **Reset** clears them all. Each marker
draws as a small square in its channel's marker colour, hides with that channel, and
is **folded into that channel's count** everywhere (headline, chips, "View results",
CSV — exported under its own channel id with `inside_aoi` computed per point). It
shares the image canvas with the ROI move tool, so only one is active at a time. **Export PNG** flattens the current view (composite
+ AOI boundary + markers) into one image and downloads it. The keys **R / G / B / Y**
toggle each channel's visibility (simple toggle; ignored while typing in a field).

**Export** (Phase 10): a **"View results"** button opens a modal with the total,
AOI pixel area, per-channel and per-combination count tables (colour-dotted), and a
scrollable full per-cell table. **Export CSV** writes a `#`-commented summary block
(per-channel/per-combo totals, AOI area, channel colours) followed by one row per
cell with `cell_id, channel, x, y, intensity, inside_aoi, colocalized_with`. The
`colocalized_with` column is computed symmetrically, so each cell lists every other
channel it co-localizes with within Co-R.

The **headline count** (Phase 12) is channel-aware: with one active (loaded +
visible) channel it shows that channel's own count; with several it shows the
**overlapping** count — cells co-localized across *all* active channels within Co-R
(the intersection, not a double-counting sum) — and the label switches to
"overlapping". Toggling a channel's visibility updates it live, no re-detection.

Next up (`todo.txt`): the test/QA pass (Phase 13).
