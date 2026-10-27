import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontMatter, joinFrontMatter } from '../../src/lib/frontmatter.js';
import { readSheet, writeSheet, sheetStart, splitRow } from '../../src/lib/sheetmd.js';
import { mapRowRefs, sortRows } from '../../src/lib/refs.js';
import { formatValue, toNumber } from '../../src/lib/format.js';
import { slugify, uniquePath, plainText, toBase64, fromBase64 } from '../../src/lib/util.js';

test('front matter round trip', () => {
  const text = joinFrontMatter({ title: 'Boiler: "service"', created: '2026-10-14T09:12:00Z', updated: '2026-10-20T18:40:11Z', tags: ['House', 'Annual'] }, 'Body\n\n## More');
  assert.equal(text, '---\ntitle: "Boiler: \\"service\\""\ncreated: 2026-10-14T09:12:00Z\nupdated: 2026-10-20T18:40:11Z\ntags: ["House", "Annual"]\n---\n\nBody\n\n## More\n');
  const { data, body } = splitFrontMatter(text);
  assert.equal(data.title, 'Boiler: "service"');
  assert.deepEqual(data.tags, ['House', 'Annual']);
  assert.equal(data.created, '2026-10-14T09:12:00Z');
  assert.equal(body, 'Body\n\n## More\n');
});

test('front matter: hand-written variants and none at all', () => {
  const a = splitFrontMatter('---\ntitle: Plain title\ntags:\n  - One\n  - Two\nextra: keep me\n---\nHello');
  assert.equal(a.data.title, 'Plain title');
  assert.deepEqual(a.data.tags, ['One', 'Two']);
  assert.equal(a.data.extra, 'keep me');
  assert.equal(a.body, 'Hello');
  assert.deepEqual(splitFrontMatter('tags: [a, b]').data, {});
  assert.deepEqual(splitFrontMatter('---\ntags: [a, b]\n---\n').data.tags, ['a', 'b']);
  assert.ok(!joinFrontMatter({ title: 'x', tags: [] }, '').includes('tags'));
  assert.ok(joinFrontMatter({ title: 'x', extra: 'kept' }, '').includes('extra: "kept"'));
});

test('sheet markdown round trip', () => {
  const md = [
    '<!-- commitbook:sheet {"totals":1,"formats":{"2":"gbp"}} -->',
    '| Item | Supplier | Cost (£) |',
    '| --- | --- | --- |',
    '| Oak worktop | Howdens | 640 |',
    '| Pipe \\| fittings | Screwfix | 12.5 |',
    '| Total |  | =SUM(C:C) |',
    '',
    'After the table',
  ].join('\n');
  assert.equal(sheetStart(md), 0);
  const r = readSheet(md);
  assert.ok(r);
  assert.deepEqual(r.sheet.columns, ['Item', 'Supplier', 'Cost (£)']);
  assert.deepEqual(r.sheet.rows, [['Oak worktop', 'Howdens', '640'], ['Pipe | fittings', 'Screwfix', '12.5']]);
  assert.deepEqual(r.sheet.totals, [['Total', '', '=SUM(C:C)']]);
  assert.deepEqual(r.sheet.formats, { 2: 'gbp' });
  assert.ok(!r.raw.includes('After'));
  const out = writeSheet(r.sheet);
  const again = readSheet(out);
  assert.deepEqual(again.sheet, r.sheet);
  assert.ok(out.includes('Pipe \\| fittings'));
});

test('plain tables load as sheets; non-tables do not', () => {
  const r = readSheet('Name | Qty\n---|---\nA | 1\nB | 2\n');
  assert.deepEqual(r.sheet.columns, ['Name', 'Qty']);
  assert.equal(r.sheet.rows.length, 2);
  assert.equal(r.sheet.totals.length, 0);
  assert.equal(readSheet('Just | a pipe in text\nand more text'), null);
  assert.equal(sheetStart('Some text\n\n| A | B |\n| - | - |'), -1); // one dash isn't a separator
  assert.equal(sheetStart('Some text\n\n| A | B |\n| --- | --- |'), 11);
  assert.deepEqual(splitRow('| a | b |'), ['a', 'b']);
});

test('row references follow sorted rows', () => {
  assert.equal(mapRowRefs('=C2*2+$D$2+D$3+LOG10(A2)+"A2"', r => r + 1), '=C3*2+$D$2+D$3+LOG10(A3)+"A2"');
  const rows = [['Kwik', '118', '=B1*2'], ['Halfords', '112', '=B2*2'], ['Local', '105', '=B3*2']];
  const sorted = sortRows(rows, 1, 1);
  assert.deepEqual(sorted, [['Local', '105', '=B1*2'], ['Halfords', '112', '=B2*2'], ['Kwik', '118', '=B3*2']]);
  const text = sortRows([['b'], [''], ['A'], ['c']], 0, 1).map(r => r[0]);
  assert.deepEqual(text, ['A', 'b', 'c', '']);
  const desc = sortRows([['b'], [''], ['A'], ['c']], 0, -1).map(r => r[0]);
  assert.deepEqual(desc, ['c', 'b', 'A', '']);
});

test('number formats', () => {
  assert.equal(formatValue(1234.5, 'gbp'), '£1,234.50');
  assert.equal(formatValue(-3, 'gbp'), '-£3.00');
  assert.equal(formatValue(0.125, 'percent'), '12.5%');
  assert.equal(formatValue('640', 'general'), '640');
  assert.equal(formatValue(306.5, 'general', { isFormula: true }), '306.5');
  assert.equal(formatValue(0.1 + 0.2, 'general', { isFormula: true }), '0.3');
  assert.equal(formatValue('hello', 'number'), 'hello');
  assert.equal(toNumber('£1,234.50'), 1234.5);
  assert.equal(toNumber('12%'), 0.12);
});

test('names, paths and text helpers', () => {
  assert.equal(slugify('Car – MOT & tyres'), 'car-mot-and-tyres');
  assert.equal(slugify('   '), 'untitled-note');
  assert.equal(slugify('Café notes'), 'cafe-notes');
  assert.equal(uniquePath('House', 'boiler', new Set(['house/boiler.md'])), 'House/boiler-2.md');
  assert.equal(plainText('## Head\n- [x] Done thing\n| A | B |\n| --- | --- |\n**bold** [link](http://x)'), 'Head Done thing A B bold link');
  assert.equal(fromBase64(toBase64('£ and ✓ and 🙂')), '£ and ✓ and 🙂');
});

test('previews leave out spreadsheet contents', async () => {
  const { previewText } = await import('../../src/lib/util.js');
  assert.equal(previewText('Intro\n\n<!-- commitbook:sheet -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter'), 'Intro After');
});
