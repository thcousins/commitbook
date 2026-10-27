// The Commitbook app shell: sidebar (folders, search, tags), the open note,
// history and file panels, the Trash, and saving.

import { Store, ConflictError, TRASH } from './store.js';
import { createEditor, getMarkdown, COMMANDS, activeStates } from './editor/editor.js';
import { local } from './lib/cache.js';
import { esc, friendlyDate, longDate, debounce, dirname, basename, plainText, nowIso } from './lib/util.js';
import { icon } from './ui/icons.js';
import { ask, confirmBox, choose, pickFolder, toast } from './ui/dialogs.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SAVE_DELAY = 2500;
const REFRESH_EVERY = 90_000;

const TOOLBAR = [
  ['undo', 'undo', 'Undo (⌘Z)'], ['redo', 'redo', 'Redo (⇧⌘Z)'], '|',
  ['bold', '<b>B</b>', 'Bold (⌘B)'], ['italic', '<i>I</i>', 'Italic (⌘I)'], ['strike', 'strike', 'Strikethrough'], ['code', 'code', 'Inline code'], '|',
  ['h1', 'H1', 'Heading 1'], ['h2', 'H2', 'Heading 2'], ['h3', 'H3', 'Heading 3'], '|',
  ['bullets', 'bullets', 'Bullet list'], ['numbers', 'numbers', 'Numbered list'], ['checklist', 'check', 'Checklist'], ['quote', 'quote', 'Quote'], ['codeBlock', 'codeBlock', 'Code block'], '|',
  ['sheet', 'sheet', 'Insert spreadsheet', 'Spreadsheet'],
];

export async function startApp(root, settings) {
  const app = new App(root, settings);
  await app.start();
  return app;
}

class App {
  constructor(root, settings) {
    this.root = root;
    this.settings = settings;
    this.store = new Store({ owner: settings.owner, repo: settings.repo, token: settings.token });
    this.repoKey = `${settings.owner}/${settings.repo}`;
    this.current = null;          // the open note ({ path: null } for a new one)
    this.editor = null;
    this.dirty = false;
    this.saving = null;
    this.view = 'note';           // 'note' | 'trash' | 'empty'
    this.query = '';
    this.includeOld = false;
    this.oldHits = null;
    this.selectedTags = new Set();
    this.expanded = new Set(local.get(`cb:expanded:${this.repoKey}`, []));
    this.sort = local.get('cb:sort', 'title');
    this.autosave = local.get('cb:autosave', true) !== false;
    this.newFolder = '';
    this.saveSoon = debounce(() => this.save(), SAVE_DELAY);
    this.writeDraft = debounce(() => this.storeDraft(), 400);
  }

  // ---------------------------------------------------------------- start-up

