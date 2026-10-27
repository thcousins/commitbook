// The spreadsheet as a block in the TipTap editor, read from and written to
// Markdown as a table (see src/lib/sheetmd.js).

import { Node } from '@tiptap/core';
import { readSheet, writeSheet, sheetStart, emptySheet } from '../lib/sheetmd.js';
import { SheetView } from './sheet-view.js';

export const Sheet = Node.create({
  name: 'commitbookSheet',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addAttributes() {
    return {
      data: {
        default: null,
        parseHTML: el => {
          try { return JSON.parse(el.getAttribute('data-sheet') || 'null'); } catch { return null; }
        },
        renderHTML: attrs => ({ 'data-sheet': JSON.stringify(attrs.data || emptySheet()) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="commitbook-sheet"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-type': 'commitbook-sheet', ...HTMLAttributes }];
  },

  markdownTokenizer: {
    name: 'commitbookSheet',
    level: 'block',
    start: src => sheetStart(src),
    tokenize: src => {
      const r = readSheet(src);
      if (!r) return undefined;
      return { type: 'commitbookSheet', raw: r.raw, sheet: r.sheet };
    },
  },

  parseMarkdown: token => ({ type: 'commitbookSheet', attrs: { data: token.sheet } }),

  renderMarkdown: node => writeSheet(node.attrs.data || emptySheet()),

  addCommands() {
    return {
      insertSheet: () => ({ chain }) => chain()
        .insertContent([{ type: this.name, attrs: { data: emptySheet() } }, { type: 'paragraph' }])
        .run(),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const view = new SheetView({
        data: node.attrs.data,
        editable: editor.isEditable,
        onChange: data => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          view.lastWritten = JSON.stringify(data);
          editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, data }));
        },
      });
      view.onRemove = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run();
      };
      return {
        dom: view.dom,
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          const json = JSON.stringify(next.attrs.data);
          if (json !== view.lastWritten) view.setData(next.attrs.data);
          view.lastWritten = json;
          return true;
        },
        // Keys, clicks and typing inside the grid belong to the grid, not the text editor.
        stopEvent: event => {
          const t = event.target;
          return !!(t && t.closest && t.closest('.cb-sheet'));
        },
        ignoreMutation: () => true,
        selectNode() { view.dom.classList.add('is-selected'); },
        deselectNode() { view.dom.classList.remove('is-selected'); },
        destroy: () => view.destroy(),
      };
    };
  },
});
