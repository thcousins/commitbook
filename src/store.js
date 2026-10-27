// The notebook's state, loaded from and saved to the GitHub data repository.
//
// Repository layout (see docs/data-format.md):
//   <folder>/<note>.md         a note; folders are ordinary folders
//   <folder>/.keep             marks an empty folder
//   .commitbook/tags.json      tag names and colours
//   .trash/<original path>     notes in the Trash
//   README.md, CLAUDE.md       about the repo (not notes)

import { GitHubRepo, ConflictError, GitHubError, gitBlobSha } from './github.js';
import { splitFrontMatter, joinFrontMatter } from './lib/frontmatter.js';
import { createCache, local } from './lib/cache.js';
import { slugify, dirname, basename, joinPath, uniquePath, nowIso, pool, plainText, previewText } from './lib/util.js';
import { DATA_README, DATA_CLAUDE } from './templates.js';

export const TAGS_PATH = '.commitbook/tags.json';
export const TRASH = '.trash';
const ROOT_DOCS = new Set(['readme.md', 'claude.md', 'agents.md', 'changelog.md', 'license.md', 'contributing.md']);
export const TAG_COLOURS = ['#3f51b5', '#2e7d5b', '#b4541a', '#a13a6b', '#2b7a9e', '#7a5c00', '#6b4fbf', '#b23a3a', '#4f6b2b', '#5a6270'];

const isHidden = p => p.split('/').some(seg => seg.startsWith('.'));

function noteFrom(path, text, sha) {
  const { data, body } = splitFrontMatter(text);
  const title = String(data.title || '').trim() || basename(path).replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
  return {
    path,
    sha,
    text,
    data,
    body,
    title,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    created: data.created || null,
    updated: data.updated || data.created || null,
    plain: plainText(body),
    preview: previewText(body),
  };
}

export class Store {
  constructor({ owner, repo, token, fetchImpl, cacheName }) {
    this.gh = new GitHubRepo({ owner, repo, token, fetchImpl });
    this.key = `${owner}/${repo}`;
    this.cache = createCache(cacheName || this.key);
    this.notes = new Map();      // path -> note
    this.trash = new Map();      // path (inside .trash) -> note
    this.folders = new Set();    // 'House', 'House/Kitchen'
    this.keeps = new Map();      // folder -> sha of its .keep file
    this.tags = [];              // [{ name, color }]
    this.tagsSha = null;
    this.head = null;
    this.listeners = new Set();
    this.busy = 0;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what, detail) { for (const fn of this.listeners) fn(what, detail); }

  async track(fn) {
    this.busy++;
    this.emit('busy', this.busy);
    try { return await fn(); } finally { this.busy--; this.emit('busy', this.busy); }
  }

  // ---------------------------------------------------------------- loading

  async connect() {
    const repo = await this.gh.getRepo();
    if (repo.permissions && repo.permissions.push === false) {
      throw new GitHubError('The access key can read this repository but not save to it. It needs “Contents: Read and write”.', 403);
    }
    this.repoInfo = repo;
    return repo;
  }

  /** Load everything. Returns { initialised } — true if the repo was empty and has just been set up. */
  async load() {
    return this.track(async () => {
      let head = await this.gh.getHead();
      let initialised = false;
      if (!head) {
        await this.initialise();
        head = await this.gh.getHead();
        initialised = true;
      }
      await this.readTree(head);
      return { initialised };
    });
  }

  async initialise() {
    await this.gh.putFile('README.md', DATA_README, { message: 'Set up Commitbook' });
    await this.gh.putFile('CLAUDE.md', DATA_CLAUDE, { message: 'Add instructions for Claude' });
    await this.gh.putFile(TAGS_PATH, JSON.stringify({ tags: [] }, null, 2) + '\n', { message: 'Add tag list' });
  }

