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
      let view;
      try {
        view = makeView();
      } catch (err) {
        // Never let a spreadsheet stop the note from opening: show the table as text.
        console.error('Spreadsheet failed to load', err);
        const dom = document.createElement('div');
        dom.className = 'cb-sheet cb-sheet-broken';
        dom.contentEditable = 'false';
        const msg = document.createElement('p');
        msg.textContent = 'This spreadsheet couldn’t be displayed, so here it is as text. It is saved unchanged.';
        const pre = document.createElement('pre');
        pre.textContent = writeSheet(node.attrs.data || emptySheet());
        dom.append(msg, pre);
        return { dom, ignoreMutation: () => true, stopEvent: () => true, update: next => next.type === current.type };
      }
      return wire(view);

      function makeView() {
        return new SheetView({
        data: node.attrs.data,
        editable: editor.isEditable,
        onChange: data => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          view.lastWritten = JSON.stringify(data);
          editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, data }));
        },
      });
      }

      function wire(view) {
      // Clicking the spreadsheet's header bar selects the whole block (Delete then removes it).
      view.onSelectSheet = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos != null) editor.chain().focus().setNodeSelection(pos).run();
      };
      view.onEnterSheet = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        const sel = editor.state.selection;
        if (pos != null && sel.from === pos && sel.to === pos + current.nodeSize) {
          editor.commands.setTextSelection(Math.min(pos + current.nodeSize, editor.state.doc.content.size));
        }
        if (editor.view.hasFocus()) editor.view.dom.blur();
      };
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
        selectNode() { view.setSelected(true); },
        deselectNode() { view.setSelected(false); },
        destroy: () => view.destroy(),
      };
      }
    };
  },
});
