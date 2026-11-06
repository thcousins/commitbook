// Gives each heading an id (GitHub-style, from its text) and makes links to "#…" scroll
// to that heading, in the editor, in read-only views and on shared pages. The ids are only
// on the page: nothing is added to the note's file.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { slugger } from '../lib/anchors.js';

const key = new PluginKey('commitbookHeadingAnchors');

function decorate(doc) {
  const slug = slugger();
  const decos = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { id: slug(node.textContent) }));
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

/** Scroll to the heading a "#…" link points at. Returns true if there was one. */
export function jumpToAnchor(root, hash) {
  let id = String(hash || '').replace(/^#/, '');
  try { id = decodeURIComponent(id); } catch { /* use as is */ }
  if (!id) return false;
  const target = [...root.querySelectorAll('h1[id], h2[id], h3[id]')].find(h => h.id === id || h.id === id.toLowerCase());
  if (!target) return false;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  target.classList.remove('cb-anchor-flash');
  void target.offsetWidth;          // restart the highlight
  target.classList.add('cb-anchor-flash');
  return true;
}

export const HeadingAnchors = Extension.create({
  name: 'commitbookHeadingAnchors',

  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: (_, state) => decorate(state.doc),
        apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
      },
      props: {
        decorations: state => key.getState(state),
      },
      view: view => {
        // Catch the click before the editor or the link extension handles it.
        const onClick = e => {
          const a = e.target.closest?.('a[href^="#"]');
          if (!a || !view.dom.contains(a) || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          e.stopPropagation();
          jumpToAnchor(view.dom, a.getAttribute('href'));
        };
        view.dom.addEventListener('click', onClick, true);
        return { destroy: () => view.dom.removeEventListener('click', onClick, true) };
      },
    })];
  },
});