  async readTree(head) {
    const { entries } = await this.gh.getTree(head);
    const notes = new Map(), trash = new Map(), folders = new Set(), keeps = new Map();
    const wanted = [];
    let tagsEntry = null;
    for (const e of entries) {
      const p = e.path;
      if (p === TAGS_PATH) { tagsEntry = e; continue; }
      if (p.startsWith(TRASH + '/')) {
        if (/\.md$/i.test(p)) wanted.push({ e, into: trash });
        continue;
      }
      if (isHidden(dirname(p))) continue;
      const name = basename(p);
      if (name === '.keep') {
        const f = dirname(p);
        if (f) { keeps.set(f, e.sha); addFolder(folders, f); }
        continue;
      }
      if (name.startsWith('.') || !/\.md$/i.test(name)) continue;
      if (!dirname(p) && ROOT_DOCS.has(name.toLowerCase())) continue;
      wanted.push({ e, into: notes });
      if (dirname(p)) addFolder(folders, dirname(p));
    }
    // Reuse what we already have, then fetch only new or changed files.
    await pool(wanted, 8, async ({ e, into }) => {
      const prev = this.notes.get(e.path) || this.trash.get(e.path);
      if (prev && prev.sha === e.sha) { into.set(e.path, prev); return; }
      let text = await this.cache.get('blob:' + e.sha);
      if (text === undefined) {
        text = await this.gh.getBlob(e.sha);
        this.cache.set('blob:' + e.sha, text);
      }
      into.set(e.path, noteFrom(e.path, text, e.sha));
    });
    if (tagsEntry && tagsEntry.sha !== this.tagsSha) {
      let text = await this.cache.get('blob:' + tagsEntry.sha);
      if (text === undefined) { text = await this.gh.getBlob(tagsEntry.sha); this.cache.set('blob:' + tagsEntry.sha, text); }
      try { this.tags = normaliseTags(JSON.parse(text).tags); } catch { this.tags = []; }
      this.tagsSha = tagsEntry.sha;
    } else if (!tagsEntry) {
      this.tags = []; this.tagsSha = null;
    }
    // Tags used in notes but missing from the list still get a colour.
    const known = new Set(this.tags.map(t => t.name.toLowerCase()));
    for (const n of notes.values()) for (const t of n.tags) {
      if (!known.has(t.toLowerCase())) { this.tags.push({ name: t, color: TAG_COLOURS[this.tags.length % TAG_COLOURS.length] }); known.add(t.toLowerCase()); }
    }
    this.notes = notes; this.trash = trash; this.folders = folders; this.keeps = keeps;
    this.head = head;
    this.emit('loaded');
  }

  /** Check GitHub for changes made elsewhere (e.g. by Claude). Returns the paths that changed. */
  async refresh() {
    const head = await this.gh.getHead();
    if (!head || head === this.head) return [];
    const before = new Map([...this.notes].map(([p, n]) => [p, n.sha]));
    await this.track(() => this.readTree(head));
    const changed = [];
    for (const [p, n] of this.notes) if (before.get(p) !== n.sha) changed.push(p);
    for (const p of before.keys()) if (!this.notes.has(p)) changed.push(p);
    return changed;
  }

  takenPaths() {
    return new Set([...this.notes.keys(), ...[...this.folders].map(f => f + '/.keep')].map(p => p.toLowerCase()));
  }

  // ---------------------------------------------------------------- notes

  /** Build the file text for a note from its parts. */
  compose(note, { title, body, tags }) {
    const data = { ...note.data };
    data.title = title;
    data.created = data.created || note.created || nowIso();
    data.updated = nowIso();
    data.tags = tags;
    return joinFrontMatter(data, body);
  }

