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
import { emptySheet, isAutoName } from '../lib/sheetmd.js';
import { catalogue } from '../lib/functions.js';
import { FormulaHelper, callAtCaret } from './formula-help.js';
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

// One formula helper shared by every spreadsheet, listing the functions the engine supports.
let helper = null;
function formulaHelper() {
  if (!helper) {
    let names = [];
    try { names = HyperFormula.getRegisteredFunctionNames('enGB'); } catch { /* use our own list */ }
    helper = new FormulaHelper(catalogue(names));
  }
  return helper;
}

// Formula results the engine knows are dates or times show as such in "General" format.
const DATE_KIND = { NUMBER_DATE: 'date', NUMBER_TIME: 'time', NUMBER_DATETIME: 'datetime' };

const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const isFormula = v => typeof v === 'string' && v.trim().startsWith('=');
const clone = s => JSON.parse(JSON.stringify(s));

function normalise(data) {
  const s = data && Array.isArray(data.columns) && data.columns.length ? clone(data) : emptySheet();
  const w = Math.max(1, s.columns.length);
  const pad = r => { const x = (r || []).slice(0, w).map(v => (v == null ? '' : String(v))); while (x.length < w) x.push(''); return x; };
  s.columns = pad(s.columns).map((c, i) => (isAutoName(c, i) ? '' : c));
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
      <div class="cb-fx">
        <span class="cb-fx-ref"></span>
        ${editable ? '<button type="button" class="cb-fx-btn" title="Insert a function" aria-label="Insert a function"><i>f</i>x</button>' : ''}
        <textarea class="cb-fx-input" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Cell contents" ${editable ? '' : 'readonly'}></textarea>
      </div>
      <div class="cb-fx-sig" hidden></div>
      <div class="cb-grid"></div>`;
    this.host = this.dom.querySelector('.cb-grid');
    this.fxRef = this.dom.querySelector('.cb-fx-ref');
    this.fxInput = this.dom.querySelector('.cb-fx-input');
    this.fxSig = this.dom.querySelector('.cb-fx-sig');
    this.sel = null;          // { kind: 'cell' | 'total', x, y }
    this.bindFormulaBar();
    this.dom.querySelector('.cb-sheet-search input').addEventListener('input', e => this.filter(e.target.value));
    this.dom.querySelector('.cb-sheet-bar').addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) this.action(act);
    });
    this.hf = HyperFormula.buildFromArray([[]], HF_CONFIG);
    this.build();
    this.showFx(null);
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
          title: title || '',
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
      onselection: (ws, x1, y1) => { this.sel = { kind: 'cell', x: Number(x1), y: Number(y1) }; this.showFx(); },
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
    const w = this.ws.getHeaders(true).length;
    // Names come from the column settings; the grid shows a letter where there's no name.
    s.columns = Array.from({ length: w }, (_, i) => {
      const t = String(this.ws.options.columns?.[i]?.title ?? '');
      return isAutoName(t, i) ? '' : t;
    });
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
    if (document.activeElement !== this.fxInput) this.showFx();
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
      let f = fmt;
      if (f === 'general' && typeof v === 'number') {
        try { f = DATE_KIND[this.hf.getCellValueDetailedType({ sheet: 0, col: x, row: y })] || f; } catch { /* keep general */ }
      }
      return { text: formatValue(v, f, { isFormula: true }), formula: true };
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
    this.sel = { kind: 'total', x, y };
    this.showFx();
    formulaHelper().watch(input, { onChange: () => this.mirror(input) });
    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      if (save && input.value !== raw) {
        this.sheet.totals[y][x] = input.value;
        this.onChange?.(clone(this.sheet));
      }
      this.renderTotals();
      this.showFx();
    };
    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ------------------------------------------------------------ formula bar

  rawAt(sel) {
    if (!sel) return '';
    if (sel.kind === 'total') return this.sheet.totals[sel.y]?.[sel.x] ?? '';
    return this.sheet.rows[sel.y]?.[sel.x] ?? '';
  }

  bindFormulaBar() {
    const fx = this.fxInput;
    const help = formulaHelper();
    help.watch(fx, { onChange: () => { this.autosize(); this.showSignature(fx); } });
    let original = '';
    let cancelled = false;
    fx.addEventListener('focus', () => {
      if (!this.sel) {
        // Nothing selected yet: start at the first cell.
        this.sel = { kind: 'cell', x: 0, y: 0 };
        this.showFx();
      }
      original = fx.value;
      cancelled = false;
    });
    fx.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.commitFx(); fx.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; fx.value = original; fx.blur(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.commitFx(); fx.blur(); }
    });
    fx.addEventListener('blur', () => {
      if (!cancelled) this.commitFx();
      cancelled = false;
      this.fxSig.hidden = true;
    });
    fx.addEventListener('click', () => this.showSignature(fx));
    fx.addEventListener('keyup', () => this.showSignature(fx));
    this.dom.querySelector('.cb-fx-btn')?.addEventListener('click', e => {
      if (!this.sel) this.sel = { kind: 'cell', x: 0, y: 0 };
      const keep = this.sel;
      help.browse(e.currentTarget, f => {
        this.sel = keep;
        this.showFx();
        let v = fx.value;
        let caret = fx.selectionStart ?? v.length;
        if (!v.trim().startsWith('=')) { v = '='; caret = 1; }
        const insert = f.name + '(';
        fx.focus();
        fx.value = v.slice(0, caret) + insert + v.slice(caret);
        const at = caret + insert.length;
        fx.setSelectionRange(at, at);
        this.autosize();
        this.showSignature(fx);
      });
    });
    // Typing straight into a cell: suggest functions there too, and show it in the bar.
    this.host.addEventListener('focusin', e => {
      const t = e.target;
      if (t.matches?.('input, textarea') && t.closest('td')) help.watch(t, { onChange: () => this.mirror(t) });
    });
  }

  mirror(el) {
    this.fxInput.value = el.value;
    this.autosize();
    this.showSignature(el);
  }

  commitFx() {
    const sel = this.sel;
    if (!sel || !this.editable) return;
    const value = this.fxInput.value.replace(/\r?\n/g, ' ');
    if (value === this.rawAt(sel)) return;
    if (sel.kind === 'total') {
      this.sheet.totals[sel.y][sel.x] = value;
      this.recalc();
      this.onChange?.(clone(this.sheet));
    } else {
      this.ws.setValueFromCoords(sel.x, sel.y, value, true);
      try { this.ws.updateSelectionFromCoords(sel.x, sel.y, sel.x, sel.y); } catch { /* ignore */ }
    }
  }

  showSignature(el) {
    const f = formulaHelper().describe(callAtCaret(el.value, el.selectionStart ?? el.value.length));
    if (!f) { this.fxSig.hidden = true; return; }
    this.fxSig.innerHTML = `<span class="cb-fn-syntax">${esc(f.syntax)}</span>${f.text ? ` <span class="cb-fn-text">${esc(f.text)}</span>` : ''}`;
    this.fxSig.hidden = false;
  }

  autosize() {
    const fx = this.fxInput;
    fx.style.height = 'auto';
    fx.style.height = Math.min(160, fx.scrollHeight) + 'px';
  }

  showFx() {
    const sel = this.sel;
    if (!sel) {
      this.fxRef.textContent = '';
      this.fxInput.value = '';
      this.fxInput.placeholder = this.editable ? 'Select a cell, then type here or in the cell. Start with = for a formula.' : '';
      this.autosize();
      return;
    }
    this.fxRef.textContent = sel.kind === 'total' ? `Σ${colName(sel.x)}` : `${colName(sel.x)}${sel.y + 1}`;
    this.fxInput.placeholder = '';
    this.fxInput.value = this.rawAt(sel);
    this.autosize();
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
    // Sort by what the cells show: formula results, and typed dates as dates.
    const sorted = sortRows(s.rows, x, dir, (row, i) => (row[x] === '' ? '' : this.valueAt(x, i)));
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
          { title: 'Format', submenu: FORMATS.map(f => ({ title: (this.sheet.formats[xi] || 'general') === f.id ? `✓ ${f.label}` : f.label, onclick: () => this.setFormat(xi, f.id) })) },
          { title: 'Name column…', onclick: async () => {
            const name = await ask({ title: `Name column ${colName(xi)}`, label: 'Column name', value: this.sheet.columns[xi], ok: 'Save', help: 'Leave it empty to show the column letter.' });
            if (name == null) return;
            this.read();
            this.sheet.columns[xi] = isAutoName(name, xi) ? '' : name.trim();
            this.build();
            this.onChange?.(clone(this.sheet));
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
