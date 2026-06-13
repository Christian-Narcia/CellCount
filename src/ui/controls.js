/**
 * controls.js — Builds the control panel and emits param changes.
 *
 * The entire panel is generated from config (SLIDERS, SELECTS, TOGGLES, CHANNELS),
 * so adding a new tunable is a one-line change in config.js — no HTML edits and no
 * changes here.
 *
 * PER-CHANNEL TUNING (Phase 9). Sliders flagged `perChannel` in config can be set
 * independently per channel. A "Link channels" toggle swaps the UI between two
 * mutually-exclusive layouts:
 *   • LINKED (default) — one shared slider per per-channel param drives every
 *     channel. The per-channel groups are hidden.
 *   • UNLINKED         — the shared per-channel sliders are hidden and each
 *     channel gets its own R/Dmin/T group.
 * Non-per-channel controls (Co-R, threshold mode, fluorescent) are always shared
 * and always visible. On UNLINK, every channel's group is seeded from the current
 * shared values so detection doesn't jump.
 *
 * onChange payload: { params, channelParams, linked }
 *   • params        — the global/shared params (the linked values + Co-R + mode +
 *                     fluorescent). DEFAULT_PARAMS shape.
 *   • channelParams — { [channelKey]: { R, Dmin, T } } per-channel overrides,
 *                     applied over `params` only when !linked.
 *   • linked        — boolean.
 */

import { SLIDERS, SELECTS, TOGGLES, DEFAULT_PARAMS, CHANNELS, LINK_DEFAULT, thresholdRange } from '../config.js';

/** Sliders that support independent per-channel values. */
const PER_CHANNEL_SLIDERS = SLIDERS.filter((s) => s.perChannel);

/**
 * @param {HTMLElement} container
 * @param {(payload: { params: object, channelParams: object, linked: boolean }) => void} onChange
 *        called (debounced) on any change
 * @returns {{
 *   getParams: () => object,
 *   setParams: (p: object) => void,
 *   getChannelParams: (key: string) => object,
 *   isLinked: () => boolean,
 * }}
 */
