// The spreadsheet block inside a note: a Jspreadsheet grid for editing, with
// HyperFormula working out the formulas.
//
// The grid holds only the data rows. Total rows are drawn underneath by this file,
// pinned at the bottom, and their formulas are evaluated against the data rows only
// (so =SUM(C:C) never counts itself).

import jspreadsheet from 'jspreadsheet-ce';
import 'jsuites/dist/jsuites.css';
import 'jspreadsheet-ce/dist/jspreadsheet.css';
import 'jspreadsheet-ce/dist/jspreadsheet.themes.css';
import { HyperFormula } from 'hyperformula';
import { formatValue, FORMATS, isNumericLooking, toNumber } from '../lib/format.js';
import { sortRows, mapRowRefs } from '../lib/refs.js';
import { emptySheet } from '../lib/sheetmd.js';
import { esc } from '../lib/util.js';
import { icon } from '../ui/icons.js';
import { ask } from '../ui/dialogs.js';

const HF_CONFIG = {
  licenseKey: 'gpl-v3',
  currencySymbol: ['£', '$', '€'],
  decimalSeparator: '.',
  functionArgSeparator: ',',
  dateFormats: ['DD/MM/YYYY', 'DD/MM/YY', 'YYYY-MM-DD'],
  timeFormats: ['hh:mm', 'hh:mm:ss.sss'],
  nullDate: { year: 1899, month: 12, day: 30 },
  smartRounding: true,
  useArrayArithmetic: false,
};

const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const isFormula = v => typeof v === 'string' && v.trim().startsWith('=');
const clone = s => JSON.parse(JSON.stringify(s));

function normalise(data) {
  const s = data && Array.isArray(data.columns) && data.columns.length ? clone(data) : emptySheet();
  const w = Math.max(1, s.columns.length);
  const pad = r => { const x = (r || []).slice(0, w).map(v => (v == null ? '' : String(v))); while (x.length < w) x.push(''); return x; };
  s.columns = pad(s.columns).map((c, i) => c || `Column ${colName(i)}`);
  s.rows = (s.rows && s.rows.length ? s.rows : [[]]).map(pad);
  s.totals = (s.totals || []).map(pad);
  s.widths = Array.from({ length: w }, (_, i) => Number(s.widths?.[i]) || 0);
  s.formats = s.formats || {};
  return s;
}

