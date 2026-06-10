/**
 * fileLoader.js — Drag-and-drop + file-input handling.
 *
 * Responsibility is narrow: turn user gestures into validated File objects and
 * hand them to a callback. It knows nothing about decoding or rendering.
 */

import { ACCEPTED_TYPES } from '../config.js';

/**
 * Wire a single element as a drop target + click-to-browse file input. Reusable
 * for each channel/mask slot (multiple = false) or a shared zone (multiple = true).
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.dropZone   - element that accepts drops & clicks
 * @param {HTMLInputElement} opts.fileInput - <input type="file">
 * @param {(file: File) => void} opts.onFile - called per accepted file
 * @param {(message: string) => void} [opts.onError]
 * @param {boolean} [opts.multiple=true] - accept many files, or just the first
 * @param {string[]} [opts.accept] - allowed extensions (default: image types)
 */
export function wireDropZone({ dropZone, fileInput, onFile, onError = () => {}, multiple = true, accept }) {
  const exts = accept || ACCEPTED_TYPES.extensions;
  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const batch = multiple ? files : files.slice(0, 1);
    for (const file of batch) {
      if (isAccepted(file, exts)) onFile(file);
      else onError(`Unsupported file: ${file.name}`);
    }
  };

  // Click-to-browse
  if (fileInput) {
    if (accept) fileInput.accept = accept.join(','); // hint the browse dialog
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      handleFiles(fileInput.files);
      fileInput.value = ''; // allow re-selecting the same file
    });
  }

  // Drag & drop
  ['dragenter', 'dragover'].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('is-dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('is-dragover');
    })
  );
  dropZone.addEventListener('drop', (e) => {
    handleFiles(e.dataTransfer && e.dataTransfer.files);
  });
}

/** @deprecated kept as a thin alias; new code uses {@link wireDropZone}. */
export const initFileLoader = wireDropZone;

/** @param {File} file @param {string[]} [exts] */
export function isAccepted(file, exts = ACCEPTED_TYPES.extensions) {
  const name = file.name.toLowerCase();
  return exts.some((ext) => name.endsWith(ext));
}

/** @param {File} file */
export function isTiff(file) {
  const name = file.name.toLowerCase();
  return ACCEPTED_TYPES.tiff.some((ext) => name.endsWith(ext));
}