  async start() {
    this.root.innerHTML = this.shellHtml();
    this.bindShell();
    this.setStatus('loading');
    try {
      await this.store.connect();
      const { initialised } = await this.store.load();
      if (initialised) toast('Your notes repository is set up. Create your first note with “New”.');
    } catch (e) {
      this.setStatus('error', e.message);
      this.showLoadError(e);
      return;
    }
    this.store.on(what => { if (what === 'busy') this.renderStatus(); });
    await this.recoverDrafts();
    this.renderSidebar();
    const last = local.get(`cb:last:${this.repoKey}`);
    if (last && this.store.notes.has(last)) this.openNote(this.store.notes.get(last));
    else this.showEmpty();
    this.setStatus('saved');
    window.addEventListener('focus', () => this.checkForChanges());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { if (this.autosave) this.flush({ ask: false }); }
      else this.checkForChanges();
    });
    window.addEventListener('beforeunload', e => {
      if (this.dirty || this.saving) { if (this.autosave) this.storeDraft(); e.preventDefault(); e.returnValue = ''; }
    });
    setInterval(() => this.checkForChanges(), REFRESH_EVERY);
  }

  shellHtml() {
    return `
    <div class="cb-app" id="cb-app">
      <aside class="cb-side" aria-label="Notes">
        <div class="cb-side-head">
          <div class="cb-brand">${icon('logo')}<span>Commitbook</span></div>
          <button type="button" class="cb-new" id="cb-new" title="New note (⌥N)">${icon('plus')}New</button>
          <button type="button" class="cb-icon-btn" id="cb-menu" title="More" aria-label="More options" aria-haspopup="menu">${icon('more')}</button>
        </div>
        <div class="cb-search">
          <label class="cb-search-box">${icon('search')}<input id="cb-q" type="search" placeholder="Search notes" aria-label="Search notes" autocomplete="off"></label>
          <label class="cb-old" id="cb-old-wrap" hidden><input type="checkbox" id="cb-old"> Include older versions</label>
        </div>
        <div class="cb-tagbar" id="cb-tagbar"></div>
        <nav class="cb-list" id="cb-list" aria-label="Notes and folders"></nav>
        <div class="cb-side-foot">
          <span class="cb-repo" title="Notes repository">${esc(this.repoKey)}</span>
          <button type="button" class="cb-linkbtn" id="cb-sort" title="Change the order of notes"></button>
        </div>
        <div class="cb-resizer" id="cb-resizer" title="Drag to resize · double-click to reset" role="separator" aria-orientation="vertical"></div>
      </aside>
      <main class="cb-main" id="cb-main">
        <div class="cb-bar">
          <button type="button" class="cb-icon-btn cb-back" id="cb-back" aria-label="Back to notes">${icon('back')}</button>
          <div class="cb-tools" id="cb-tools" role="toolbar" aria-label="Formatting">${TOOLBAR.map(t => t === '|' ? '<span class="cb-sep"></span>' :
            `<button type="button" class="cb-tool${t[0] === 'h3' || t[0] === 'code' || t[0] === 'strike' || t[0] === 'quote' || t[0] === 'codeBlock' || t[0] === 'numbers' ? ' cb-hide-sm' : ''}" data-cmd="${t[0]}" title="${t[2]}" aria-label="${t[2]}">${t[1].startsWith('<') || /^H\d$/.test(t[1]) ? t[1] : icon(t[1])}${t[3] ? `<span class="cb-hide-sm">${t[3]}</span>` : ''}</button>`).join('')}</div>
          <span class="cb-spacer"></span>
          <span class="cb-status" id="cb-status"><span class="cb-dot"></span><span class="cb-status-text"></span></span>
          <label class="cb-switch" title="Save automatically a few seconds after you stop typing"><input type="checkbox" id="cb-autosave" role="switch"><span class="cb-switch-track" aria-hidden="true"></span><span class="cb-switch-label">Auto-save</span></label>
          <button type="button" class="cb-btn cb-btn-small cb-save" id="cb-save" title="Save now (⌘S)">Save</button>
          <button type="button" class="cb-icon-btn" id="cb-history" title="Revision history" aria-label="Revision history">${icon('history')}</button>
          <button type="button" class="cb-icon-btn" id="cb-file" title="Show the file as stored in GitHub" aria-label="Show stored file">${icon('code')}</button>
          <button type="button" class="cb-icon-btn" id="cb-note-menu" title="Note options" aria-label="Note options" aria-haspopup="menu">${icon('more')}</button>
        </div>
        <div class="cb-scroll" id="cb-scroll"><div class="cb-page" id="cb-page"></div></div>
      </main>
      <aside class="cb-drawer" id="cb-drawer" hidden aria-label="Details"></aside>
    </div>`;
  }

  bindShell() {
    $('#cb-new').addEventListener('click', () => this.newNote(this.newFolder));
    $('#cb-menu').addEventListener('click', e => this.mainMenu(e.currentTarget));
    $('#cb-q').addEventListener('input', debounce(e => { this.query = e.target.value.trim(); this.oldHits = null; this.renderSidebar(); }, 150));
    $('#cb-old').addEventListener('change', e => { this.includeOld = e.target.checked; this.oldHits = null; this.renderSidebar(); });
    $('#cb-sort').addEventListener('click', () => { this.sort = this.sort === 'title' ? 'updated' : 'title'; local.set('cb:sort', this.sort); this.renderSidebar(); });
    $('#cb-back').addEventListener('click', async () => { if (await this.flush()) $('#cb-app').classList.remove('show-note'); });
    $('#cb-tools').addEventListener('mousedown', e => { if (e.target.closest('.cb-tool')) e.preventDefault(); });
    $('#cb-tools').addEventListener('click', e => {
      const b = e.target.closest('.cb-tool');
      if (b && this.editor) COMMANDS[b.dataset.cmd]?.(this.editor);
    });
    $('#cb-autosave').checked = this.autosave;
    $('#cb-autosave').addEventListener('change', e => {
      this.autosave = e.target.checked;
      local.set('cb:autosave', this.autosave);
      if (this.autosave && this.dirty) this.save();
      if (!this.autosave) this.saveSoon.cancel();
      this.renderStatus();
      toast(this.autosave ? 'Auto-save is on.' : 'Auto-save is off. Use Save (⌘S) to save your changes.');
    });
    $('#cb-save').addEventListener('click', () => this.save());
    $('#cb-history').addEventListener('click', () => this.showHistory());
    $('#cb-file').addEventListener('click', () => this.showFile());
    $('#cb-note-menu').addEventListener('click', e => this.noteMenu(e.currentTarget));
    document.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); }
      if (e.altKey && e.code === 'KeyN') { e.preventDefault(); this.newNote(this.newFolder); }
      if (e.key === 'Escape' && !$('#cb-drawer').hidden && !document.querySelector('.cb-modal')) this.closeDrawer();
    });
    this.bindResizer();
  }

  bindResizer() {
    const r = $('#cb-resizer');
    const set = w => document.documentElement.style.setProperty('--cb-side-w', w + 'px');
    const saved = local.get('cb:sidew');
    if (saved) set(saved);
    r.addEventListener('pointerdown', e => {
      e.preventDefault();
      r.setPointerCapture(e.pointerId);
      document.documentElement.classList.add('cb-resizing');
      let w = null;
      const move = ev => { w = Math.round(Math.min(560, Math.max(200, ev.clientX))); set(w); };
      const up = ev => {
        r.releasePointerCapture(ev.pointerId);
        r.removeEventListener('pointermove', move);
        r.removeEventListener('pointerup', up);
        document.documentElement.classList.remove('cb-resizing');
        if (w) local.set('cb:sidew', w);
      };
      r.addEventListener('pointermove', move);
      r.addEventListener('pointerup', up);
    });
    r.addEventListener('dblclick', () => { document.documentElement.style.removeProperty('--cb-side-w'); local.del('cb:sidew'); });
  }

  showLoadError(e) {
    $('#cb-page').innerHTML = `
      <div class="cb-empty">
        <h2>Couldn’t open your notes</h2>
        <p>${esc(e.message)}</p>
        <div class="cb-row-left"><button type="button" class="cb-btn cb-btn-primary" id="cb-retry">Try again</button>
        <button type="button" class="cb-btn" id="cb-signout">Change repository or access key</button></div>
      </div>`;
    $('#cb-retry').addEventListener('click', () => location.reload());
    $('#cb-signout').addEventListener('click', () => this.signOut());
  }

  // ---------------------------------------------------------------- status

  setStatus(state, detail = '') {
    this.status = state;
    this.statusDetail = detail;
    this.renderStatus();
  }

  renderStatus() {
    const el = $('#cb-status');
    if (!el) return;
    let state = this.status;
    if (state !== 'error' && state !== 'loading' && state !== 'conflict') {
      if (this.saving || this.store.busy) state = 'saving';
      else if (this.dirty) state = 'unsaved';
      else state = 'saved';
    }
    const text = { loading: 'Loading…', saving: 'Saving…', unsaved: 'Edited', saved: 'Saved', error: 'Not saved', conflict: 'Needs attention' }[state];
    el.className = `cb-status is-${state}`;
    el.title = state === 'error' ? this.statusDetail || 'Saving failed' : state === 'saved' ? 'All changes are saved to GitHub' : '';
    $('.cb-status-text', el).textContent = text;
    const save = $('#cb-save');
    if (save) {
      save.disabled = !this.dirty || !!this.saving;
      save.classList.toggle('is-needed', this.dirty && !this.autosave);
    }
  }

  // ---------------------------------------------------------------- sidebar

  matches(note) {
    for (const t of this.selectedTags) if (!note.tags.some(x => x.toLowerCase() === t.toLowerCase())) return false;
    if (!this.query) return true;
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = `${note.title}\n${note.plain}\n${note.tags.join(' ')}\n${note.path}`.toLowerCase();
    return words.every(w => hay.includes(w));
  }

  sorted(notes) {
    const list = [...notes];
    if (this.sort === 'updated') list.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
    else list.sort((a, b) => a.title.localeCompare(b.title, 'en-GB', { sensitivity: 'base', numeric: true }));
    return list;
  }

  renderSidebar() {
    const s = this.store;
    $('#cb-sort').textContent = this.sort === 'title' ? 'Sorted A–Z' : 'Sorted by last edited';
    $('#cb-old-wrap').hidden = !this.query;
    this.renderTagBar();
    const list = $('#cb-list');
    const filtering = !!this.query || this.selectedTags.size > 0;
    const trashCount = s.trash.size;
    let html = '';
    if (filtering) {
      const found = this.sorted([...s.notes.values()].filter(n => this.matches(n)));
      html += `<div class="cb-list-head">${found.length} note${found.length === 1 ? '' : 's'} found</div>`;
      html += found.map(n => this.itemHtml(n, { showFolder: true })).join('') || '<p class="cb-list-empty">No notes match.</p>';
      if (this.query && this.includeOld) html += this.oldHitsHtml();
    } else {
      html += this.treeHtml('');
      if (!s.notes.size && !s.folders.size) html += '<p class="cb-list-empty">No notes yet. Click <b>New</b> to write one.</p>';
    }
    html += `<button type="button" class="cb-trash-link${this.view === 'trash' ? ' is-active' : ''}" id="cb-trash-link">${icon('trash')}Trash${trashCount ? `<span class="cb-count">${trashCount}</span>` : ''}</button>`;
    list.innerHTML = html;
    this.bindList(list);
    if (this.query && this.includeOld && this.oldHits === null) this.runOldSearch();
  }

  treeHtml(folder, depth = 0) {
    const s = this.store;
    const subfolders = [...s.folders].filter(f => dirname(f) === folder).sort((a, b) => basename(a).localeCompare(basename(b), 'en-GB', { sensitivity: 'base', numeric: true }));
    const notes = this.sorted([...s.notes.values()].filter(n => dirname(n.path) === folder));
    let html = '';
    for (const f of subfolders) {
      const open = this.expanded.has(f);
      const count = [...s.notes.keys()].filter(p => p.startsWith(f + '/')).length;
      html += `<div class="cb-folder${open ? ' is-open' : ''}" data-folder="${esc(f)}" style="--depth:${depth}">
        <button type="button" class="cb-folder-row" data-toggle="${esc(f)}" aria-expanded="${open}">
          <span class="cb-chev">${icon('chevron')}</span>${icon('folder')}<span class="cb-folder-name">${esc(basename(f))}</span><span class="cb-count">${count || ''}</span>
        </button>
        <button type="button" class="cb-icon-btn cb-folder-more" data-folder-menu="${esc(f)}" aria-label="Folder options for ${esc(basename(f))}">${icon('more')}</button>
      </div>`;
      if (open) html += `<div class="cb-folder-kids">${this.treeHtml(f, depth + 1) || ''}${!count && ![...s.folders].some(x => dirname(x) === f) ? `<p class="cb-list-empty" style="--depth:${depth + 1}">Empty folder</p>` : ''}</div>`;
    }
    html += notes.map(n => this.itemHtml(n, { depth })).join('');
    if (this.current && !this.current.path && (this.current.folder || '') === folder) html = this.newItemHtml(depth) + html;
    return html;
  }

  newItemHtml(depth) {
    const title = ($('#cb-title')?.value || '').trim() || 'Untitled note';
    return `<button type="button" class="cb-item is-current" aria-current="true" style="--depth:${depth}"><div class="cb-item-title"><span>${esc(title)}</span></div><div class="cb-item-snip">New note – not saved yet</div></button>`;
  }

  itemHtml(n, { showFolder = false, depth = 0 } = {}) {
    const cur = this.current && this.current.path === n.path && this.view === 'note';
    const hasSheet = n.body.includes('commitbook:sheet');
    const snip = n.plain.slice(0, 120);
    return `<button type="button" class="cb-item${cur ? ' is-current' : ''}" data-path="${esc(n.path)}" draggable="true" style="--depth:${depth}" ${cur ? 'aria-current="true"' : ''}>
      <div class="cb-item-title"><span>${esc(n.title)}</span>${hasSheet ? icon('sheet', 'cb-mini') : ''}</div>
      ${snip ? `<div class="cb-item-snip">${esc(snip)}</div>` : ''}
      <div class="cb-item-meta">${showFolder && dirname(n.path) ? `<span class="cb-item-folder">${icon('folder')}${esc(dirname(n.path))}</span>` : ''}<span>${esc(friendlyDate(n.updated, { withTime: false }))}</span>${n.tags.map(t => `<span class="cb-tagdot" style="--tag:${this.store.tagColour(t)}" title="${esc(t)}"></span>`).join('')}</div>
    </button>`;
  }

  bindList(list) {
    list.onclick = async e => {
      const item = e.target.closest('.cb-item[data-path]');
      if (item) { await this.openNote(this.store.notes.get(item.dataset.path)); return; }
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const f = tg.dataset.toggle;
        if (this.expanded.has(f)) this.expanded.delete(f); else this.expanded.add(f);
        local.set(`cb:expanded:${this.repoKey}`, [...this.expanded]);
        this.newFolder = f;
        this.renderSidebar();
        return;
      }
      const fm = e.target.closest('[data-folder-menu]');
      if (fm) { this.folderMenu(fm, fm.dataset.folderMenu); return; }
      if (e.target.closest('#cb-trash-link')) { this.showTrash(); return; }
      const old = e.target.closest('[data-old]');
      if (old) { const h = this.oldHits[Number(old.dataset.old)]; this.showOldVersion(h.path, h.ref, h.date, h.text); }
    };
    // Drag notes onto folders (or the empty space for the top level).
    list.ondragstart = e => {
      const item = e.target.closest('.cb-item[data-path]');
      if (!item) return;
      e.dataTransfer.setData('text/x-commitbook-note', item.dataset.path);
      e.dataTransfer.effectAllowed = 'move';
    };
    list.ondragover = e => {
      if (!e.dataTransfer.types.includes('text/x-commitbook-note')) return;
      e.preventDefault();
      $$('.is-drop', list).forEach(x => x.classList.remove('is-drop'));
      (e.target.closest('.cb-folder') || list).classList.add('is-drop');
    };
    list.ondragleave = e => { if (!list.contains(e.relatedTarget)) $$('.is-drop', list).forEach(x => x.classList.remove('is-drop')); };
    list.ondrop = async e => {
      const path = e.dataTransfer.getData('text/x-commitbook-note');
      $$('.is-drop', list).forEach(x => x.classList.remove('is-drop'));
      $('#cb-list').classList.remove('is-drop');
      if (!path) return;
      e.preventDefault();
      const folder = e.target.closest('.cb-folder')?.dataset.folder || '';
      const note = this.store.notes.get(path);
      if (note) await this.moveNote(note, folder);
    };
  }

  renderTagBar() {
    const bar = $('#cb-tagbar');
    const tags = this.store.tags;
    bar.innerHTML = `
      <button type="button" class="cb-tagbtn${this.selectedTags.size ? ' is-on' : ''}" id="cb-tagfilter" aria-haspopup="menu">${icon('tag')}${this.selectedTags.size ? 'Tags' : 'Filter by tag'}</button>
      ${[...this.selectedTags].map(t => `<span class="cb-chip" style="--tag:${this.store.tagColour(t)}">${esc(t)}<button type="button" data-untag="${esc(t)}" aria-label="Stop filtering by ${esc(t)}">${icon('x')}</button></span>`).join('')}`;
    $('#cb-tagfilter', bar).onclick = e => this.tagFilterMenu(e.currentTarget);
    bar.onclick = e => {
      const u = e.target.closest('[data-untag]');
      if (u) { this.selectedTags.delete(u.dataset.untag); this.renderSidebar(); }
    };
    bar.hidden = !tags.length && !this.selectedTags.size;
  }

  tagFilterMenu(anchor) {
    const counts = new Map();
    for (const n of this.store.notes.values()) for (const t of n.tags) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) || 0) + 1);
    this.popover(anchor, `
      <div class="cb-pop-head">Show notes with all of these tags</div>
      ${this.store.tags.map(t => `<label class="cb-pop-check"><input type="checkbox" value="${esc(t.name)}" ${this.selectedTags.has(t.name) ? 'checked' : ''}><span class="cb-tagdot" style="--tag:${t.color}"></span>${esc(t.name)}<span class="cb-count">${counts.get(t.name.toLowerCase()) || 0}</span></label>`).join('') || '<p class="cb-pop-empty">No tags yet.</p>'}
      <div class="cb-pop-sep"></div>
      <button type="button" class="cb-pop-item" data-act="clear">Clear filter</button>
      <button type="button" class="cb-pop-item" data-act="manage">Manage tags…</button>`, pop => {
      pop.addEventListener('change', e => {
        const v = e.target.value;
        if (e.target.checked) this.selectedTags.add(v); else this.selectedTags.delete(v);
        this.renderSidebar();
      });
      pop.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'clear') { this.selectedTags.clear(); this.closePopover(); this.renderSidebar(); }
        if (act === 'manage') { this.closePopover(); this.manageTags(); }
      });
    });
  }

  // ---------------------------------------------------------------- older versions search

  oldHitsHtml() {
    if (this.oldHits === null || this.oldHits === 'loading') {
      return `<div class="cb-list-head">In older versions</div><p class="cb-list-empty" id="cb-old-progress">Searching history…</p>`;
    }
    if (this.oldHits.error) return `<div class="cb-list-head">In older versions</div><p class="cb-list-empty">${esc(this.oldHits.error)}</p>`;
    const current = new Map([...this.store.notes.values()].map(n => [n.path, n]));
    const hits = this.oldHits.filter(h => !(current.get(h.path)?.text || '').toLowerCase().includes(h.text.toLowerCase()));
    if (!hits.length) return `<div class="cb-list-head">In older versions</div><p class="cb-list-empty">Nothing else found in older versions.</p>`;
    return `<div class="cb-list-head">In older versions</div>` + hits.slice(0, 50).map(h => {
      const i = this.oldHits.indexOf(h);
      const n = current.get(h.path);
      const title = n ? n.title : basename(h.path).replace(/\.md$/, '').replace(/-/g, ' ');
      return `<button type="button" class="cb-item cb-item-old" data-old="${i}">
        <div class="cb-item-title"><span>${esc(title)}</span></div>
        <div class="cb-item-snip">“${esc(h.text.slice(0, 120))}”</div>
        <div class="cb-item-meta">${icon('history')}<span>${n ? 'Older version' : 'Deleted or moved note'}, ${esc(friendlyDate(h.date, { withTime: false }))}</span></div>
      </button>`;
    }).join('');
  }

  async runOldSearch() {
    const q = this.query;
    this.oldHits = 'loading';
    this.oldAbort?.abort();
    const ctrl = this.oldAbort = new AbortController();
    try {
      const hits = await this.store.searchHistory(q, {
        signal: ctrl.signal,
        onProgress: (done, total) => {
          const el = $('#cb-old-progress');
          if (el) el.textContent = `Searching history… ${done} of ${total} changes`;
        },
      });
      if (ctrl.signal.aborted || q !== this.query) return;
      this.oldHits = hits.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.oldHits = { error: e.message };
    }
    this.renderSidebar();
  }

  // ---------------------------------------------------------------- opening notes

  showEmpty() {
    this.view = 'empty';
    this.destroyEditor();
    this.current = null;
    $('#cb-page').innerHTML = `
      <div class="cb-empty">
        <h2>${this.store.notes.size ? 'Pick a note' : 'Welcome to Commitbook'}</h2>
        <p>${this.store.notes.size ? 'Choose a note from the list, or start a new one.' : 'Every note you write here is saved as a file in your GitHub repository, with its full history.'}</p>
        <div class="cb-row-left"><button type="button" class="cb-btn cb-btn-primary" id="cb-empty-new">${icon('plus')}New note</button></div>
      </div>`;
    $('#cb-empty-new').addEventListener('click', () => this.newNote(this.newFolder));
    this.toggleNoteTools(false);
    this.renderSidebar();
  }

  toggleNoteTools(on) {
    $$('#cb-tools .cb-tool, #cb-history, #cb-file, #cb-note-menu').forEach(b => { b.disabled = !on; });
  }

  async openNote(note, { keepDrawer = false } = {}) {
    if (!note) return;
    if (!(await this.flush())) return;
    this.view = 'note';
    this.current = note;
    this.dirty = false;
    local.set(`cb:last:${this.repoKey}`, note.path);
    this.renderNote();
    if (!keepDrawer) this.closeDrawer();
    $('#cb-app').classList.add('show-note');
    this.renderSidebar();
    // A draft that couldn't be saved earlier because the note had changed.
    const draft = note.path && local.get(this.draftKey(note));
    if (draft && draft.baseSha !== note.sha) this.offerDraft(draft);
  }

  async newNote(folder = '') {
    if (!(await this.flush())) return;
    this.view = 'note';
    this.current = { path: null, data: { created: nowIso() }, title: '', tags: [], body: '', folder, tempId: Date.now().toString(36) };
    this.dirty = false;
    if (folder) { this.expanded.add(folder); }
    this.renderNote();
    this.closeDrawer();
    $('#cb-app').classList.add('show-note');
    this.renderSidebar();
    $('#cb-title').focus();
  }

  renderNote() {
    const n = this.current;
    this.destroyEditor();
    const folder = n.path ? dirname(n.path) : n.folder || '';
    $('#cb-page').innerHTML = `
      <input class="cb-title" id="cb-title" placeholder="Untitled note" aria-label="Note title" autocomplete="off" value="${esc(n.title || '')}">
      <div class="cb-meta" id="cb-meta"></div>
      <div class="cb-note-tags" id="cb-note-tags"></div>
      <div class="cb-editor" id="cb-editor"></div>`;
    this.renderMeta();
    this.renderNoteTags();
    const title = $('#cb-title');
    title.addEventListener('input', () => { this.changed(); this.updateNewItemTitle(); });
    title.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.editor?.commands.focus('start'); }
    });
    this.editor = createEditor({
      element: $('#cb-editor'),
      markdown: n.body || '',
      onChange: () => this.changed(),
      onSelection: () => this.updateToolbar(),
    });
    this.toggleNoteTools(true);
    $('#cb-history').disabled = !n.path;
    this.updateToolbar();
    $('#cb-scroll').scrollTop = 0;
    this.noteFolder = folder;
  }

  updateNewItemTitle() {
    if (this.current && !this.current.path) {
      const el = $('#cb-list .cb-item.is-current:not([data-path]) .cb-item-title span');
      if (el) el.textContent = $('#cb-title').value.trim() || 'Untitled note';
    }
  }

  renderMeta() {
    const n = this.current;
    const path = n.path || '(not saved yet)';
    $('#cb-meta').innerHTML = [
      n.created ? `<span title="${esc(longDate(n.created))}">Created ${esc(longDate(n.created))}</span>` : (n.data?.created ? `<span>Created ${esc(longDate(n.data.created))}</span>` : ''),
      n.updated && n.path ? `<span title="${esc(longDate(n.updated))}">Edited ${esc(friendlyDate(n.updated))}</span>` : '',
      `<code>${esc(path)}</code>`,
    ].filter(Boolean).join('<span class="cb-meta-sep">·</span>');
  }

  destroyEditor() {
    if (this.editor) { try { this.editor.destroy(); } catch { /* ignore */ } this.editor = null; }
  }

  updateToolbar() {
    if (!this.editor) return;
    const st = activeStates(this.editor);
    $$('#cb-tools .cb-tool').forEach(b => {
      const k = b.dataset.cmd;
      if (k === 'undo' || k === 'redo') b.disabled = !st[k];
      else b.classList.toggle('is-active', !!st[k]);
    });
  }

  // ---------------------------------------------------------------- tags on a note

  noteTags() { return this.current?.editTags || this.current?.tags || []; }

  renderNoteTags() {
    const el = $('#cb-note-tags');
    const tags = this.noteTags();
    el.innerHTML = `${tags.map(t => `<span class="cb-chip" style="--tag:${this.store.tagColour(t)}">${esc(t)}<button type="button" data-rm="${esc(t)}" aria-label="Remove tag ${esc(t)}">${icon('x')}</button></span>`).join('')}
      <span class="cb-tag-add"><input id="cb-tag-input" list="cb-tag-list" placeholder="${tags.length ? '+ tag' : '+ Add a tag'}" aria-label="Add a tag" autocomplete="off"><datalist id="cb-tag-list">${this.store.tags.filter(t => !tags.some(x => x.toLowerCase() === t.name.toLowerCase())).map(t => `<option value="${esc(t.name)}"></option>`).join('')}</datalist></span>`;
    el.onclick = e => {
      const rm = e.target.closest('[data-rm]');
      if (rm) this.setNoteTags(tags.filter(t => t !== rm.dataset.rm));
    };
    const input = $('#cb-tag-input');
    const add = () => {
      const v = input.value.trim().replace(/,/g, '');
      if (!v) return;
      const existing = this.store.tags.find(t => t.name.toLowerCase() === v.toLowerCase());
      const name = existing ? existing.name : v;
      if (!tags.some(t => t.toLowerCase() === name.toLowerCase())) this.setNoteTags([...tags, name], { focus: true });
      input.value = '';
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
      if (e.key === 'Backspace' && !input.value && tags.length) this.setNoteTags(tags.slice(0, -1), { focus: true });
    });
    input.addEventListener('change', () => { if (this.store.tags.some(t => t.name === input.value)) add(); });
  }

  setNoteTags(tags, { focus = false } = {}) {
    this.current.editTags = tags;
    for (const t of tags) this.store.ensureTag(t);
    this.renderNoteTags();
    if (focus) $('#cb-tag-input')?.focus();
    this.changed();
  }

  // ---------------------------------------------------------------- saving

  changed() {
    if (!this.current) return;
    this.dirty = true;
    this.renderStatus();
    if (this.autosave) {
      this.writeDraft();
      this.saveSoon();
    }
  }

  parts() {
    return {
      title: ($('#cb-title')?.value || '').trim(),
      body: this.editor ? getMarkdown(this.editor) : this.current.body,
      tags: this.noteTags(),
      folder: this.current.path ? dirname(this.current.path) : this.current.folder || '',
    };
  }

  draftKey(note) { return `cb:draft:${this.repoKey}:${note.path || 'new:' + note.tempId}`; }

  storeDraft() {
    if (!this.current || !this.dirty) return;
    const p = this.parts();
    local.set(this.draftKey(this.current), { ...p, path: this.current.path, tempId: this.current.tempId, baseSha: this.current.sha || null, created: this.current.created || this.current.data?.created, at: nowIso() });
  }

  /**
   * Called before leaving the note (or changing files it's in). With auto-save on,
   * saves now. With it off, asks whether to save. Resolves false if the person
   * chose Cancel, so the caller should stay put.
   */
  async flush({ ask = true } = {}) {
    this.saveSoon.cancel();
    if (this.saving) await this.saving;
    if (!this.dirty || !this.current) return true;
    if (this.autosave) { await this.save(); return true; }
    if (!ask) return true;
    const choice = await choose({
      title: 'Save your changes?',
      text: `Auto-save is off, so your changes to “${($('#cb-title')?.value || '').trim() || 'this note'}” will be lost if you don’t save them.`,
      choices: [{ id: 'save', label: 'Save', primary: true }, { id: 'discard', label: 'Don’t save', danger: true }, { id: 'cancel', label: 'Cancel' }],
    });
    if (choice === 'save') { await this.save(); return !this.dirty; }
    if (choice === 'discard') { this.dirty = false; local.del(this.draftKey(this.current)); this.renderStatus(); return true; }
    return false;
  }

  async save() {
    if (this.saving) { await this.saving; if (!this.dirty) return; }
    if (!this.current || !this.dirty) return;
    this.saveSoon.cancel();
    const note = this.current;
    const p = this.parts();
    if (!note.path && !p.title && !plainText(p.body)) return;   // nothing typed yet
    if (!note.path && !p.title) p.title = plainText(p.body).split(/[.!?\n]/)[0].slice(0, 60).trim() || 'Untitled note';
    const draftKey = this.draftKey(note);
    this.dirty = false;
    const job = (async () => {
      try {
        const saved = await this.store.saveNote(note, p);
        local.del(draftKey);
        if (this.current === note) {
          // Keep the editor as it is; just point it at the saved file.
          Object.assign(note, saved, { editTags: undefined });
          this.current = this.store.notes.get(saved.path);
          this.current.editTags = undefined;
          if (!$('#cb-title').value.trim()) $('#cb-title').value = saved.title;
          local.set(`cb:last:${this.repoKey}`, saved.path);
          $('#cb-history').disabled = false;
          this.renderMeta();
        }
        if (this.store.tagsDirty) this.store.saveTags().catch(() => {});
        this.setStatus('saved');
        this.renderSidebar();
      } catch (e) {
        this.dirty = true;
        if (e instanceof ConflictError && note.path) {
          this.setStatus('conflict');
          await this.resolveConflict(note, p);
        } else {
          this.setStatus('error', e.message);
          toast(`Couldn’t save: ${e.message}`, { error: true, ms: 6000 });
          if (this.autosave) this.storeDraft();
        }
      }
    })();
    this.saving = job;
    this.renderStatus();
    try { await job; } finally { if (this.saving === job) this.saving = null; this.renderStatus(); }
  }

  async resolveConflict(note, mine) {
    const remote = await this.store.fetchRemote(note.path).catch(() => null);
    const choice = await choose({
      title: 'This note was changed somewhere else',
      text: remote
        ? 'While you were editing, a newer version was saved to GitHub (perhaps by Claude, or on another device). Your changes haven’t been saved yet.'
        : 'While you were editing, this note was deleted or moved on GitHub. Your changes haven’t been saved yet.',
      choices: [
        { id: 'both', label: 'Keep both (save mine as a copy)', primary: true },
        ...(remote ? [{ id: 'theirs', label: 'Use the newer version' }] : []),
        { id: 'mine', label: 'Overwrite with mine', danger: true },
      ],
    });
    if (choice === 'mine') {
      this.dirty = false;
      const saved = await this.store.forceSave(note, mine);
      this.current = saved;
      this.setStatus('saved');
      this.renderMeta();
      this.renderSidebar();
    } else if (choice === 'both') {
      this.dirty = false;
      await this.store.saveNote({ path: null, data: { created: note.created || nowIso() } }, { ...mine, title: `${mine.title || note.title} (my copy)` });
      local.del(this.draftKey(note));
      await this.store.refresh();
      this.setStatus('saved');
      const theirs = this.store.notes.get(note.path);
      if (theirs) await this.openNote(theirs); else this.showEmpty();
      toast('Your version was saved as a copy.');
    } else if (choice === 'theirs') {
      this.dirty = false;
      local.del(this.draftKey(note));
      await this.store.refresh();
      this.setStatus('saved');
      await this.openNote(this.store.notes.get(note.path) || remote);
    } else {
      this.setStatus('conflict');
    }
  }

  async recoverDrafts() {
    const prefix = `cb:draft:${this.repoKey}:`;
    let keys = [];
    try { keys = Object.keys(localStorage).filter(k => k.startsWith(prefix)); } catch { return; }
    let saved = 0;
    for (const k of keys) {
      const d = local.get(k);
      if (!d) continue;
      try {
        if (!d.path) {
          await this.store.saveNote({ path: null, data: { created: d.created || nowIso() } }, d);
          local.del(k); saved++;
        } else {
          const note = this.store.notes.get(d.path);
          if (note && note.sha === d.baseSha) {
            await this.store.saveNote(note, d);
            local.del(k); saved++;
          }
          // Otherwise keep the draft; it's offered when the note is opened.
        }
      } catch { /* keep the draft */ }
    }
    if (saved) toast(`Saved ${saved} change${saved === 1 ? '' : 's'} from your last visit.`);
  }

  async offerDraft(draft) {
    const choice = await choose({
      title: 'Unsaved changes from earlier',
      text: `You made changes to this note on this device (${friendlyDate(draft.at)}) that couldn’t be saved, and the note has changed since.`,
      choices: [{ id: 'copy', label: 'Save them as a copy', primary: true }, { id: 'drop', label: 'Discard them', danger: true }, { id: 'later', label: 'Decide later' }],
    });
    if (choice === 'copy') {
      await this.store.saveNote({ path: null, data: { created: nowIso() } }, { ...draft, title: `${draft.title} (my copy)` });
      local.del(this.draftKey(this.current));
      this.renderSidebar();
      toast('Saved as a copy.');
    } else if (choice === 'drop') {
      local.del(this.draftKey(this.current));
    }
  }

  async checkForChanges() {
    if (this.checking || this.saving || !this.store.head) return;
    this.checking = true;
    try {
      const changed = await this.store.refresh();
      if (!changed.length) return;
      const cur = this.current;
      if (cur?.path && changed.includes(cur.path) && !this.dirty && this.view === 'note') {
        const next = this.store.notes.get(cur.path);
        if (next && next.sha !== cur.sha) {
          const scroll = $('#cb-scroll').scrollTop;
          this.current = next;
          this.renderNote();
          $('#cb-scroll').scrollTop = scroll;
          toast('This note was updated from GitHub.');
        } else if (!next) {
          toast('This note was moved or deleted on GitHub.');
          this.showEmpty();
        }
      }
      this.renderSidebar();
      if (this.view === 'trash') this.showTrash();
    } catch { /* offline: try again later */ } finally {
      this.checking = false;
    }
  }

  // ---------------------------------------------------------------- note actions

  noteMenu(anchor) {
    const n = this.current;
    if (!n) return;
    this.popover(anchor, `
      <button type="button" class="cb-pop-item" data-act="move">${icon('move')}Move to folder…</button>
      <button type="button" class="cb-pop-item" data-act="history" ${n.path ? '' : 'disabled'}>${icon('history')}Revision history</button>
      <button type="button" class="cb-pop-item" data-act="file">${icon('code')}Show stored file</button>
      ${n.path ? `<a class="cb-pop-item" href="${esc(this.githubUrl(n.path))}" target="_blank" rel="noopener">${icon('link')}Open on GitHub</a>` : ''}
      <div class="cb-pop-sep"></div>
      <button type="button" class="cb-pop-item cb-danger" data-act="delete">${icon('trash')}Delete note</button>`, pop => {
      pop.addEventListener('click', async e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        this.closePopover();
        if (act === 'move') {
          const folder = await pickFolder({ title: 'Move to folder', folders: this.store.folders, current: n.path ? dirname(n.path) : n.folder });
          if (folder != null) {
            if (!n.path) { n.folder = folder; this.renderSidebar(); }
            else await this.moveNote(n, folder);
          }
        }
        if (act === 'history') this.showHistory();
        if (act === 'file') this.showFile();
        if (act === 'delete') this.deleteNote();
      });
    });
  }

  async moveNote(note, folder) {
    const isCurrent = this.current && this.current.path === note.path;
    try {
      if (isCurrent && !(await this.flush())) return;
      const fresh = this.store.notes.get(note.path) || note;
      const moved = await this.store.moveNote(fresh, folder);
      if (folder) this.expanded.add(folder);
      if (isCurrent) { this.current = moved; local.set(`cb:last:${this.repoKey}`, moved.path); this.renderMeta(); }
      this.renderSidebar();
      toast(`Moved to ${folder || 'the top level'}.`);
    } catch (e) {
      toast(e instanceof ConflictError ? 'The note changed on GitHub. Refreshing – please try again.' : `Couldn’t move: ${e.message}`, { error: true });
      this.checkForChanges();
    }
  }

  async deleteNote() {
    const n = this.current;
    if (!n) return;
    if (!n.path) {
      local.del(this.draftKey(n));
      this.dirty = false;
      this.showEmpty();
      return;
    }
    const ok = await confirmBox({ title: `Delete “${n.title}”?`, text: 'It moves to the Trash, where you can restore it.', ok: 'Move to Trash', danger: true });
    if (!ok) return;
    try {
      this.saveSoon.cancel();
      if (this.saving) await this.saving;
      this.dirty = false;
      await this.store.trashNote(this.store.notes.get(n.path) || n);
      local.del(this.draftKey(n));
      this.dirty = false;
      this.showEmpty();
      toast('Moved to the Trash.');
    } catch (e) {
      toast(`Couldn’t delete: ${e.message}`, { error: true });
    }
  }

  githubUrl(path, ref) {
    return `https://github.com/${this.settings.owner}/${this.settings.repo}/blob/${ref || this.store.gh.branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  // ---------------------------------------------------------------- folders

  folderMenu(anchor, folder) {
    this.popover(anchor, `
      <button type="button" class="cb-pop-item" data-act="note">${icon('plus')}New note here</button>
      <button type="button" class="cb-pop-item" data-act="sub">${icon('folderPlus')}New folder inside</button>
      <button type="button" class="cb-pop-item" data-act="rename">Rename…</button>
      <button type="button" class="cb-pop-item" data-act="move">${icon('move')}Move into…</button>
      <div class="cb-pop-sep"></div>
      <button type="button" class="cb-pop-item cb-danger" data-act="delete">${icon('trash')}Delete folder</button>`, pop => {
      pop.addEventListener('click', async e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        this.closePopover();
        try {
          if (act === 'note') { this.expanded.add(folder); this.newNote(folder); }
          if (act === 'sub') this.createFolder(folder);
          if (act === 'rename') {
            const name = await ask({ title: 'Rename folder', label: 'Folder name', value: basename(folder), ok: 'Rename' });
            if (name && name.trim() && name.trim() !== basename(folder)) await this.renameFolder(folder, [dirname(folder), name.trim().replace(/\//g, '-')].filter(Boolean).join('/'));
          }
          if (act === 'move') {
            const others = new Set([...this.store.folders].filter(f => f !== folder && !f.startsWith(folder + '/')));
            const into = await pickFolder({ title: `Move “${basename(folder)}” into`, folders: others, current: dirname(folder) });
            if (into != null && into !== dirname(folder)) await this.renameFolder(folder, [into, basename(folder)].filter(Boolean).join('/'));
          }
          if (act === 'delete') {
            const count = [...this.store.notes.keys()].filter(p => p.startsWith(folder + '/')).length;
            const ok = await confirmBox({
              title: `Delete the folder “${basename(folder)}”?`,
              text: count ? `The ${count} note${count === 1 ? '' : 's'} inside will move to the Trash, where you can restore them.` : 'It’s empty, so nothing else is affected.',
              ok: 'Delete folder', danger: true,
            });
            if (ok) {
              if (this.current?.path?.startsWith(folder + '/')) { this.dirty = false; this.showEmpty(); }
              await this.store.deleteFolder(folder);
              this.renderSidebar();
            }
          }
        } catch (err) {
          toast(err.message, { error: true });
        }
      });
    });
  }

  async createFolder(parent = '') {
    const name = await ask({ title: parent ? `New folder in “${basename(parent)}”` : 'New folder', label: 'Folder name', ok: 'Create', placeholder: 'e.g. House' });
    if (!name || !name.trim()) return;
    const path = [parent, name.trim().replace(/\//g, '-')].filter(Boolean).join('/');
    try {
      await this.store.createFolder(path);
      if (parent) this.expanded.add(parent);
      this.expanded.add(path);
      this.newFolder = path;
      local.set(`cb:expanded:${this.repoKey}`, [...this.expanded]);
      this.renderSidebar();
    } catch (e) {
      toast(e.message, { error: true });
    }
  }

  async renameFolder(from, to) {
    if (this.current?.path?.startsWith(from + '/') && !(await this.flush())) return;
    const curPath = this.current?.path;
    await this.store.renameFolder(from, to);
    const remap = f => (f === from || f.startsWith(from + '/') ? to + f.slice(from.length) : f);
    this.expanded = new Set([...this.expanded].map(remap));
    this.expanded.add(to);
    local.set(`cb:expanded:${this.repoKey}`, [...this.expanded]);
    if (curPath && curPath.startsWith(from + '/')) {
      this.current = this.store.notes.get(to + curPath.slice(from.length));
      this.renderMeta();
    }
    this.renderSidebar();
  }

  // ---------------------------------------------------------------- tags manager

  async manageTags() {
    const render = box => {
      const counts = new Map();
      for (const n of this.store.notes.values()) for (const t of n.tags) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) || 0) + 1);
      box.innerHTML = `
        <h3>Tags</h3>
        <div class="cb-tags-list">${this.store.tags.map(t => `
          <div class="cb-tag-row" data-tag="${esc(t.name)}">
            <input type="color" value="${esc(t.color)}" aria-label="Colour for ${esc(t.name)}" data-act="color">
            <span class="cb-tag-name">${esc(t.name)}</span>
            <span class="cb-count">${counts.get(t.name.toLowerCase()) || 0} note${(counts.get(t.name.toLowerCase()) || 0) === 1 ? '' : 's'}</span>
            <button type="button" class="cb-btn cb-btn-small" data-act="rename">Rename</button>
            <button type="button" class="cb-btn cb-btn-small cb-btn-quiet" data-act="delete" aria-label="Delete tag ${esc(t.name)}">${icon('trash')}</button>
          </div>`).join('') || '<p class="cb-text">No tags yet. Add one below, or type one on a note.</p>'}</div>
        <form class="cb-tag-new"><input name="name" placeholder="New tag name" aria-label="New tag name" autocomplete="off"><input type="color" name="color" value="#3f51b5" aria-label="New tag colour"><button class="cb-btn cb-btn-primary">Add tag</button></form>
        <p class="cb-error" hidden></p>
        <div class="cb-row"><button type="button" class="cb-btn" data-act="close">Done</button></div>`;
    };
    const wrap = document.createElement('div');
    wrap.className = 'cb-modal';
    wrap.innerHTML = '<div class="cb-modal-box cb-modal-wide" role="dialog" aria-modal="true" aria-label="Tags"></div>';
    document.body.appendChild(wrap);
    const box = $('.cb-modal-box', wrap);
    render(box);
    const fail = msg => { const p = $('.cb-error', box); p.textContent = msg; p.hidden = false; };
    const close = () => { wrap.remove(); this.renderSidebar(); if (this.current) this.renderNoteTags(); };
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelectorAll('.cb-modal').length === 1) close(); });
    box.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      try { await this.store.addTag(f.name.value, f.color.value); render(box); $('.cb-tag-new input', box).focus(); } catch (err) { fail(err.message); }
    });
    box.addEventListener('change', async e => {
      if (e.target.dataset.act !== 'color') return;
      const name = e.target.closest('[data-tag]').dataset.tag;
      try { await this.store.recolourTag(name, e.target.value); render(box); } catch (err) { fail(err.message); }
    });
    box.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act || act === 'color') return;
      if (act === 'close') { close(); return; }
      const name = e.target.closest('[data-tag]')?.dataset.tag;
      try {
        if (act === 'rename') {
          const to = await ask({ title: `Rename tag “${name}”`, label: 'New name', value: name, ok: 'Rename', help: 'Every note with this tag is updated.' });
          if (to && to.trim() && to.trim() !== name) {
            if (!(await this.flush())) return;
            await this.store.renameTag(name, to.trim());
            if (this.selectedTags.delete(name)) this.selectedTags.add(to.trim());
            this.reloadCurrentQuietly();
          }
        }
        if (act === 'delete') {
          const ok = await confirmBox({ title: `Delete the tag “${name}”?`, text: 'It’s removed from every note that has it. The notes themselves aren’t deleted.', ok: 'Delete tag', danger: true });
          if (ok) {
            if (!(await this.flush())) return;
            await this.store.deleteTag(name);
            this.selectedTags.delete(name);
            this.reloadCurrentQuietly();
          }
        }
        render(box);
      } catch (err) { fail(err.message); }
    });
  }

  reloadCurrentQuietly() {
    if (this.current?.path && !this.dirty) {
      const next = this.store.notes.get(this.current.path);
      if (next) { this.current = next; this.renderNoteTags(); this.renderMeta(); }
    }
  }

  // ---------------------------------------------------------------- drawer: history and file

  openDrawer(html) {
    const d = $('#cb-drawer');
    d.innerHTML = html;
    d.hidden = false;
    $('#cb-app').classList.add('has-drawer');
    $('[data-close]', d)?.addEventListener('click', () => this.closeDrawer());
    return d;
  }

  closeDrawer() {
    const d = $('#cb-drawer');
    if (!d) return;
    if (this.previewEditor) { try { this.previewEditor.destroy(); } catch { /* ignore */ } this.previewEditor = null; }
    d.hidden = true;
    d.innerHTML = '';
    $('#cb-app').classList.remove('has-drawer');
  }

  drawerHead(title) {
    return `<div class="cb-drawer-head"><h2>${esc(title)}</h2><button type="button" class="cb-icon-btn" data-close aria-label="Close">${icon('x')}</button></div>`;
  }

  async showHistory() {
    const n = this.current;
    if (!n?.path) { toast('Save the note first to start its history.'); return; }
    if (this.autosave) await this.flush();
    const d = this.openDrawer(`${this.drawerHead('Revision history')}<div class="cb-drawer-body"><p class="cb-text">Loading versions…</p></div>`);
    let versions;
    try { versions = await this.store.history(n.path); } catch (e) {
      $('.cb-drawer-body', d).innerHTML = `<p class="cb-text">${esc(e.message)}</p>`;
      return;
    }
    if (d.hidden) return;
    const body = $('.cb-drawer-body', d);
    body.innerHTML = `
      <p class="cb-text">Every save is kept. Pick a version to see it, and restore it if you want it back.</p>
      <ol class="cb-versions">${versions.map((v, i) => `
        <li><button type="button" class="cb-version" data-i="${i}">
          <span class="cb-version-date">${esc(longDate(v.date))}${i === 0 ? ' <span class="cb-badge">Current</span>' : ''}</span>
          <span class="cb-version-msg">${esc(v.message.split('\n')[0])}</span>
        </button></li>`).join('')}</ol>
      ${versions.length >= 100 ? '<p class="cb-text">Showing the latest 100 versions. Older ones are on GitHub.</p>' : ''}
      <a class="cb-linkbtn" href="https://github.com/${esc(this.settings.owner)}/${esc(this.settings.repo)}/commits/${esc(this.store.gh.branch)}/${esc(n.path)}" target="_blank" rel="noopener">See the full history on GitHub</a>`;
    body.onclick = e => {
      const b = e.target.closest('.cb-version');
      if (!b) return;
      const v = versions[Number(b.dataset.i)];
      this.showVersion(n.path, v.sha, v.date, { isCurrent: b.dataset.i === '0', back: () => this.showHistory() });
    };
  }

  async showVersion(path, ref, date, { isCurrent = false, back = null, highlight = '' } = {}) {
    const d = this.openDrawer(`${this.drawerHead('Older version')}<div class="cb-drawer-body"><p class="cb-text">Loading…</p></div>`);
    let v;
    try { v = await this.store.versionAt(path, ref); } catch (e) { $('.cb-drawer-body', d).innerHTML = `<p class="cb-text">${esc(e.message)}</p>`; return; }
    if (!v) { $('.cb-drawer-body', d).innerHTML = '<p class="cb-text">That version couldn’t be found.</p>'; return; }
    const exists = this.store.notes.get(path);
    const body = $('.cb-drawer-body', d);
    body.innerHTML = `
      <div class="cb-version-head">
        ${back ? `<button type="button" class="cb-linkbtn" data-act="back">${icon('back')}All versions</button>` : ''}
        <div class="cb-version-title">${esc(v.title)}</div>
        <div class="cb-meta">${esc(longDate(date))} · <code>${esc(path)}</code></div>
        ${highlight ? `<p class="cb-text">Contains: “${esc(highlight.slice(0, 160))}”</p>` : ''}
        <div class="cb-row-left">
          ${isCurrent ? '<span class="cb-text">This is the current version.</span>' : exists
            ? '<button type="button" class="cb-btn cb-btn-primary" data-act="restore">Restore this version</button><button type="button" class="cb-btn" data-act="open">Open current note</button>'
            : '<button type="button" class="cb-btn cb-btn-primary" data-act="revive">Restore as a note</button>'}
        </div>
      </div>
      <div class="cb-preview cb-editor" id="cb-preview"></div>`;
    if (this.previewEditor) { try { this.previewEditor.destroy(); } catch { /* ignore */ } }
    this.previewEditor = createEditor({ element: $('#cb-preview', body), markdown: v.body, editable: false });
    body.onclick = async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      try {
        if (act === 'back') back();
        if (act === 'open') { await this.openNote(exists, { keepDrawer: true }); }
        if (act === 'restore') {
          const ok = await confirmBox({ title: 'Restore this version?', text: 'It becomes the current version. The version it replaces stays in the history, so nothing is lost.', ok: 'Restore' });
          if (!ok) return;
          if (this.current?.path === path) { this.dirty = false; this.saveSoon.cancel(); if (this.saving) await this.saving; }
          const cur = this.store.notes.get(path);
          const saved = await this.store.restoreVersion(cur, v, longDate(date));
          await this.openNote(saved);
          toast('Version restored.');
        }
        if (act === 'revive') {
          const saved = await this.store.saveNote({ path: null, data: { created: v.created || nowIso() } }, { title: v.title, body: v.body, tags: v.tags, folder: dirname(path).startsWith(TRASH) ? '' : dirname(path) });
          await this.openNote(saved);
          toast('Restored as a note.');
        }
      } catch (err) {
        toast(err.message, { error: true });
      }
    };
  }

  showOldVersion(path, ref, date, text) {
    this.showVersion(path, ref, date, { highlight: text });
  }

  showFile() {
    const n = this.current;
    if (!n) return;
    const p = this.parts();
    const text = this.store.compose({ ...n, data: { ...(n.data || {}) } }, p).replace(/^updated: .*$/m, `updated: ${n.updated || nowIso()}`);
    const path = n.path || `${p.folder ? p.folder + '/' : ''}(named when first saved).md`;
    this.openDrawer(`${this.drawerHead('As stored in GitHub')}
      <div class="cb-drawer-body">
        <div class="cb-file-path"><code>${esc(path)}</code></div>
        <p class="cb-text">This plain-text file is what’s saved to your repository. GitHub keeps every version, and Claude can read and edit it directly.</p>
        ${n.path ? `<a class="cb-linkbtn" href="${esc(this.githubUrl(n.path))}" target="_blank" rel="noopener">${icon('link')}Open on GitHub</a>` : ''}
        <pre class="cb-file">${esc(text)}</pre>
      </div>`);
  }

  // ---------------------------------------------------------------- trash

  async showTrash() {
    if (!(await this.flush())) return;
    this.view = 'trash';
    this.destroyEditor();
    this.current = null;
    this.toggleNoteTools(false);
    this.closeDrawer();
    $('#cb-app').classList.add('show-note');
    const items = [...this.store.trash.values()].sort((a, b) => String(b.data.deleted || '').localeCompare(String(a.data.deleted || '')));
    $('#cb-page').innerHTML = `
      <div class="cb-trash">
        <h1 class="cb-title-static">Trash</h1>
        <p class="cb-text">Deleted notes stay here until you delete them for good. Even then, GitHub’s history still has them.</p>
        ${items.length ? `<div class="cb-row-left"><button type="button" class="cb-btn cb-btn-danger" data-act="empty">Empty the Trash</button></div>` : ''}
        <div class="cb-trash-list">${items.map(n => `
          <div class="cb-trash-item" data-path="${esc(n.path)}">
            <div class="cb-trash-main">
              <div class="cb-item-title"><span>${esc(n.title)}</span></div>
              <div class="cb-item-snip">${esc(n.plain.slice(0, 160))}</div>
              <div class="cb-item-meta"><span>Deleted ${esc(friendlyDate(n.data.deleted))}</span><span>from <code>${esc(n.data.deletedFrom || '')}</code></span></div>
            </div>
            <div class="cb-trash-acts">
              <button type="button" class="cb-btn cb-btn-primary cb-btn-small" data-act="restore">${icon('restore')}Restore</button>
              <button type="button" class="cb-btn cb-btn-small" data-act="purge">Delete for good</button>
            </div>
          </div>`).join('') || '<p class="cb-list-empty">The Trash is empty.</p>'}</div>
      </div>`;
    this.renderSidebar();
    $('#cb-page').onclick = async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      const path = e.target.closest('[data-path]')?.dataset.path;
      const item = path && this.store.trash.get(path);
      try {
        if (act === 'restore' && item) {
          const restored = await this.store.restoreNote(item);
          toast(`Restored to ${dirname(restored.path) || 'the top level'}.`);
          await this.openNote(restored);
        }
        if (act === 'purge' && item) {
          const ok = await confirmBox({ title: `Delete “${item.title}” for good?`, text: 'It disappears from the Trash. GitHub’s history still has it.', ok: 'Delete for good', danger: true });
          if (ok) { await this.store.purge([item]); this.showTrash(); }
        }
        if (act === 'empty') {
          const ok = await confirmBox({ title: 'Empty the Trash?', text: `${items.length} note${items.length === 1 ? '' : 's'} will be deleted for good. GitHub’s history still has them.`, ok: 'Empty the Trash', danger: true });
          if (ok) { await this.store.purge(items); this.showTrash(); }
        }
      } catch (err) {
        toast(err.message, { error: true });
      }
    };
  }

  // ---------------------------------------------------------------- menus

  mainMenu(anchor) {
    this.popover(anchor, `
      <button type="button" class="cb-pop-item" data-act="folder">${icon('folderPlus')}New folder</button>
      <button type="button" class="cb-pop-item" data-act="tags">${icon('tag')}Manage tags</button>
      <button type="button" class="cb-pop-item" data-act="trash">${icon('trash')}Trash</button>
      <button type="button" class="cb-pop-item" data-act="refresh">${icon('refresh')}Check for changes</button>
      <div class="cb-pop-sep"></div>
      <a class="cb-pop-item" href="https://github.com/${esc(this.settings.owner)}/${esc(this.settings.repo)}" target="_blank" rel="noopener">${icon('link')}Open repository on GitHub</a>
      <button type="button" class="cb-pop-item" data-act="signout">${icon('logout')}Sign out on this device</button>`, pop => {
      pop.addEventListener('click', async e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        this.closePopover();
        if (act === 'folder') this.createFolder('');
        if (act === 'tags') this.manageTags();
        if (act === 'trash') this.showTrash();
        if (act === 'refresh') { await this.checkForChanges(); toast('Up to date.'); }
        if (act === 'signout') this.signOut();
      });
    });
  }

  async signOut() {
    const ok = await confirmBox({ title: 'Sign out on this device?', text: 'The access key is removed from this browser. Your notes stay safe on GitHub.', ok: 'Sign out' });
    if (!ok) return;
    if (!(await this.flush().catch(() => true))) return;
    local.del('cb:settings');
    location.reload();
  }

  popover(anchor, html, bind) {
    this.closePopover();
    const pop = document.createElement('div');
    pop.className = 'cb-pop';
    pop.setAttribute('role', 'menu');
    pop.innerHTML = html;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.min(r.left, innerWidth - w - 8);
    if (r.right > innerWidth / 2) left = Math.max(8, r.right - w);
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = top + 'px';
    bind?.(pop);
    pop.querySelector('button, input, a')?.focus();
    const away = e => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) this.closePopover(); };
    const esc_ = e => { if (e.key === 'Escape') { this.closePopover(); anchor.focus(); } };
    setTimeout(() => { document.addEventListener('mousedown', away); document.addEventListener('keydown', esc_); }, 0);
    this.popClose = () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc_); pop.remove(); };
  }

  closePopover() { this.popClose?.(); this.popClose = null; }
}