export class SheetView {
  constructor({ data, editable, onChange }) {
    this.sheet = normalise(data);
    this.editable = editable;
    this.onChange = onChange;
    this.dom = document.createElement('div');
    this.dom.className = 'cb-sheet';
    this.dom.contentEditable = 'false';
    this.dom.innerHTML = `
      <div class="cb-sheet-bar">
        <span class="cb-sheet-label">${icon('sheet')}Spreadsheet</span>
        <label class="cb-sheet-search">${icon('search')}<input type="search" placeholder="Filter rows" aria-label="Filter rows"></label>
        ${editable ? `
        <button type="button" class="cb-sbtn" data-act="row" title="Add a row at the bottom">${icon('plus')}Row</button>
        <button type="button" class="cb-sbtn" data-act="col" title="Add a column on the right">${icon('plus')}Column</button>
        <button type="button" class="cb-sbtn" data-act="total" title="Add a total row">Σ Total row</button>
        <button type="button" class="cb-sbtn cb-sbtn-quiet" data-act="remove" title="Remove this spreadsheet">${icon('trash')}</button>` : ''}
        <span class="cb-sheet-count"></span>
      </div>
      <div class="cb-fx"><span class="cb-fx-ref"></span><span class="cb-fx-val"></span></div>
      <div class="cb-grid"></div>`;
    this.host = this.dom.querySelector('.cb-grid');
    this.fxRef = this.dom.querySelector('.cb-fx-ref');
    this.fxVal = this.dom.querySelector('.cb-fx-val');
    this.dom.querySelector('.cb-sheet-search input').addEventListener('input', e => this.filter(e.target.value));
    this.dom.querySelector('.cb-sheet-bar').addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) this.action(act);
    });
    this.hf = HyperFormula.buildFromArray([[]], HF_CONFIG);
    this.build();
  }

  // ------------------------------------------------------------ grid

  build() {
    if (this.jss) {
      try { jspreadsheet.destroy(this.host, true); } catch { /* ignore */ }
      this.host.innerHTML = '';
    }
    const s = this.sheet;
    const self = this;
    const defaultWidth = i => Math.max(90, Math.min(260, 24 + 8 * Math.max(s.columns[i].length, ...s.rows.map(r => String(r[i]).length).slice(0, 50))));
    this.jss = jspreadsheet(this.host, {
      worksheets: [{
        data: s.rows.map(r => r.slice()),
        columns: s.columns.map((title, i) => ({
          type: 'text',
          title,
          width: s.widths[i] || defaultWidth(i),
          align: this.alignFor(i),
          wordWrap: false,
          render: (td, value, x, y) => self.renderCell(td, value, x, y),
        })),
        minDimensions: [s.columns.length, 1],
        allowComments: false,
        columnSorting: false,
        columnDrag: false,
        rowDrag: this.editable,
        editable: this.editable,
        allowInsertRow: this.editable,
        allowInsertColumn: this.editable,
        allowDeleteRow: this.editable,
        allowDeleteColumn: this.editable,
        allowRenameColumn: this.editable,
        allowManualInsertRow: false,
        defaultColAlign: 'left',
        tableOverflow: false,
      }],
      parseFormulas: false,
      about: false,
      allowExport: false,
      onchange: () => this.changed(),
      onafterchanges: () => this.changed(),
      oninsertrow: () => this.changed(),
      ondeleterow: () => this.changed(),
      onmoverow: () => this.changed(),
      oninsertcolumn: () => this.changed({ columns: true }),
      ondeletecolumn: () => this.changed({ columns: true }),
      onchangeheader: () => this.changed(),
      onresizecolumn: () => this.changed({ widths: true }),
      onpaste: () => this.changed(),
      onundo: () => this.changed({ columns: true }),
      onredo: () => this.changed({ columns: true }),
      onselection: (ws, x1, y1) => this.showFx(x1, y1),
      onblur: () => this.showFx(null),
      contextMenu: (ws, x, y, e, items, role) => this.menu(x, y, role, items),
    });
    this.ws = this.jss[0];
    this.recalc();
  }

  alignFor(i) {
    const f = this.sheet.formats[i];
    if (f && f !== 'general' && f !== 'text') return 'right';
    const vals = this.sheet.rows.map(r => r[i]).filter(v => v !== '');
    return vals.length && vals.filter(v => isNumericLooking(v) || isFormula(v)).length / vals.length > 0.6 ? 'right' : 'left';
  }

  /** Read the grid back into this.sheet. */
  read({ columns = false, widths = false } = {}) {
    const s = this.sheet;
    const data = this.ws.getData().map(r => r.map(v => (v == null ? '' : String(v))));
    const headers = this.ws.getHeaders(true);
    const w = headers.length;
    s.columns = headers.map((h, i) => String(h ?? '') || `Column ${colName(i)}`);
    s.rows = data.length ? data : [Array(w).fill('')];
    if (columns || s.totals.some(r => r.length !== w)) {
      // Columns were added or removed: keep totals and formats lined up by position.
      s.totals = s.totals.map(r => { const x = r.slice(0, w); while (x.length < w) x.push(''); return x; });
    }
    if (widths || columns) {
      const ws = this.ws.getWidth();
      s.widths = (Array.isArray(ws) ? ws : []).map(v => Math.round(Number(v)) || 0);
    }
  }

  changed(opts = {}) {
    // Jspreadsheet fires several events for one action; gather them up.
    if (this.pending) { Object.assign(this.pendingOpts, opts); return; }
    this.pending = true;
    this.pendingOpts = { ...opts };
    queueMicrotask(() => {
      this.pending = false;
      this.read(this.pendingOpts);
      this.recalc();
      this.onChange?.(clone(this.sheet));
    });
  }

  // ------------------------------------------------------------ formulas and display

  recalc() {
    const s = this.sheet;
    try {
      this.hf.setSheetContent(0, this.hfData());
    } catch {
      this.hf = HyperFormula.buildFromArray(this.hfData(), HF_CONFIG);
    }
    for (let y = 0; y < s.rows.length; y++) {
      for (let x = 0; x < s.columns.length; x++) {
        const td = this.ws.records?.[y]?.[x]?.element;
        if (td) this.paint(td, s.rows[y][x], x, y);
      }
    }
    this.renderTotals();
    this.updateCount();
  }

  /** Data for the formula engine: typed numbers like "£1,234.50" become numbers. */
  hfData() {
    return this.sheet.rows.map(r => r.map(v => {
      if (v === '') return null;
      if (isFormula(v)) return v;
      const n = toNumber(v);
      return n === null ? v : n;
    }));
  }

  valueAt(x, y) {
    try { return this.hf.getCellValue({ sheet: 0, col: x, row: y }); } catch { return '#ERROR'; }
  }

  displayFor(raw, x, y) {
    const fmt = this.sheet.formats[x] || 'general';
    if (isFormula(raw)) {
      const v = this.valueAt(x, y);
      if (v && typeof v === 'object') return { text: v.value || '#ERROR', error: true, title: v.message };
      return { text: formatValue(v, fmt, { isFormula: true }), formula: true };
    }
    return { text: formatValue(raw, fmt) };
  }

  renderCell(td, value, x, y) {
    if (!td || !this.sheet) return;
    // Called by Jspreadsheet while it draws; the HyperFormula values may be a step
    // behind, so the full recalc after the change paints the final result.
    this.paint(td, value, x, y);
  }

  paint(td, raw, x, y) {
    const d = this.displayFor(raw, x, y);
    td.textContent = d.text;
    td.classList.toggle('cb-cell-formula', !!d.formula);
    td.classList.toggle('cb-cell-error', !!d.error);
    if (d.title) td.title = d.title; else td.removeAttribute('title');
  }

  renderTotals() {
    const s = this.sheet;
    const table = this.ws.table;
    let tfoot = table.querySelector('tfoot.cb-totals');
    if (!s.totals.length) { tfoot?.remove(); return; }
    if (!tfoot) {
      tfoot = document.createElement('tfoot');
      tfoot.className = 'cb-totals';
      table.appendChild(tfoot);
      tfoot.addEventListener('click', e => this.editTotal(e));
    }
    const cols = [...table.querySelectorAll('colgroup col')].slice(1);
    tfoot.innerHTML = s.totals.map((row, j) => `<tr>
      <td class="cb-total-index">${this.editable ? `<button type="button" class="cb-total-del" data-del="${j}" title="Remove this total row" aria-label="Remove total row">×</button>` : 'Σ'}</td>
      ${row.map((raw, i) => {
        let text = raw, cls = '', title = '';
        if (isFormula(raw)) {
          let v;
          try { v = this.hf.calculateFormula(raw, 0); } catch (e) { v = { value: '#ERROR', message: e.message }; }
          if (Array.isArray(v)) v = v[0]?.[0];
          if (v && typeof v === 'object') { text = v.value || '#ERROR'; cls = 'cb-cell-error'; title = v.message || ''; }
          else text = formatValue(v, s.formats[i] || 'general', { isFormula: true });
        }
        const hidden = cols[i] && cols[i].style.display === 'none' ? ' style="display:none"' : '';
        const align = this.alignFor(i) === 'right' || isFormula(raw) ? ' cb-right' : '';
        return `<td data-tx="${i}" data-ty="${j}" class="${cls}${align}"${title ? ` title="${esc(title)}"` : ''}${hidden}>${esc(text)}</td>`;
      }).join('')}
    </tr>`).join('');
  }

  editTotal(e) {
    if (!this.editable) return;
    const del = e.target.closest('[data-del]');
    if (del) {
      this.sheet.totals.splice(Number(del.dataset.del), 1);
      this.recalc();
      this.onChange?.(clone(this.sheet));
      return;
    }
    const td = e.target.closest('td[data-tx]');
    if (!td || td.querySelector('input')) return;
    const x = Number(td.dataset.tx), y = Number(td.dataset.ty);
    const raw = this.sheet.totals[y][x];
    const input = document.createElement('input');
    input.className = 'cb-total-input';
    input.value = raw;
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();
    this.showFx(x, null, raw, `Σ${y + 1}`);
    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      if (save && input.value !== raw) {
        this.sheet.totals[y][x] = input.value;
        this.onChange?.(clone(this.sheet));
      }
      this.renderTotals();
      this.showFx(null);
    };
    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  showFx(x, y, raw, ref) {
    if (x == null) {
      this.fxRef.textContent = '';
      this.fxVal.innerHTML = this.editable
        ? '<span class="cb-fx-hint">Click a cell to edit. Start with = for a formula, e.g. =SUM(C:C). Right-click for more options.</span>'
        : '';
      return;
    }
    const value = raw !== undefined ? raw : this.sheet.rows[y]?.[x] ?? '';
    this.fxRef.textContent = ref || `${colName(x)}${y + 1}`;
    this.fxVal.textContent = value;
  }

  updateCount() {
    const n = this.sheet.rows.length;
    const shown = this.filterText ? this.host.querySelectorAll('tbody tr:not([style*="display: none"])').length : n;
    this.dom.querySelector('.cb-sheet-count').textContent = this.filterText ? `${shown} of ${n} rows` : `${n} row${n === 1 ? '' : 's'}`;
  }

  // ------------------------------------------------------------ actions

  filter(text) {
    this.filterText = text.trim();
    if (this.filterText) this.ws.search(this.filterText); else this.ws.resetSearch();
    this.updateCount();
  }

  action(act) {
    const s = this.sheet;
    if (act === 'row') { this.ws.insertRow(1); return; }
    if (act === 'col') { this.ws.insertColumn(1); return; }
    if (act === 'total') {
      const label = s.totals.length ? 'Average' : 'Total';
      const fn = s.totals.length ? 'AVERAGE' : 'SUM';
      const row = s.columns.map((_, i) => {
        const vals = s.rows.map(r => r[i]).filter(v => v !== '');
        const numeric = vals.length && vals.every(v => isNumericLooking(v) || isFormula(v));
        return numeric ? `=${fn}(${colName(i)}:${colName(i)})` : '';
      });
      if (!row[0]) row[0] = label;
      s.totals.push(row);
      this.recalc();
      this.onChange?.(clone(s));
      return;
    }
    if (act === 'remove') this.onRemove?.();
  }

  sortBy(x, dir) {
    this.read();
    const s = this.sheet;
    const sorted = sortRows(s.rows, x, dir, (row, i) => (isFormula(row[x]) ? this.valueAt(x, i) : row[x]));
    s.rows = sorted;
    this.ws.setData(sorted.map(r => r.slice()));
    this.recalc();
    this.onChange?.(clone(s));
  }

  setFormat(x, id) {
    this.read();
    if (id === 'general') delete this.sheet.formats[x]; else this.sheet.formats[x] = id;
    this.build();
    this.onChange?.(clone(this.sheet));
  }

  menu(x, y, role, items) {
    if (!this.editable) return [];
    const ws = this.ws;
    const xi = x == null ? null : Number(x);
    const yi = y == null ? null : Number(y);
    const out = [];
    if (role === 'header' || role === 'cell') {
      if (xi != null) {
        out.push(
          { title: 'Sort A → Z, 1 → 9', onclick: () => this.sortBy(xi, 1) },
          { title: 'Sort Z → A, 9 → 1', onclick: () => this.sortBy(xi, -1) },
          { type: 'line' },
          { title: 'Number format', submenu: FORMATS.map(f => ({ title: (this.sheet.formats[xi] || 'general') === f.id ? `✓ ${f.label}` : f.label, onclick: () => this.setFormat(xi, f.id) })) },
          { title: 'Rename column…', onclick: async () => {
            const name = await ask({ title: 'Rename column', label: 'Column name', value: this.sheet.columns[xi], ok: 'Rename' });
            if (name != null) ws.setHeader(xi, name.trim() || `Column ${colName(xi)}`);
          } },
          { title: 'Insert column left', onclick: () => ws.insertColumn(1, xi, true) },
          { title: 'Insert column right', onclick: () => ws.insertColumn(1, xi, false) },
          { title: 'Delete column', onclick: () => { if (this.sheet.columns.length > 1) ws.deleteColumn(xi, 1); } },
        );
      }
    }
    if ((role === 'cell' || role === 'row') && yi != null) {
      out.push(
        { type: 'line' },
        { title: 'Insert row above', onclick: () => ws.insertRow(1, yi, true) },
        { title: 'Insert row below', onclick: () => ws.insertRow(1, yi, false) },
        { title: 'Delete row', onclick: () => { if (this.sheet.rows.length > 1) ws.deleteRow(yi, 1); else ws.setRowData(0, Array(this.sheet.columns.length).fill('')); } },
      );
    }
    if (role === 'cell') {
      out.push({ type: 'line' }, { title: 'Copy', shortcut: '⌘C', onclick: () => ws.copy() });
    }
    return out.length ? out : items.filter(i => !/save|about/i.test(i?.title || ''));
  }

  // ------------------------------------------------------------ outside updates

  /** Replace the contents (e.g. after undo in the editor). */
  setData(data) {
    const next = normalise(data);
    if (JSON.stringify(next) === JSON.stringify(this.sheet)) return;
    this.sheet = next;
    this.build();
  }

  destroy() {
    try { jspreadsheet.destroy(this.host, true); } catch { /* ignore */ }
    try { this.hf.destroy(); } catch { /* ignore */ }
  }
}

export { mapRowRefs };
