// Writing list items to Markdown with the right indentation (see src/editor/list-markdown.js).

export const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

/** The marker for the item at `index` in `list`. */
export function markerFor(list, item, index) {
  if (item.type === 'taskItem') return `- [${item.attrs?.checked ? 'x' : ' '}] `;
  if (list?.type === 'orderedList') return `${(Number(list.attrs?.start) || 1) + index}. `;
  return '- ';
}

/**
 * Markdown for one list item. `renderBlock(node)` turns a non-list block (a paragraph,
 * code block, quote…) into Markdown; lists inside the item are handled here.
 */
export function renderListItem(item, prefix, renderBlock) {
  const content = item.content || [];
  const pad = ' '.repeat(prefix.length);
  const indent = text => String(text).split('\n').map(l => (l ? pad + l : l)).join('\n');
  const first = content[0];
  const startsWithText = first && !LISTS.has(first.type);
  let out = prefix + (startsWithText ? renderBlock(first) : '');
  for (const child of startsWithText ? content.slice(1) : content) {
    if (LISTS.has(child.type)) {
      const items = (child.content || []).map((it, i) => renderListItem(it, markerFor(child, it, i), renderBlock));
      out += '\n' + indent(items.join('\n'));
    } else {
      out += '\n\n' + indent(renderBlock(child));
    }
  }
  return out;
}
