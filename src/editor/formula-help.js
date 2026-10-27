// Formula helper: while typing a formula, suggests matching functions; also a
// searchable list of every function, and a hint showing the arguments of the
// function the caret is in.

import { searchFunctions, functionAtCaret, GROUPS } from '../lib/functions.js';
import { esc } from '../lib/util.js';

/** The function whose brackets the caret is inside, e.g. "=ROUND(SUM(A:A), |" → ROUND. */
export function callAtCaret(text, caret) {
  const s = String(text).slice(0, caret);
  if (!s.trim().startsWith('=')) return null;
  let depth = 0, inQuote = false;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const m = s.slice(0, i).match(/([A-Za-z][A-Za-z0-9.]*)$/);
        return m ? m[1].toUpperCase() : null;
      }
      depth--;
    }
  }
  return null;
}

function itemHtml(f, i, sel) {
  return `<button type="button" class="cb-fn-item${i === sel ? ' is-sel' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">
    <span class="cb-fn-syntax">${esc(f.syntax)}</span>
    ${f.text ? `<span class="cb-fn-text">${esc(f.text)}</span>` : ''}
  </button>`;
}

export class FormulaHelper {
  constructor(list) {
    this.list = list;
    this.byName = new Map(list.map(f => [f.name, f]));
    this.pop = null;
    this.watched = new WeakSet();
  }

  describe(name) { return name ? this.byName.get(name.toUpperCase()) || null : null; }

  /** Suggest functions while typing in `el` (an input or textarea). */
  watch(el, { onChange } = {}) {
    if (this.watched.has(el)) return;
    this.watched.add(el);
    const update = () => this.update(el);
    el.addEventListener('input', () => { update(); onChange?.(); });
    el.addEventListener('click', update);
    el.addEventListener('keyup', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) update(); });
    el.addEventListener('blur', () => setTimeout(() => { if (this.target === el) this.hide(); }, 120));
    // Runs before the grid's own keyboard handling (which listens on the document).
    el.addEventListener('keydown', e => {
      if (!this.pop || this.target !== el) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        this.move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        this.apply(this.results[this.sel]);
      } else if (e.key === 'Escape') {
        this.hide();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  update(el) {
    const ctx = functionAtCaret(el.value, el.selectionStart ?? el.value.length);
    if (!ctx) { if (this.target === el) this.hide(); return; }
    const results = searchFunctions(this.list, ctx.prefix, 40);
    if (!results.length || (results.length === 1 && results[0].name === ctx.prefix.toUpperCase() && el.value[ctx.end] === '(')) {
      this.hide();
      return;
    }
    this.target = el;
    this.ctx = ctx;
    this.results = results;
    this.sel = 0;
    this.render();
  }

  render() {
    if (!this.pop) {
      this.pop = document.createElement('div');
      this.pop.className = 'cb-fn-pop';
      this.pop.setAttribute('role', 'listbox');
      this.pop.addEventListener('mousedown', e => e.preventDefault());     // keep typing focus
      this.pop.addEventListener('click', e => {
        const b = e.target.closest('[data-i]');
        if (b) this.apply(this.results[Number(b.dataset.i)]);
      });
      document.body.appendChild(this.pop);
    }
    this.pop.innerHTML = this.results.map((f, i) => itemHtml(f, i, this.sel)).join('');
    const r = this.target.getBoundingClientRect();
    const w = Math.min(420, innerWidth - 16);
    this.pop.style.width = w + 'px';
    this.pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    const below = r.bottom + 4;
    const h = Math.min(300, this.pop.scrollHeight);
    this.pop.style.top = (below + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : below) + 'px';
    this.pop.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }

  move(d) {
    this.sel = (this.sel + d + this.results.length) % this.results.length;
    this.render();
  }

  apply(f) {
    const el = this.target;
    if (!f || !el) return;
    const { start, end } = this.ctx;
    const hasBracket = el.value[end] === '(';
    const insert = f.name + (hasBracket ? '' : '(');
    el.value = el.value.slice(0, start) + insert + el.value.slice(end);
    const caret = start + insert.length + (hasBracket ? 1 : 0);
    el.setSelectionRange(caret, caret);
    this.hide();
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  hide() {
    this.pop?.remove();
    this.pop = null;
    this.target = null;
  }

  /** A searchable list of every function, grouped. Calls onPick(fn). */
  browse(anchor, onPick) {
    this.hide();
    document.querySelector('.cb-fn-browse')?.remove();
    const box = document.createElement('div');
    box.className = 'cb-fn-pop cb-fn-browse';
    box.innerHTML = `
      <div class="cb-fn-search"><input type="search" placeholder="Search functions, e.g. date, lookup, round" aria-label="Search functions"></div>
      <div class="cb-fn-list" role="listbox"></div>`;
    document.body.appendChild(box);
    const input = box.querySelector('input');
    const listEl = box.querySelector('.cb-fn-list');
    let shown = [];
    let sel = 0;
    const draw = () => {
      const q = input.value.trim();
      if (q) {
        shown = searchFunctions(this.list, q, 200);
        listEl.innerHTML = shown.map((f, i) => itemHtml(f, i, sel)).join('') || '<p class="cb-fn-none">No functions match.</p>';
      } else {
        shown = [];
        listEl.innerHTML = GROUPS.map(g => {
          const fs = this.list.filter(f => f.group === g);
          if (!fs.length) return '';
          return `<div class="cb-fn-group">${esc(g)}</div>` + fs.map(f => { shown.push(f); return itemHtml(f, shown.length - 1, sel); }).join('');
        }).join('');
      }
      listEl.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
    };
    const r = anchor.getBoundingClientRect();
    const w = Math.min(460, innerWidth - 16);
    box.style.width = w + 'px';
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    box.style.top = Math.min(r.bottom + 4, innerHeight - 340) + 'px';
    const close = () => { box.remove(); document.removeEventListener('mousedown', away, true); };
    const pick = f => { if (f) { close(); onPick(f); } };
    const away = e => { if (!box.contains(e.target) && e.target !== anchor) close(); };
    document.addEventListener('mousedown', away, true);
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(shown.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); draw(); }
      if (e.key === 'Enter') { e.preventDefault(); pick(shown[sel]); }
      if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); }
    });
    listEl.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(shown[Number(b.dataset.i)]); });
    draw();
    input.focus();
  }
}
