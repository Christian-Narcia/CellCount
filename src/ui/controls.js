/**
 * controls.js — Builds the control panel and emits param changes.
 *
 * The entire panel is generated from config (SLIDERS, SELECTS, TOGGLES, CHANNELS),
 * so adding a new tunable is a one-line change in config.js — no HTML edits and no
 * changes here.
 *
 * PER-CHANNEL TUNING (Phase 9). Sliders flagged `perChannel` in config are tuned
 * independently per channel — there is no shared/linked mode. Every channel gets
 * its own R/Dmin/T group, seeded from that channel's CHANNELS[*].params defaults.
 * Each group has a LOCK button (top-right); locking disables that group's sliders
 * so the defaults can't be moved by accident (a UI guard only — it never changes
 * the values). Non-per-channel controls (Co-R, threshold mode, fluorescent) are
 * always global.
 *
 * onChange payload: { params, channelParams }
 *   • params        — the global params (base R/Dmin/T + Co-R + mode +
 *                     fluorescent). DEFAULT_PARAMS shape.
 *   • channelParams — { [channelKey]: { R, Dmin, T } } per-channel values, always
 *                     applied over `params` (see getChannelParams).
 */

import { SLIDERS, SELECTS, TOGGLES, DEFAULT_PARAMS, CHANNELS, LOCK_DEFAULT, thresholdRange, setChannelName } from '../config.js';

/** Sliders that support independent per-channel values. */
const PER_CHANNEL_SLIDERS = SLIDERS.filter((s) => s.perChannel);

/**
 * @param {HTMLElement} container
 * @param {(payload: { params: object, channelParams: object }) => void} onChange
 *        called (debounced) on any change
 * @param {{ onRename?: (key: string, name: string) => void }} [options]
 *        onRename fires after a channel's name is edited (the edit button), with the
 *        new display name in effect — so the caller can refresh anything else that
 *        shows it (count chips, channel slot, the results table).
 * @returns {{
 *   getParams: () => object,
 *   setParams: (p: object) => void,
 *   getChannelParams: (key: string) => object,
 * }}
 */
