/**
 * resultsTable.js — A click-to-view modal that overlays a neat summary table of
 * the detection results (Phase 10).
 *
 * Stateless renderer: it owns the modal DOM (built once, then shown/hidden) but
 * holds no app state. main.js assembles a plain "report" object and hands it to
 * open(); this module just renders it. Colours are pre-resolved by the caller, so
 * there is no business logic here.
 *
 * Report shape (`label`, `channel` and `colocalizedWith` arrive as display names —
 * EdU / GFP / DAPI / CC1 — already resolved from the channel keys by main.js):
 *   {
 *     total: number,
 *     aoiArea: number|null,
 *     channels: [{ key, label, color, count }],
 *     combos:   [{ key, label, color, count }],   // co-localization combinations
 *     cells:    [{ id, channel, x, y, intensity, colocalizedWith }],
 *   }
 */

/**
 * @returns {{ open: (report: object) => void, close: () => void }}
 */
export function createResultsModal() {
  const overlay = el('div', 'modal-overlay');
  overlay.hidden = true;

  const dialog = el('div', 'modal');
  const header = el('div', 'modal__header');
  const title = el('h2', 'modal__title');
  title.textContent = 'Results';
  const closeBtn = el('button', 'modal__close');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  header.append(title, closeBtn);

  const body = el('div', 'modal__body');
  dialog.append(header, body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function close() {
    overlay.hidden = true;
  }
  closeBtn.addEventListener('click', close);
  // Click the backdrop (but not the dialog) to dismiss; Esc also closes.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });

  function open(report) {
    body.textContent = '';

    // Headline: total + AOI area.
    const summary = el('p', 'modal__summary');
    summary.innerHTML = `<strong>${report.total}</strong> cells detected`;
    if (report.aoiArea != null) {
      summary.innerHTML += ` · AOI area ${report.aoiArea.toLocaleString()} px`;
    }
    body.appendChild(summary);

    // Per-channel counts.
    body.appendChild(
      countTable('By channel', ['Channel', 'Count'], report.channels)
    );
    // Per-combination counts (only if any combos exist).
    if (report.combos && report.combos.length) {
      body.appendChild(
        countTable('Co-localization', ['Combination', 'Count'], report.combos)
      );
    }

    // Full per-cell table (scrollable).
    body.appendChild(cellTable(report.cells));

    overlay.hidden = false;
  }

  return { open, close };
}

/** A small two-column count table with a colour dot per row. */
function countTable(caption, [c0, c1], rows) {
  const section = el('div', 'modal__section');
  const h = el('h3', 'modal__subhead');
  h.textContent = caption;
  section.appendChild(h);

  const table = el('table', 'result-table');
  table.appendChild(rowEl('th', [c0, c1]));
  for (const r of rows) {
    table.appendChild(rowEl('td', [labelWithDot(r.color, r.label), String(r.count)]));
  }
  section.appendChild(table);
  return section;
}

/** The full per-cell table, scrollable for large counts. */
function cellTable(cells) {
  const section = el('div', 'modal__section');
  const h = el('h3', 'modal__subhead');
  h.textContent = `All cells (${cells.length})`;
  section.appendChild(h);

  const scroll = el('div', 'result-table__scroll');
  const table = el('table', 'result-table');
  table.appendChild(rowEl('th', ['#', 'Channel', 'x', 'y', 'Intensity', 'Co-localized with']));
  for (const c of cells) {
    table.appendChild(
      rowEl('td', [
        String(c.id),
        c.channel,
        String(c.x),
        String(c.y),
        c.intensity === '' || c.intensity == null ? '—' : String(c.intensity),
        c.colocalizedWith || '—',
      ])
    );
  }
  scroll.appendChild(table);
  section.appendChild(scroll);
  return section;
}

/** Build a <tr> of the given cell tag, where each value is text or a Node. */
function rowEl(tag, values) {
  const tr = el('tr');
  for (const v of values) {
    const cell = el(tag);
    if (v instanceof Node) cell.appendChild(v);
    else cell.textContent = v;
    tr.appendChild(cell);
  }
  return tr;
}

/** A coloured dot followed by a label, as a document fragment. */
function labelWithDot(color, label) {
  const frag = document.createDocumentFragment();
  const dot = el('span', 'result-dot');
  dot.style.background = color;
  frag.append(dot, document.createTextNode(label));
  return frag;
}

/** Tiny element helper (mirrors the other ui modules). */
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
