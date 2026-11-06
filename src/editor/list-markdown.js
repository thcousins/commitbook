// Writing list items back to Markdown.
//
// @tiptap/markdown 3.32.0 gets the indentation wrong for a bulleted list inside a
// numbered item: the first bullet is indented 3 spaces and the rest 5, so on the next load
// every bullet after the first sits one level deeper. Here each item, and any lists inside
// it, is written from the note's structure, indenting nested lines by exactly the width of
// the item's own marker ("- ", "1. ", "- [ ] "), which is what Markdown expects.

import { ListItem, TaskItem } from '@tiptap/extension-list';

import { markerFor, renderListItem } from '../lib/listmd.js';

const topMarker = (node, ctx) => {
  if (node.type === 'taskItem') return markerFor(null, node, 0);
  if (ctx?.parentType === 'orderedList') {
    const start = Number(ctx.meta?.parentAttrs?.start) || 1;
    return `${start + (ctx.index || 0)}. `;
  }
  return '- ';
};

const render = (node, h, ctx) => renderListItem(node, topMarker(node, ctx), block => h.renderChildren([block]));

export const FixedListItem = ListItem.extend({ renderMarkdown: render });
export const FixedTaskItem = TaskItem.extend({ renderMarkdown: render });