  /**
   * Save a note. `note.path` null means a brand-new note, which gets a file name
   * from its title. Throws ConflictError if the file changed on GitHub meanwhile.
   */
  async saveNote(note, { title, body, tags, folder = '' }) {
    return this.track(async () => {
      const text = this.compose(note, { title, body, tags });
      const isNew = !note.path;
      const path = isNew ? uniquePath(folder, slugify(title), this.takenPaths()) : note.path;
      const message = `${isNew ? 'Add' : 'Edit'} “${title || 'Untitled note'}”`;
      const r = await this.gh.putFile(path, text, { sha: isNew ? null : note.sha, message });
      const saved = noteFrom(path, text, r.sha);
      this.cache.set('blob:' + r.sha, text);
      if (!isNew && note.path !== path) this.notes.delete(note.path);
      this.notes.set(path, saved);
      if (folder) addFolder(this.folders, folder);
      this.head = r.commit;
      for (const t of tags) this.ensureTag(t);
      this.emit('saved', saved);
      return saved;
    });
  }

  /** Overwrite whatever is on GitHub with our version (after a conflict). */
  async forceSave(note, parts) {
    // If the file was deleted elsewhere, this recreates it at the same path.
    const remote = await this.gh.getFile(note.path);
    return this.saveNote({ ...note, sha: remote ? remote.sha : null }, parts);
  }

  /** The current version of a note on GitHub (used to resolve conflicts). */
  async fetchRemote(path) {
    const f = await this.gh.getFile(path);
    return f ? noteFrom(path, f.text, f.sha) : null;
  }

  async moveNote(note, folder) {
    if (dirname(note.path) === folder) return note;
    return this.track(async () => {
      const taken = this.takenPaths();
      taken.delete(note.path.toLowerCase());
      const to = uniquePath(folder, basename(note.path).replace(/\.md$/i, ''), taken);
      const changes = [{ path: to, text: note.text }, { path: note.path, delete: true }];
      if (folder && this.keeps.has(folder)) changes.push({ path: folder + '/.keep', delete: true });
      const r = await this.gh.commitChanges(changes, `Move “${note.title}” to ${folder || 'the top level'}`, { expect: { [note.path]: note.sha, [to]: null } });
      this.notes.delete(note.path);
      if (folder && this.keeps.has(folder)) this.keeps.delete(folder);
      const moved = { ...note, path: to };
      this.notes.set(to, moved);
      if (folder) addFolder(this.folders, folder);
      this.head = r.commit;
      this.emit('changed');
      return moved;
    });
  }

  /** Move a note into the Trash (recoverable). */
  async trashNote(note) {
    return this.track(async () => {
      const taken = new Set([...this.trash.keys()].map(p => p.toLowerCase()));
      const to = uniquePath(joinPath(TRASH, dirname(note.path)), basename(note.path).replace(/\.md$/i, ''), taken);
      const { data, body } = splitFrontMatter(note.text);
      const text = joinFrontMatter({ ...data, deleted: nowIso(), deletedFrom: note.path }, body);
      const changes = [{ path: to, text }, { path: note.path, delete: true }];
      const folder = dirname(note.path);
      const othersInFolder = [...this.notes.keys()].some(p => p !== note.path && dirname(p) === folder) || [...this.folders].some(f => dirname(f) === folder && f !== folder);
      if (folder && !othersInFolder && !this.keeps.has(folder)) changes.push({ path: folder + '/.keep', text: '' });
      const r = await this.gh.commitChanges(changes, `Delete “${note.title}”`, { expect: { [note.path]: note.sha } });
      this.notes.delete(note.path);
      if (folder && !othersInFolder && !this.keeps.has(folder)) this.keeps.set(folder, await gitBlobSha(''));
      this.trash.set(to, noteFrom(to, text, await gitBlobSha(text)));
      this.head = r.commit;
      this.emit('changed');
    });
  }

  async restoreNote(item) {
    return this.track(async () => {
      const from = String(item.data.deletedFrom || basename(item.path));
      const folder = dirname(from);
      const taken = this.takenPaths();
      const to = uniquePath(folder, basename(from).replace(/\.md$/i, ''), taken);
      const { data, body } = splitFrontMatter(item.text);
      delete data.deleted; delete data.deletedFrom;
      const text = joinFrontMatter(data, body);
      const changes = [{ path: to, text }, { path: item.path, delete: true }];
      if (folder && this.keeps.has(folder)) changes.push({ path: folder + '/.keep', delete: true });
      const r = await this.gh.commitChanges(changes, `Restore “${item.title}”`);
      this.trash.delete(item.path);
      if (folder && this.keeps.has(folder)) this.keeps.delete(folder);
      const restored = noteFrom(to, text, await gitBlobSha(text));
      this.notes.set(to, restored);
      if (folder) addFolder(this.folders, folder);
      this.head = r.commit;
      this.emit('changed');
      return restored;
    });
  }

