// Small in-page dialogs (the browser's prompt/confirm look out of place).

import { esc } from '../lib/util.js';

function open(html, { onOpen } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'cb-modal';
  wrap.innerHTML = `<div class="cb-modal-box" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const prev = document.activeElement;
  const close = () => { wrap.remove(); try { prev?.focus?.(); } catch { /* ignore */ } };
  onOpen?.(wrap, close);
  return { wrap, close };
}

/** Ask for a line of text. Resolves to the text, or null if cancelled. */
export function ask({ title, label, value = '', ok = 'OK', placeholder = '', help = '' }) {
  return new Promise(resolve => {
    open(`
      <form class="cb-form">
        <h3>${esc(title)}</h3>
        <label class="cb-field"><span>${esc(label)}</span>
          <input name="v" autocomplete="off" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>
        ${help ? `<p class="cb-help">${esc(help)}</p>` : ''}
        <p class="cb-error" hidden></p>
        <div class="cb-row"><button type="button" class="cb-btn" data-cancel>Cancel</button><button class="cb-btn cb-btn-primary">${esc(ok)}</button></div>
      </form>`, {
      onOpen(wrap, close) {
        const form = wrap.querySelector('form');
        const input = form.querySelector('input');
        input.focus();
        input.select();
        form.addEventListener('submit', e => { e.preventDefault(); close(); resolve(input.value); });
        form.querySelector('[data-cancel]').addEventListener('click', () => { close(); resolve(null); });
        wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); resolve(null); } });
        wrap.addEventListener('mousedown', e => { if (e.target === wrap) { close(); resolve(null); } });
      },
    });
  });
}

/** Ask a yes/no question. Resolves to true or false. */
export function confirmBox({ title, text, ok = 'OK', danger = false }) {
  return new Promise(resolve => {
    open(`
      <h3>${esc(title)}</h3>
      <p class="cb-text">${esc(text)}</p>
      <div class="cb-row"><button type="button" class="cb-btn" data-cancel>Cancel</button><button type="button" class="cb-btn ${danger ? 'cb-btn-danger' : 'cb-btn-primary'}" data-ok>${esc(ok)}</button></div>`, {
      onOpen(wrap, close) {
        const done = v => { close(); resolve(v); };
        wrap.querySelector('[data-ok]').addEventListener('click', () => done(true));
        wrap.querySelector('[data-cancel]').addEventListener('click', () => done(false));
        wrap.querySelector('[data-cancel]').focus();
        wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
        wrap.addEventListener('mousedown', e => { if (e.target === wrap) done(false); });
      },
    });
  });
}

/** Offer several choices. `choices`: [{ id, label, primary?, danger? }]. Resolves to an id or null. */
export function choose({ title, text, choices }) {
  return new Promise(resolve => {
    open(`
      <h3>${esc(title)}</h3>
      <p class="cb-text">${esc(text)}</p>
      <div class="cb-row cb-row-wrap">${choices.map(c => `<button type="button" class="cb-btn ${c.primary ? 'cb-btn-primary' : ''} ${c.danger ? 'cb-btn-danger' : ''}" data-id="${esc(c.id)}">${esc(c.label)}</button>`).join('')}</div>`, {
      onOpen(wrap, close) {
        wrap.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => { close(); resolve(b.dataset.id); }));
        wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); resolve(null); } });
        wrap.querySelector('[data-id]')?.focus();
      },
    });
  });
}

/** Pick a folder from a list. Resolves to the folder path ('' = top level) or null. */
export function pickFolder({ title, folders, current }) {
  return new Promise(resolve => {
    const list = ['', ...[...folders].sort((a, b) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' }))];
    open(`
      <h3>${esc(title)}</h3>
      <div class="cb-pick">${list.map(f => {
        const depth = f ? f.split('/').length : 0;
        const name = f ? f.split('/').pop() : 'Top level (no folder)';
        return `<button type="button" class="cb-pick-item${f === current ? ' is-current' : ''}" data-f="${esc(f)}" style="padding-left:${12 + depth * 16}px" ${f === current ? 'aria-current="true"' : ''}>${esc(name)}</button>`;
      }).join('')}</div>
      <div class="cb-row"><button type="button" class="cb-btn" data-cancel>Cancel</button></div>`, {
      onOpen(wrap, close) {
        wrap.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { close(); resolve(b.dataset.f); }));
        wrap.querySelector('[data-cancel]').addEventListener('click', () => { close(); resolve(null); });
        wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); resolve(null); } });
        wrap.querySelector('[data-f]')?.focus();
      },
    });
  });
}

let toastTimer;
export function toast(text, { error = false, ms = 3200 } = {}) {
  let el = document.querySelector('.cb-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'cb-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.toggle('is-error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
