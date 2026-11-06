import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderListItem, markerFor } from '../../src/lib/listmd.js';
// Tested with a stand-in for TipTap's block renderer.
const p = text => ({ type: 'paragraph', text });
const block = n => n.text;
const li = (text, ...kids) => ({ type: 'listItem', content: [p(text), ...kids] });
const ul = (...items) => ({ type: 'bulletList', content: items });
const ol = (...items) => ({ type: 'orderedList', attrs: { start: 1 }, content: items });

test('bullets under a numbered step keep the same indent', () => {
  const list = ol(li('Step one', ul(li('a'), li('b'), li('c'))), li('Step two'));
  const out = list.content.map((it, i) => renderListItem(it, markerFor(list, it, i), block)).join('\n');
  assert.equal(out, '1. Step one\n   - a\n   - b\n   - c\n2. Step two');
});

test('deeper nesting and mixed lists', () => {
  const item = li('Top', ul(li('a', ol(li('x'), li('y'))), li('b')), p('More text'));
  assert.equal(renderListItem(item, '- ', block), '- Top\n  - a\n    1. x\n    2. y\n  - b\n\n  More text');
  const tasks = { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('done')] }, { type: 'taskItem', attrs: { checked: false }, content: [p('todo')] }] };
  assert.equal(renderListItem(li('Jobs', tasks), '10. ', block), '10. Jobs\n    - [x] done\n    - [ ] todo');
});