  async purge(items) {
    if (!items.length) return;
    return this.track(async () => {
      const r = await this.gh.commitChanges(items.map(i => ({ path: i.path, delete: true })),
        items.length === 1 ? `Permanently delete “${items[0].title}”` : `Empty the Trash (${items.length} notes)`);
      for (const i of items) this.trash.delete(i.path);
      this.head = r.commit;
      this.emit('changed');
    });
  }

  // ---------------------------------------------------------------- folders

  async createFolder(path) {
    path = path.split('/').map(s => s.trim()).filter(Boolean).join('/');
    if (!path) throw new Error('Give the folder a name.');
    if (path.split('/').some(s => s.startsWith('.'))) throw new Error('Folder names can’t start with a dot.');
    if (this.folders.has(path)) throw new Error('There is already a folder with that name.');
    return this.track(async () => {
      const r = await this.gh.putFile(path + '/.keep', '', { message: `New folder “${path}”` });
      this.keeps.set(path, r.sha);
      addFolder(this.folders, path);
      this.head = r.commit;
      this.emit('changed');
    });
  }

  async renameFolder(from, to) {
    to = to.split('/').map(s => s.trim()).filter(Boolean).join('/');
    if (!to || to === from) return;
    if (this.folders.has(to)) throw new Error('There is already a folder with that name.');
    if (to.startsWith(from + '/')) throw new Error('A folder can’t be moved inside itself.');
    return this.track(async () => {
      const inside = p => p === from || p.startsWith(from + '/');
      const move = p => to + p.slice(from.length);
      const changes = [];
      for (const n of this.notes.values()) if (inside(dirname(n.path))) changes.push({ path: move(n.path), text: n.text }, { path: n.path, delete: true });
      for (const [f] of this.keeps) if (inside(f)) changes.push({ path: move(f) + '/.keep', text: '' }, { path: f + '/.keep', delete: true });
      const r = await this.gh.commitChanges(changes, `Rename folder “${from}” to “${to}”`);
      const notes = new Map();
      for (const [p, n] of this.notes) notes.set(inside(dirname(p)) ? move(p) : p, inside(dirname(p)) ? { ...n, path: move(p) } : n);
      this.notes = notes;
      const keeps = new Map();
      for (const [f, s] of this.keeps) keeps.set(inside(f) ? move(f) : f, s);
      this.keeps = keeps;
      const folders = new Set();
      for (const f of this.folders) addFolder(folders, inside(f) ? move(f) : f);
      this.folders = folders;
      this.head = r.commit;
      this.emit('changed');
      return to;
    });
  }

  /** Delete a folder. Notes inside go to the Trash. */
  async deleteFolder(path) {
    return this.track(async () => {
      const inside = p => p === path || p.startsWith(path + '/');
      const changes = [];
      const moved = [];
      const taken = new Set([...this.trash.keys()].map(p => p.toLowerCase()));
      for (const n of this.notes.values()) {
        if (!inside(dirname(n.path))) continue;
        const to = uniquePath(joinPath(TRASH, dirname(n.path)), basename(n.path).replace(/\.md$/i, ''), taken);
        taken.add(to.toLowerCase());
        const { data, body } = splitFrontMatter(n.text);
        const text = joinFrontMatter({ ...data, deleted: nowIso(), deletedFrom: n.path }, body);
        changes.push({ path: to, text }, { path: n.path, delete: true });
        moved.push({ from: n.path, to, text });
      }
      for (const [f] of this.keeps) if (inside(f)) changes.push({ path: f + '/.keep', delete: true });
      if (!changes.length) { this.folders.delete(path); this.emit('changed'); return; }
      const r = await this.gh.commitChanges(changes, `Delete folder “${path}”`);
      for (const m of moved) {
        this.notes.delete(m.from);
        this.trash.set(m.to, noteFrom(m.to, m.text, await gitBlobSha(m.text)));
      }
      for (const f of [...this.keeps.keys()]) if (inside(f)) this.keeps.delete(f);
      for (const f of [...this.folders]) if (inside(f)) this.folders.delete(f);
      this.head = r.commit;
      this.emit('changed');
    });
  }