export function initControls(container, onChange, options = {}) {
  const { onRename = () => {} } = options;
  const params = { ...DEFAULT_PARAMS };

  // Per-channel values, seeded from each channel's own CHANNELS[*].params
  // defaults (falling back to the global defaults for anything omitted). Only the
  // per-channel slider keys live here; everything else is read from `params`.
  /** @type {Record<string, Record<string, number>>} */
  const channelParams = {};
  for (const c of CHANNELS) {
    channelParams[c.key] = {};
    for (const s of PER_CHANNEL_SLIDERS) {
      channelParams[c.key][s.key] = (c.params && c.params[s.key] != null) ? c.params[s.key] : params[s.key];
    }
  }

  // References to the per-channel slider widgets so the threshold re-range can
  // update them. chWidgets[channelKey][paramKey] = { input, value }.
  /** @type {Record<string, Record<string, { input: HTMLInputElement, value: HTMLElement }>>} */
  const chWidgets = {};

  // ---- Shared sliders (non-per-channel only, e.g. Co-R) ----
  // Per-channel sliders live in their own groups below, never as a shared slider.
  for (const def of SLIDERS) {
    if (def.perChannel) continue;
    const wrap = el('div', 'control');
    const w = buildSlider(def, params[def.key], (v) => {
      params[def.key] = v;
      emit();
    });
    wrap.append(w.label, w.input);
    container.appendChild(wrap);
  }

  // ---- Per-channel groups (each independently tunable + lockable) ----
  /** Locked flag per channel key. */
  const lockState = {};
  /** @type {Record<string, HTMLButtonElement>} */
  const lockButtons = {};
  /** Group heading nodes + their current display name, so the edit button can rename them. */
  /** @type {Record<string, HTMLElement>} */
  const headings = {};
  /** @type {Record<string, string>} */
  const displayNames = {};
  if (PER_CHANNEL_SLIDERS.length && CHANNELS.length) {
    const perChannelWrap = el('div', 'per-channel');
    for (const c of CHANNELS) {
      const group = el('div', 'per-channel__group');

      const header = el('div', 'per-channel__header');
      const heading = el('div', 'per-channel__heading');
      heading.textContent = c.label;
      headings[c.key] = heading;
      displayNames[c.key] = c.label;
      if (c.defaultColor) {
        group.style.setProperty('--slot-color', c.defaultColor);
        heading.style.setProperty('--slot-color', c.defaultColor);
      }
      // Edit (rename) + lock buttons, grouped on the right of the header.
      const actions = el('div', 'per-channel__actions');
      actions.append(buildEditButton(c.key), buildLockButton(c.key));
      header.append(heading, actions);
      group.appendChild(header);

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
      applyLock(c.key, LOCK_DEFAULT);
    }
    container.appendChild(perChannelWrap);
  }

  /**
   * Build the lock button for a channel group. Clicking it toggles the locked
   * state, which disables/enables that group's sliders (a UI guard only — the
   * values are untouched, so no emit() is needed).
   */
  function buildLockButton(key) {
    const btn = el('button', 'lock-btn');
    btn.type = 'button';
    btn.addEventListener('click', () => applyLock(key, !lockState[key]));
    lockButtons[key] = btn;
    return btn;
  }

  /** Apply a locked/unlocked state to one channel group (button label + slider disabling). */
  function applyLock(key, locked) {
    lockState[key] = locked;
    const btn = lockButtons[key];
    if (btn) {
      btn.classList.toggle('is-locked', locked);
      btn.setAttribute('aria-pressed', String(locked));
      btn.title = locked ? 'Unlock parameters' : 'Lock parameters';
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = locked ? LOCK_ICON : UNLOCK_ICON;
    }
    for (const def of PER_CHANNEL_SLIDERS) {
      const w = chWidgets[key] && chWidgets[key][def.key];
      if (w) w.input.disabled = locked;
    }
  }

  /**
   * Build the rename button for a channel group. Clicking it swaps the heading for
   * an inline text field; committing renames the channel EVERYWHERE it's shown —
   * the group heading here, plus (via config.setChannelName + onRename) the count
   * chips, the channel slot, and the "View results" table.
   */
  function buildEditButton(key) {
    const btn = el('button', 'edit-btn');
    btn.type = 'button';
    btn.title = 'Rename channel';
    btn.setAttribute('aria-label', 'Rename channel');
    btn.innerHTML = EDIT_ICON;
    btn.addEventListener('click', () => startRename(key));
    return btn;
  }

  /** Swap a group heading for an inline input; Enter/blur commits, Escape cancels. */
  function startRename(key) {
    const heading = headings[key];
    if (!heading || heading.dataset.editing) return;
    heading.dataset.editing = '1';

    const input = el('input', 'per-channel__rename');
    input.type = 'text';
    input.value = displayNames[key];
    input.setAttribute('aria-label', 'Channel name');
    heading.textContent = '';
    heading.appendChild(input);
    input.focus();
    input.select();

    const initial = displayNames[key];
    let done = false;
    const finish = (save) => {
      if (done) return; // guard against blur firing after Enter/Escape already ran
      done = true;
      delete heading.dataset.editing;
      const next = input.value.trim();
      // Only propagate a REAL change — merely opening the editor and clicking away
      // must not relabel the channel (config keeps the trimmed name in step).
      if (save && next && next !== initial) {
        displayNames[key] = setChannelName(key, next);
        heading.textContent = displayNames[key];
        onRename(key, displayNames[key]);
      } else {
        heading.textContent = initial; // unchanged
      }
    };

    input.addEventListener('keydown', (e) => {
      // Don't let this key reach the global shortcuts while typing a name.
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

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
   * Re-range every per-channel T slider when the threshold mode changes,
   * rescaling each current value to the SAME relative position in the new range
   * so the knob never jumps to an extreme. Mutates `params.T` (the base fallback)
   * and each per-channel `channelParams[*].T` so the next emit() ships consistent
   * values. Disabled (locked) sliders still re-range — only user dragging is
   * blocked, not programmatic updates.
   */
  function rerangeThreshold(fromMode, toMode) {
    const from = thresholdRange(fromMode);
    const to = thresholdRange(toMode);

    params.T = rescaleToRange(params.T, from, to);

    for (const c of CHANNELS) {
      if (!channelParams[c.key] || !('T' in channelParams[c.key])) continue;
      const v = rescaleToRange(channelParams[c.key].T, from, to);
      channelParams[c.key].T = v;
      const w = chWidgets[c.key] && chWidgets[c.key].T;
      if (w) applySliderRange(w, to, v);
    }
  }

  // Debounce so dragging a slider doesn't fire dozens of detections.
  let timer = null;
  function emit() {
    clearTimeout(timer);
    timer = setTimeout(
      () => onChange({ params: { ...params }, channelParams: cloneChannelParams() }),
      120
    );
  }

  const cloneChannelParams = () =>
    Object.fromEntries(Object.entries(channelParams).map(([k, v]) => [k, { ...v }]));

  return {
    getParams: () => ({ ...params }),
    setParams: (p) => Object.assign(params, p),
    /** Resolved detection params for one channel: global params + that channel's own R/Dmin/T. */
    getChannelParams: (key) => ({ ...params, ...(channelParams[key] || {}) }),
  };
}

/** Inline lock-icon SVGs for the per-channel lock button (open = unlocked). */
const LOCK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const UNLOCK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-1.9"/></svg>';

/** Inline pencil icon for the per-channel rename (edit) button. */
const EDIT_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

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
