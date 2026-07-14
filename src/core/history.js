/**
 * history.js — A generic undo/redo stack of state SNAPSHOTS (Phase 14A).
 *
 * Pure data structure: it knows nothing about markers, ROIs, or the DOM — it just
 * holds opaque snapshot objects the caller hands it. main.js owns what a snapshot
 * IS (see editSnapshot/restoreEdit there); this module only owns the stack.
 *
 * SNAPSHOTS, NOT INVERSE COMMANDS — deliberate. The undoable state is tiny (a few
 * hundred numbers: per-channel manual markers, exclusion indices, the ROI
 * transform), so storing the whole thing before each edit is cheap. The
 * alternative — a correct inverse for every edit type, including an
 * "insert back at index i" path so marker number labels don't renumber, and a
 * bespoke inverse for "Reset" (which wipes everything at once) — is far more code
 * and far more ways to be subtly wrong. A snapshot restore is ONE path for all of
 * them and gets index order right by construction.
 *
 * Usage:
 *   history.push(snapshotOfStateBEFOREtheEdit)   // then perform the edit
 *   const prev = history.undo(currentSnapshot);  // → restore prev, or null if empty
 *   const next = history.redo(currentSnapshot);  // → restore next, or null if empty
 *
 * push() clears the redo stack (standard semantics: once you edit, the future you
 * undid away is gone).
 */

/**
 * @param {Object} [opts]
 * @param {number} [opts.limit=50] - max undo entries; the oldest is dropped past this.
 * @param {() => void} [opts.onChange] - fired whenever canUndo()/canRedo() may have changed.
 */
export function createHistory({ limit = 50, onChange = () => {} } = {}) {
  /** @type {any[]} */ let undoStack = [];
  /** @type {any[]} */ let redoStack = [];

  return {
    /** Record the state BEFORE an edit. Clears the redo stack. */
    push(snapshot) {
      undoStack.push(snapshot);
      if (undoStack.length > limit) undoStack.shift(); // drop the oldest
      redoStack = [];
      onChange();
    },

    /**
     * Pop the previous state and return it (or null when there's nothing to undo).
     * `current` — the state as it is right now — goes onto the redo stack.
     */
    undo(current) {
      if (!undoStack.length) return null;
      const prev = undoStack.pop();
      redoStack.push(current);
      onChange();
      return prev;
    },

    /** Mirror of undo(): re-apply the state that was last undone, or null. */
    redo(current) {
      if (!redoStack.length) return null;
      const next = redoStack.pop();
      undoStack.push(current);
      onChange();
      return next;
    },

    /**
     * Rewrite every stored snapshot in place: map(fn) replaces each entry with
     * fn(entry). Used to strip state that has gone STALE without discarding the
     * stack — see main.js's re-detection rule, where exclusion indices stop
     * pointing at the cells they were captured against but manual markers and the
     * ROI transform are still perfectly undoable.
     */
    map(fn) {
      undoStack = undoStack.map(fn);
      redoStack = redoStack.map(fn);
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    size: () => undoStack.length,

    clear() {
      undoStack = [];
      redoStack = [];
      onChange();
    },
  };
}