  // ---------------------------------------------------------------- tags

  tagColour(name) {
    const t = this.tags.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    return t ? t.color : '#6b7080';
  }

  ensureTag(name) {
    if (!this.tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      this.tags.push({ name, color: TAG_COLOURS[this.tags.length % TAG_COLOURS.length] });
      this.tagsDirty = true;
    }
  }

  tagsText() { return JSON.stringify({ tags: this.tags }, null, 2) + '\n'; }

  /** Save the tag list (names and colours) if it has changed. */
  async saveTags() {
    return this.track(async () => {
      const text = this.tagsText();
      try {
        const r = await this.gh.putFile(TAGS_PATH, text, { sha: this.tagsSha, message: 'Update tags' });
        this.tagsSha = r.sha; this.head = r.commit; this.tagsDirty = false;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        // Someone else changed the list: merge theirs with ours, then save again.
        const remote = await this.gh.getFile(TAGS_PATH);
        let theirs = [];
        try { theirs = normaliseTags(JSON.parse(remote.text).tags); } catch { /* ignore */ }
        for (const t of theirs) if (!this.tags.some(x => x.name.toLowerCase() === t.name.toLowerCase())) this.tags.push(t);
        const r = await this.gh.putFile(TAGS_PATH, this.tagsText(), { sha: remote ? remote.sha : null, message: 'Update tags' });
        this.tagsSha = r.sha; this.head = r.commit; this.tagsDirty = false;
      }
      this.emit('tags');
    });
  }

  async addTag(name, color) {
    name = String(name || '').trim();
    if (!name) throw new Error('Give the tag a name.');
    if (name.includes(',')) throw new Error('Tag names can’t contain commas.');
    if (this.tags.some(t => t.name.toLowerCase() === name.toLowerCase())) throw new Error('There is already a tag with that name.');
    this.tags.push({ name, color: color || TAG_COLOURS[this.tags.length % TAG_COLOURS.length] });
    await this.saveTags();
  }

  async recolourTag(name, color) {
    const t = this.tags.find(x => x.name === name);
    if (!t) return;
    t.color = color;
    await this.saveTags();
  }

  /** Rename a tag everywhere: the tag list and every note that uses it, in one commit. */
  async renameTag(from, to) {
    to = String(to || '').trim();
    if (!to || to === from) return;
    if (to.includes(',')) throw new Error('Tag names can’t contain commas.');
    if (this.tags.some(t => t.name.toLowerCase() === to.toLowerCase() && t.name.toLowerCase() !== from.toLowerCase())) throw new Error('There is already a tag with that name.');
    return this.rewriteTag(from, tags => tags.map(t => (t.toLowerCase() === from.toLowerCase() ? to : t)),
      list => list.map(t => (t.name === from ? { ...t, name: to } : t)), `Rename tag “${from}” to “${to}”`);
  }

  async deleteTag(name) {
    return this.rewriteTag(name, tags => tags.filter(t => t.toLowerCase() !== name.toLowerCase()),
      list => list.filter(t => t.name !== name), `Delete tag “${name}”`);
  }