export function initControls(container, onChange) {
  const params = { ...DEFAULT_PARAMS };
  let linked = LINK_DEFAULT;

  // Per-channel overrides, seeded from the shared defaults. Only the per-channel
  // slider keys live here; everything else is read from `params`.
  /** @type {Record<string, Record<string, number>>} */
  const channelParams = {};
  for (const c of CHANNELS) {
    channelParams[c.key] = {};
    for (const s of PER_CHANNEL_SLIDERS) channelParams[c.key][s.key] = params[s.key];
  }

  // References to the per-channel slider widgets so UNLINK can sync their values
  // to the shared sliders. chWidgets[channelKey][paramKey] = { input, value }.
  /** @type {Record<string, Record<string, { input: HTMLInputElement, value: HTMLElement }>>} */
  const chWidgets = {};
  // Shared per-channel slider widgets, keyed by param, so we can hide them when
  // unlinked and read their values back on link.
  /** @type {Record<string, { input: HTMLInputElement, value: HTMLElement }>} */
  const sharedPerChannelWidgets = {};

  // ---- Shared sliders ----
  // Per-channel-capable sliders are wrapped so they can be hidden when unlinked;
  // plain sliders (Co-R) are always visible.
  for (const def of SLIDERS) {
    const wrap = el('div', 'control');
    if (def.perChannel) wrap.classList.add('control--linked');

    const w = buildSlider(def, params[def.key], (v) => {
      params[def.key] = v;
      // While linked, keep the overrides mirrored so an UNLINK starts from here.
      if (def.perChannel && linked) {
        for (const c of CHANNELS) channelParams[c.key][def.key] = v;
      }
      emit();
    });
    wrap.append(w.label, w.input);
    container.appendChild(wrap);
    if (def.perChannel) sharedPerChannelWidgets[def.key] = w;
  }

  // ---- Link toggle + per-channel groups ----
  // Only meaningful when there is something to tune per channel.
  let perChannelWrap = null;
  if (PER_CHANNEL_SLIDERS.length && CHANNELS.length) {
    const linkWrap = el('div', 'control control--toggle');
    const linkLabel = el('label');
    const linkInput = el('input');
    linkInput.type = 'checkbox';
    linkInput.checked = linked;
    linkLabel.append(linkInput, document.createTextNode(' Link channels (shared R/Dmin/T)'));
    linkWrap.appendChild(linkLabel);
    container.appendChild(linkWrap);

    perChannelWrap = el('div', 'per-channel');
    for (const c of CHANNELS) {
      const group = el('div', 'per-channel__group');
      const heading = el('div', 'per-channel__heading');
      heading.textContent = c.label;
      if (c.defaultColor) heading.style.setProperty('--slot-color', c.defaultColor);
      group.appendChild(heading);

      chWidgets[c.key] = {};
      for (const def of PER_CHANNEL_SLIDERS) {
        const wrap = el('div', 'control');
        const w = buildSlider(def, channelParams[c.key][def.key], (v) => {
          channelParams[c.key][def.key] = v;
          emit();
        });
        wrap.append(w.label, w.input);
        group.appendChild(wrap);
        chWidgets[c.key][def.key] = w;
      }
      perChannelWrap.appendChild(group);
    }
    container.appendChild(perChannelWrap);

    linkInput.addEventListener('change', () => {
      linked = linkInput.checked;
      // Seed per-channel sliders from the shared values so detection is continuous.
      if (!linked) {
        for (const c of CHANNELS) {
          for (const def of PER_CHANNEL_SLIDERS) {
            const v = params[def.key];
            channelParams[c.key][def.key] = v;
            const w = chWidgets[c.key][def.key];
            w.input.value = v;
            w.value.textContent = `${v}${def.unit || ''}`;
          }
        }
      }
      applyLinkVisibility();
      emit();
    });
  }

  applyLinkVisibility();

  // ---- Selects (dropdowns) — always shared ----
  for (const def of SELECTS) {
    const wrap = el('div', 'control');
    const label = el('label');
    label.textContent = def.label;

    const select = el('select');
    for (const opt of def.options) {
      const o = el('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === params[def.key]) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      const prev = params[def.key];
      params[def.key] = select.value;
      // The threshold mode redefines what T means (relative 0–1 vs absolute
      // 0–255), so re-range every T slider and rescale its value to match.
      if (def.reranges === 'T' && select.value !== prev) {
        rerangeThreshold(prev, select.value);
      }
      emit();
    });

    wrap.append(label, select);
    container.appendChild(wrap);
  }

  // ---- Toggles (checkboxes) — always shared ----
  for (const def of TOGGLES) {
    const wrap = el('div', 'control control--toggle');
    const label = el('label');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = Boolean(params[def.key]);
    input.addEventListener('change', () => {
      params[def.key] = input.checked;
      emit();
    });
    label.append(input, document.createTextNode(` ${def.label}`));
    wrap.appendChild(label);
    container.appendChild(wrap);
  }

  /**
   * Re-range every T slider (shared + per-channel) when the threshold mode
   * changes, rescaling each current value to the SAME relative position in the
   * new range so the knob never jumps to an extreme. Mutates `params.T` and the
   * per-channel `channelParams[*].T` so the next emit() ships consistent values.
   */
  function rerangeThreshold(fromMode, toMode) {
    const from = thresholdRange(fromMode);
    const to = thresholdRange(toMode);

    const newShared = rescaleToRange(params.T, from, to);
    params.T = newShared;
    const sharedT = sharedPerChannelWidgets.T;
    if (sharedT) applySliderRange(sharedT, to, newShared);

    for (const c of CHANNELS) {
      if (!channelParams[c.key] || !('T' in channelParams[c.key])) continue;
      const v = rescaleToRange(channelParams[c.key].T, from, to);
      channelParams[c.key].T = v;
      const w = chWidgets[c.key] && chWidgets[c.key].T;
      if (w) applySliderRange(w, to, v);
    }
  }

  /** Show the shared per-channel sliders xor the per-channel groups. */
  function applyLinkVisibility() {
    for (const w of Object.values(sharedPerChannelWidgets)) {
      w.input.closest('.control').hidden = !linked;
    }
    if (perChannelWrap) perChannelWrap.hidden = linked;
  }

  // Debounce so dragging a slider doesn't fire dozens of detections.
  let timer = null;
  function emit() {
    clearTimeout(timer);
    timer = setTimeout(
      () => onChange({ params: { ...params }, channelParams: cloneChannelParams(), linked }),
      120
    );
  }

  const cloneChannelParams = () =>
    Object.fromEntries(Object.entries(channelParams).map(([k, v]) => [k, { ...v }]));

  return {
    getParams: () => ({ ...params }),
    setParams: (p) => Object.assign(params, p),
    isLinked: () => linked,
    /** Resolved detection params for one channel: shared, with per-channel overrides when unlinked. */
    getChannelParams: (key) =>
      linked ? { ...params } : { ...params, ...(channelParams[key] || {}) },
  };
}

/**
 * Build a single labelled range slider. Returns the label + input nodes and the
 * value <span> (so callers can update the readout when setting the value
 * programmatically). `onInput` receives the numeric value.
 */
function buildSlider(def, initial, onInput) {
  const label = el('label');
  label.textContent = def.label;
  const value = el('span', 'control__value');
  value.textContent = `${initial}${def.unit || ''}`;
  label.appendChild(value);

  const input = el('input');
  input.type = 'range';
  input.min = def.min;
  input.max = def.max;
  input.step = def.step;
  input.value = initial;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = `${v}${def.unit || ''}`;
    onInput(v);
  });

  return { label, input, value };
}

/**
 * Push a new range + value onto an existing slider widget (used when the
 * threshold mode swaps the T slider between its 0–1 and 0–255 scales).
 */
function applySliderRange(widget, range, value) {
  widget.input.min = range.min;
  widget.input.max = range.max;
  widget.input.step = range.step;
  widget.input.value = value;
  widget.value.textContent = `${value}${range.unit || ''}`;
}

/**
 * Map a value's relative position in `from` onto `to`, snapped to `to.step` and
 * clamped. The toFixed tidies float drift from the step multiplication (so e.g.
 * 0.30000000000000004 reads as 0.3).
 */
function rescaleToRange(v, from, to) {
  const frac = from.max > from.min ? (v - from.min) / (from.max - from.min) : 0;
  const snapped = Math.round((to.min + frac * (to.max - to.min)) / to.step) * to.step;
  const clamped = Math.min(to.max, Math.max(to.min, snapped));
  return Number(clamped.toFixed(4));
}

/** Tiny element helper. */
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
