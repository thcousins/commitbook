// The page someone sees when they open a share link: one note, read-only, kept up to date.

import { createEditor } from './editor/editor.js';
import { jumpToAnchor } from './editor/heading-anchors.js';
import { esc, longDate } from './lib/util.js';
import { icon } from './ui/icons.js';

const REFRESH_EVERY = 60_000;

export function showShared(root, token) {
  root.innerHTML = `
    <div class="cb-shared">
      <main class="cb-shared-page" id="cb-shared-page"><p class="cb-text">Loading…</p></main>
      <footer class="cb-shared-foot">${icon('logo')}Shared with Commitbook · read-only</footer>
    </div>`;
  const page = root.querySelector('#cb-shared-page');
  let editor = null;
  let last = null;
  let timer = null;
  let first = true;

  const gone = () => {
    clearInterval(timer);
    editor?.destroy();
    editor = null;
    document.title = 'Note not available';
    page.innerHTML = `
      <div class="cb-empty">
        <h2>This note isn’t available</h2>
        <p>The link may have been copied incorrectly, or the owner has stopped sharing it.</p>
      </div>`;
  };

  const load = async () => {
    let r;
    try {
      r = await fetch(`api/shared.php?t=${encodeURIComponent(token)}`, { cache: 'no-store', credentials: 'omit' });
    } catch {
      return;                       // offline: keep showing what we have
    }
    if (r.status === 404) { gone(); return; }
    if (!r.ok) return;
    const note = await r.json();
    const key = JSON.stringify(note);
    if (key === last) return;
    last = key;
    document.title = note.title || 'Shared note';
    const scroller = root.querySelector('.cb-shared');
    const scroll = scroller.scrollTop;
    editor?.destroy();
    page.innerHTML = `
      <h1 class="cb-title-static">${esc(note.title)}</h1>
      <div class="cb-meta">${note.updated ? `<span>Last updated ${esc(longDate(note.updated))}</span><span class="cb-meta-sep">·</span>` : ''}<span>Read-only</span></div>
      <div class="cb-editor cb-shared-body"></div>`;
    editor = createEditor({ element: page.querySelector('.cb-shared-body'), markdown: note.body || '', editable: false });
    scroller.scrollTop = scroll;
    // A link to a section of a shared note (…/s/<token>#costs-so-far) opens at that section.
    if (first && location.hash) jumpToAnchor(page, location.hash);
    first = false;
  };

  load();
  timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && timer) load(); });
}
