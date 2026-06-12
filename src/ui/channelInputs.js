/**
 * channelInputs.js — Builds the R / G / B / Gray channel slots and the AOI-mask
 * slot, and owns each channel's style: MARKER colour (the picker controls marker/
 * dot colour only — the composite display colour is fixed at the config default,
 * Phase 4), opacity, and visibility, plus the global blend mode. Generated from
 * config (CHANNELS, ROI_INPUT, COMPOSITE).
 *
 * Two kinds of event are emitted, kept separate on purpose:
 *   • onFile / onClear — a channel's IMAGE DATA changed → caller re-composites
 *                        AND re-detects.
 *   • onComposite      — only a DISPLAY setting changed (colour/opacity/
 *                        visibility/mode) → caller re-composites, no detection.
 *
 * The module holds no pixel data; it just reports files and exposes the current
 * compositing settings via getCompositeSettings().
 */

import { CHANNELS, ROI_INPUT, COMPOSITE } from '../config.js';
import { wireDropZone } from '../core/fileLoader.js';

/**
 * @param {HTMLElement} container
 * @param {Object} cb
 * @param {(key: string, file: File) => void} cb.onFile
 * @param {(key: string) => void} [cb.onClear]
 * @param {() => void} [cb.onComposite] - a display-only setting changed
 * @param {(message: string) => void} [cb.onError]
 * @returns {{
 *   setStatus: (key: string, text: string, isError?: boolean) => void,
 *   getCompositeSettings: () => { styles: Record<string, {color:string,opacity:number,visible:boolean}>, mode: string },
 * }}
 */
export function initChannelInputs(container, { onFile, onClear = () => {}, onComposite = () => {}, onError = () => {} }) {
  /** @type {Record<string, {color:string,opacity:number,visible:boolean}>} */
  const styles = {};
  let mode = COMPOSITE.defaultMode;
  /** @type {Record<string, HTMLElement>} */
  const statusEls = {};
  /** Per-channel visibility widgets, so the keyboard shortcuts can drive them. */
  /** @type {Record<string, { slot: HTMLElement, eye: HTMLInputElement }>} */
  const visUI = {};

  // ---- Global blend-mode selector (display-only) ----
  const modeWrap = el('div', 'control composite-mode');
  const modeLabel = el('label');
  modeLabel.textContent = 'Composite mode';
  const modeSelect = el('select');
  for (const opt of COMPOSITE.modes) {
    const o = el('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === mode) o.selected = true;
    modeSelect.appendChild(o);
  }
  modeSelect.addEventListener('change', () => {
    mode = modeSelect.value;
    onComposite();
  });
  modeWrap.append(modeLabel, modeSelect);
  container.appendChild(modeWrap);

  // ---- One slot per channel, plus the ROI ----
  for (const def of [...CHANNELS, ROI_INPUT]) {
    const isRoi = def.key === ROI_INPUT.key;
    if (!isRoi) {
      styles[def.key] = { color: def.defaultColor, opacity: COMPOSITE.defaultOpacity, visible: true };
    }

    const slot = el('div', 'channel-slot');
    slot.dataset.key = def.key;
    if (def.defaultColor) slot.style.setProperty('--slot-color', def.defaultColor);

    // Top row: drop target + clear button.
    const main = el('div', 'channel-slot__main');
    const drop = el('div', 'channel-slot__drop');
    const swatch = el('span', 'channel-slot__swatch');
    const text = el('div', 'channel-slot__text');
    const label = el('span', 'channel-slot__label');
    label.textContent = def.label;
    const status = el('span', 'channel-slot__status');
    status.textContent = 'drop file or click';
    text.append(label, status);
    drop.append(swatch, text);

    const input = el('input');
    input.type = 'file';
    input.hidden = true;

    const clear = el('button', 'channel-slot__clear');
    clear.type = 'button';
    clear.textContent = '×'; // ×
    clear.title = `Clear ${def.label}`;
    clear.hidden = true;
    main.append(drop, clear);
    slot.append(main, input);
    statusEls[def.key] = status;

    // Style row (channels only — the ROI has no colour/opacity/visibility).
    if (!isRoi) {
      const style = styles[def.key];
      const styleRow = el('div', 'channel-slot__style');

      const color = el('input', 'channel-slot__color');
      color.type = 'color';
      color.value = style.color;
      // Picker controls MARKER colour only — the composite display colour is fixed
      // at the channel's config default (Phase 4). See composite.js / overlay.js.
      color.title = 'Marker colour (composite colour is fixed)';
      color.addEventListener('input', () => {
        style.color = color.value;
        slot.style.setProperty('--slot-color', color.value);
        onComposite(); // repaints markers in the new colour (composite unchanged)
      });

      const opacity = el('input', 'channel-slot__opacity');
      opacity.type = 'range';
      opacity.min = 0;
      opacity.max = 100;
      opacity.step = 1;
      opacity.value = style.opacity;
      opacity.title = 'Opacity';
      opacity.addEventListener('input', () => {
        style.opacity = Number(opacity.value);
        onComposite();
      });

      const eyeLabel = el('label', 'channel-slot__eye');
      const eye = el('input');
      eye.type = 'checkbox';
      eye.checked = style.visible;
      eye.title = 'Visible in composite';
      eye.addEventListener('change', () => {
        style.visible = eye.checked;
        slot.classList.toggle('is-hidden', !eye.checked);
        onComposite();
      });
      eyeLabel.append(eye);
      visUI[def.key] = { slot, eye };

      styleRow.append(color, opacity, eyeLabel);
      slot.append(styleRow);
    }

    container.appendChild(slot);

    clear.addEventListener('click', (e) => {
      e.stopPropagation(); // don't trigger the drop zone's click-to-browse
      slot.classList.remove('is-loaded');
      clear.hidden = true;
      status.textContent = 'drop file or click';
      onClear(def.key);
    });

    wireDropZone({
      dropZone: drop,
      fileInput: input,
      multiple: false,
      accept: def.accept, // ROI slot → ['.roi']; channels → default image types
      onError,
      onFile: (file) => {
        slot.classList.add('is-loaded');
        clear.hidden = false;
        status.textContent = file.name;
        onFile(def.key, file);
      },
    });
  }

  return {
    setStatus(key, text, isError = false) {
      const node = statusEls[key];
      if (!node) return;
      node.textContent = text;
      node.classList.toggle('is-error', isError);
    },
    getCompositeSettings() {
      return { styles, mode };
    },
    /**
     * Flip a channel's visibility (keyboard shortcut path). Updates the state,
     * the eye checkbox, and the slot's dimmed style, then fires onComposite so the
     * caller repaints — exactly as clicking the eye toggle does.
     */
    toggleVisibility(key) {
      const ui = visUI[key];
      if (!ui || !styles[key]) return;
      const visible = !styles[key].visible;
      styles[key].visible = visible;
      ui.eye.checked = visible;
      ui.slot.classList.toggle('is-hidden', !visible);
      onComposite();
    },
  };
}

/** Tiny element helper (mirrors controls.js). */
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