  async rewriteTag(name, mapNoteTags, mapList, message) {
    return this.track(async () => {
      const changes = [];
      const updated = [];
      for (const n of this.notes.values()) {
        if (!n.tags.some(t => t.toLowerCase() === name.toLowerCase())) continue;
        const { data, body } = splitFrontMatter(n.text);
        const text = joinFrontMatter({ ...data, tags: mapNoteTags(n.tags) }, body);
        changes.push({ path: n.path, text });
        updated.push({ n, text });
      }
      const list = mapList(this.tags);
      changes.push({ path: TAGS_PATH, text: JSON.stringify({ tags: list }, null, 2) + '\n' });
      const r = await this.gh.commitChanges(changes, message);
      for (const { n, text } of updated) this.notes.set(n.path, noteFrom(n.path, text, await gitBlobSha(text)));
      this.tags = list;
      this.tagsSha = await gitBlobSha(this.tagsText());
      this.head = r.commit;
      this.emit('changed');
    });
  }

  // ---------------------------------------------------------------- history

  async history(path) {
    const commits = await this.gh.listCommits({ path, perPage: 100 });
    return commits;
  }

  async versionAt(path, sha) {
    const key = `ver:${sha}:${path}`;
    const hit = await this.cache.get(key);
    if (hit !== undefined) return hit === null ? null : noteFrom(path, hit, null);
    const f = await this.gh.getFile(path, sha);
    this.cache.set(key, f ? f.text : null);
    return f ? noteFrom(path, f.text, f.sha) : null;
  }

  /** Put an old version back as the current one (as a new commit, so nothing is lost). */
  async restoreVersion(note, version, date) {
    const { data, body } = splitFrontMatter(version.text);
    const parts = { title: String(data.title || note.title), body, tags: Array.isArray(data.tags) ? data.tags : [] };
    const keep = { ...note, data: { ...data, created: note.created || data.created } };
    return this.track(async () => {
      const text = this.compose(keep, parts);
      const r = await this.gh.putFile(note.path, text, { sha: note.sha, message: `Restore “${parts.title}” to the version from ${date}` });
      const saved = noteFrom(note.path, text, r.sha);
      this.notes.set(note.path, saved);
      this.head = r.commit;
      this.emit('saved', saved);
      return saved;
    });
  }

  /**
   * Search the text of older versions. Walks the commit history (cached, so only
   * new commits cost a request) and looks for the words in lines that were
   * removed or added. Calls onProgress(done, total).
   */
  async searchHistory(query, { onProgress, signal, limit = 1500 } = {}) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const commits = [];
    for (let page = 1; commits.length < limit; page++) {
      const batch = await this.gh.listCommits({ perPage: 100, page });
      commits.push(...batch);
      if (batch.length < 100) break;
      if (signal?.aborted) return [];
    }
    let done = 0;
    const details = await pool(commits.slice(0, limit), 6, async c => {
      if (signal?.aborted) return null;
      let d = await this.cache.get('commit:' + c.sha);
      if (d === undefined) {
        d = await this.gh.getCommit(c.sha);
        this.cache.set('commit:' + c.sha, d);
      }
      onProgress?.(++done, commits.length);
      return d;
    });
    const hits = new Map();
    for (const d of details) {
      if (!d) continue;
      for (const f of d.files) {
        if (!/\.md$/i.test(f.path) || f.path === TAGS_PATH) continue;
        for (const line of f.patch.split('\n')) {
          if (!(line.startsWith('-') || line.startsWith('+')) || line.startsWith('---') || line.startsWith('+++')) continue;
          const text = line.slice(1);
          if (!text.toLowerCase().includes(q)) continue;
          const removed = line.startsWith('-');
          const ref = removed ? d.parents[0] : d.sha;
          if (!ref) continue;
          const key = f.path + '\u0000' + text.trim();
          if (!hits.has(key)) hits.set(key, { path: f.path, ref, date: d.date, text: text.trim(), removed });
        }
      }
    }
    return [...hits.values()];
  }
}

function addFolder(set, folder) {
  const parts = folder.split('/');
  for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
}

function normaliseTags(list) {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const name = String(typeof t === 'string' ? t : t?.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, color: /^#[0-9a-f]{6}$/i.test(t?.color) ? t.color : TAG_COLOURS[out.length % TAG_COLOURS.length] });
  }
  return out;
}

export { ConflictError, GitHubError };
