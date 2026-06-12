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

/** True when focus is in a control that should receive the keystroke itself. */
function isTypingTarget(node) {
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}
