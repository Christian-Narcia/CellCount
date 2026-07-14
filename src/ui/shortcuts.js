/**
 * shortcuts.js — Keyboard shortcuts for channel visibility (Phase 11).
 *
 * Simple-toggle behaviour: each mapped key flips one channel on/off, independent
 * of the others (no solo mode). The key→channel map is config-driven (CHANNELS'
 * `shortcutKey`), so e.g. R/G/B/Y map to r/g/b/gray.
 *
 * Stateless: it holds no visibility state — it just calls `toggle(channelKey)` and
 * lets the channel inputs own the state + UI. Keys are ignored while the user is
 * typing in a field, and when a modifier (Ctrl/Alt/Meta) is held, so they never
 * clash with browser/OS shortcuts.
 */

/**
 * @param {Object} deps
 * @param {Record<string, string>} deps.keyMap - keyboard key (lowercase) → channel key
 * @param {(channelKey: string) => boolean} [deps.isLoaded] - skip keys for unloaded channels
 * @param {(channelKey: string) => void} deps.toggle - flip a channel's visibility
 * @param {Document|HTMLElement} [target]
 * @returns {{ destroy: () => void }}
 */
export function createChannelShortcuts({ keyMap, isLoaded = () => true, toggle }, target = document) {
  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave combos to the browser/OS
    if (isTypingTarget(e.target)) return; // don't hijack text/slider input
    const channelKey = keyMap[e.key.toLowerCase()];
    if (!channelKey || !isLoaded(channelKey)) return;
    e.preventDefault();
    toggle(channelKey);
  }
  target.addEventListener('keydown', onKeydown);
  return { destroy: () => target.removeEventListener('keydown', onKeydown) };
}

/**
 * Undo/redo keys (Phase 14A) — Ctrl+Z / Cmd+Z, and Ctrl+Shift+Z / Ctrl+Y for redo.
 *
 * A SEPARATE listener from createChannelShortcuts on purpose: that one returns early
 * whenever Ctrl/Meta is held (it deliberately leaves modifier combos to the browser),
 * so undo can't be a branch inside it.
 *
 * Typing guard: inside a text field (e.g. the ROI rotation input) Ctrl+Z must stay the
 * browser's NATIVE text undo — we don't preventDefault there, and we don't undo.
 *
 * @param {Object} deps
 * @param {() => void} deps.onUndo
 * @param {() => void} [deps.onRedo] - wired in Phase 14B; harmless to leave unset.
 * @param {Document|HTMLElement} [target]
 * @returns {{ destroy: () => void }}
 */
export function createEditShortcuts({ onUndo, onRedo = () => {} }, target = document) {
  function onKeydown(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (isTypingTarget(e.target)) return; // let the field handle its own undo
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      onUndo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      onRedo();
    }
  }
  target.addEventListener('keydown', onKeydown);
  return { destroy: () => target.removeEventListener('keydown', onKeydown) };
}

/** True when focus is in a control that should receive the keystroke itself. */
export function isTypingTarget(node) {
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}
