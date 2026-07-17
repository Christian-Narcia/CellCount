# ITCN Cell Counter

A 100% client-side cell counter. Load microscopy images in the browser — one
file per channel (R/G/B plus a Gray layer), plus an optional ImageJ `.roi` region
of interest — and it detects nuclei using a Laplacian-of-Gaussian (LoG) blob
detector with non-maximum suppression — the same approach as the classic ITCN
ImageJ plugin.

**Nothing is uploaded.** All decoding and computation happens in your browser;
the heavy math runs in a Web Worker so the UI stays responsive.
## Hosted Cite on Github
https://christian-narcia.github.io/CellCount/

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

## Offline available after first visit (PWA)

The app is an installable Progressive Web App and works **fully offline**.

### Viewing & verifying

Once an image is loaded:

- **Scroll wheel** zooms in/out centered on the cursor.
- **Click + drag** pans the image.
- The **toolbar** (top-right) has zoom −/+, **Fit**, and a percentage button that
  resets to **1:1 (100%)**.

Zoom applies to the base image and the marker overlay together, so circles stay
aligned with cells at every level. Past 200% the raw pixel grid is shown so you
can check circle-vs-cell placement pixel-for-pixel.

## Releasing

Bump `VERSION` in `service-worker.js`, then push. That single edit is what ships a
build: it changes the worker's bytes, which is the only signal a browser holding a
cached copy of the app can actually see. The new worker precaches the new files under
a new cache name, deletes the old cache, and the open page offers "Update available —
Reload". Everything else — including `APP_VERSION` in `src/config.js` — is served from
the cache, so a version written there is invisible to the very clients that need to
learn about the update. (Bump it anyway if you like; it's the pre-worker placeholder
for the footer, nothing more.)

## Architecture

The codebase is deliberately modular — each concern is isolated so changes stay
local. Dependencies flow one direction: `main.js` wires modules together but
holds no logic of its own.

```
.
├── index.html             ← app shell (loads vendor/utif.js + src/main.js)
├── manifest.json          ← PWA manifest (installable; name, icons, colors)
├── service-worker.js      ← offline cache (precache + versioned cleanup)
├── vendor/utif.js         ← TIFF decoder, bundled locally (was a CDN) for offline
├── icons/                 ← icon-192.png · icon-512.png (home-screen / launcher)
│
src/
├── config.js              ← single source of truth for all defaults/constants
├── main.js                ← entry point; composes the modules below
├── pwa.js                 ← service-worker registration + "update available" banner
│
├── algorithm/             ← pure, DOM-free functions (also run inside worker)
│   ├── grayscale.js       ·  RGBA → grayscale (+ optional inversion)
│   ├── itcnKernel.js      ·  ITCN's width×width LoG kernel (port of findKernal)
│   ├── itcnFilter.js      ·  the convolution (port of filter2), separable fast path
│   ├── itcnPeaks.js       ·  greedy peak search (port of find_local_max)
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
│   ├── rasterize.js       ·  polygon → binary AOI mask (scanline fill) + point test
│   └── history.js         ·  generic undo/redo stack of state snapshots (pure)
│
├── ui/
│   ├── channelInputs.js   ·  R/G/B/Gray + mask slots + per-channel style controls
│   ├── composite.js       ·  merge channel matrices → display image (styled)
│   ├── canvasLayers.js    ·  aligned stack: composite · AOI boundary · markers
│   ├── aoiBoundary.js     ·  trace the mask edge as a dashed outline
│   ├── roiControls.js     ·  rotate (degrees) + drag-to-move the loaded ROI
│   │                          (one gesture = one undo step)
│   ├── manualMarkers.js   ·  click-to-place/remove channel-attributed manual markers
│   │                          (+ Undo/Redo buttons; snapshots its lists for the stack)
│   ├── markerStyle.js     ·  display-only dots/rings toggle for per-channel markers
│   ├── markerToggle.js    ·  display-only show/hide for the per-channel markers (D key)
│   ├── labelToggle.js     ·  display-only show/hide for the marker number labels (H key)
│   ├── controls.js        ·  slider/toggle panel (generated from config); a
│   │                          per-channel R/Dmin/T group each, with a lock + rename button
│   ├── overlay.js         ·  marker rendering (dots or rings + co-loc discs)
│   ├── shortcuts.js       ·  keyboard R/G/B/Y → channel visibility; Ctrl+Z / Ctrl+Shift+Z
│   │                          → undo/redo any marker or ROI edit
│   └── resultsTable.js    ·  "View results" modal (summary + per-cell tables)
│
└── export/
    ├── csv.js             ·  Blob-based CSV (summary block + per-cell rows)
    └── png.js             ·  flatten the canvas stack → PNG download
```


## Detection pipeline

This is a **faithful port of the ITCN ImageJ plugin** (Kuo & Byun, UCSB), transcribed
from its Java source (`Itcn_.java`, which survives inside `Itcn.zip` in the
[PMB-KU/CountNuclei](https://github.com/PMB-KU/CountNuclei) fork). Same parameters →
same counts as Fiji. Every constant is documented at its use site in
[itcnKernel.js](src/algorithm/itcnKernel.js), [itcnFilter.js](src/algorithm/itcnFilter.js),
and [itcnPeaks.js](src/algorithm/itcnPeaks.js). See **Credits** below for citations.

`grayscale → ITCN LoG kernel (Width×Width) → soft-threshold S = max(0, S−T) → greedy peak search (verify within ⌊Width/3⌋, suppress within Dmin)`

| Param  | Meaning                              | Default | ITCN equivalent |
| ------ | ------------------------------------ | ------- | --------------- |
| `R`    | expected cell **radius** (px)        | 10      | `Width` = 2R = **20** (a DIAMETER) |
| `Dmin` | minimum separation between cells (px)| 10      | `Minimum Distance` = **10** (= Width/2) |
| `T`    | threshold — range depends on mode    | 0.2     | `Threshold` = **0.2** |
| threshold mode | `itcn` or `intensity`        | itcn    | — |
| fluorescent | bright cells on dark background | **on**  | `Detect Dark Peaks` **unchecked** |

The shipped defaults *are* ITCN's defaults: load an image, press go, and you should get
the number Fiji gives with its own defaults.

### The math, briefly

- **`R` is a radius; ITCN's `Width` is a diameter.** `Width = 2R`, so a Fiji user who
  types `Width = 20` uses `R = 10` here.
- **σ = (Width − 1) / 3**, i.e. `(2R − 1)/3` — ITCN's own constant, **not** the textbook
  `R/√2`. It is exactly the σ that makes the `Width × Width` kernel span ±1.5σ.
- The kernel is zero-meaned and then **divided by the sum of its Gaussian**. That is what
  puts the response on an absolute scale in units of 8-bit intensity — and it is the only
  reason a fixed threshold like `0.2` means anything at all.
- **Polarity by inversion, not by sign flip.** ITCN's kernel has a negative centre lobe and
  the peak search always hunts maxima, so bright nuclei are found by feeding it `255 − I`.
  *Fluorescent* mode (bright cells) = `Detect Dark Peaks` **off**; brightfield = on.
- The peak search is **greedy** — not "find all maxima, then suppress". Take the strongest
  surviving pixel, verify it is a local max, count it, and blank its `Dmin` disk whether or
  not it was counted. `itcnPeaks.js` documents the three quirks the count depends on.

### Threshold modes

`T` means a different thing in each mode, so the **T slider re-ranges itself when
you switch modes** (and rescales the current value to the same relative knob
position so it never jumps):

- **`itcn`** (default) — `T` is ITCN's threshold: an **absolute** bar on the LoG blob
  response, on the plugin's own `0.0–10.0` range (step 0.1), default **0.2**. Type the
  number you would type in Fiji. At the defaults it works out to a minimum blob contrast of
  roughly 9 gray levels out of 255 — a deliberately sensitive bar.
- **`intensity`** — `T` is an absolute pixel value **0–255**; a candidate is kept if its
  (inverted) intensity ≥ `T`. Not an ITCN feature — a convenience gate this tool adds.
  Intuitive, but sensitive to uneven illumination.

## Credits

The detection algorithm is a reimplementation of **ITCN (Image-based Tool for Counting
Nuclei)**, an ImageJ plugin from the Center for Bio-image Informatics, UC Santa Barbara.
This project is not affiliated with or endorsed by UCSB, the ITCN authors, or the
ImageJ/Fiji projects; it reimplements a published, openly distributed method and cites it
below. If you use this tool in your published research, please cite both the original method 
and this implementation to ensure scientific validity and reproducibility.

- **ITCN** — Byun J, Verardo MR, Sumengen B, Lewis GP, Manjunath BS, Fisher SK.
  *Automated tool for the detection of cell nuclei in digital microscopic images:
  application to retinal images.* Molecular Vision 2006;12:949–960.
  Plugin: <https://imagej.net/ij/plugins/itcn.html> · original authors Thomas Kuo and
  Jiyun Byun.
- **ITCN source** — the algorithm's constants were transcribed from `Itcn_.java`, preserved
  in the community fork **PMB-KU/CountNuclei**: <https://github.com/PMB-KU/CountNuclei>.
- **ImageJ** — Schneider CA, Rasband WS, Eliceiri KW. *NIH Image to ImageJ: 25 years of
  image analysis.* Nature Methods 2012;9(7):671–675. The `.roi` region-of-interest format
  read by this tool is ImageJ's.
- **Fiji** — Schindelin J, et al. *Fiji: an open-source platform for biological-image
  analysis.* Nature Methods 2012;9(7):676–682. ("ITCN in Fiji" refers to running the ITCN
  plugin inside the Fiji distribution of ImageJ.)
- **UTIF.js** — TIFF decoding, by Ivan Kutskir (MIT). Bundled in `vendor/utif.js`.

