// Spreadsheets inside notes are stored as ordinary Markdown tables, so they stay
// readable on GitHub and easy to edit by hand:
//
//   <!-- commitbook:sheet {"totals":1,"widths":[180,120],"formats":{"2":"gbp"}} -->
//   | Item        | Supplier | Cost (£)   |
//   | ----------- | -------- | ---------- |
//   | Oak worktop | Howdens  | 640        |
//   | Total       |          | =SUM(C:C)  |
//
// * The header row holds the column names.
// * Data rows follow. Row 1 in formulas is the first data row (the header isn't counted).
// * The last `totals` rows are total rows: pinned at the bottom, never sorted or filtered,
//   and their formulas only see the data rows, so =SUM(C:C) is safe.
// * The comment line holds optional display settings. A table without it still loads.

const COMMENT_RE = /^<!--\s*commitbook:sheet\s*(\{[\s\S]*?\})?\s*-->[ \t]*(?:\n|$)/;
const SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

export function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells.map(c => c.replace(/<br\s*\/?>/gi, ' '));
}

/** Try to read a sheet at the very start of `src`. Returns null if there isn't one. */
export function readSheet(src) {
  let pos = 0;
  let meta = {};
  const cm = src.match(COMMENT_RE);
  if (cm) {
    try { meta = cm[1] ? JSON.parse(cm[1]) : {}; } catch { meta = {}; }
    pos = cm[0].length;
  }
  const rest = src.slice(pos);
  const lines = rest.split('\n');
  if (lines.length < 2 || !lines[0].includes('|') || !SEP_RE.test(lines[1]) || !lines[1].includes('-')) return null;
  const header = splitRow(lines[0]);
  let used = lines[0].length + 1 + lines[1].length + 1;
  const body = [];
  for (let i = 2; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || !l.includes('|')) break;
    body.push(splitRow(l));
    used += l.length + 1;
  }
  const width = Math.max(header.length, ...body.map(r => r.length));
  const pad = r => { const x = r.slice(0, width); while (x.length < width) x.push(''); return x; };
  const totalsCount = Math.max(0, Math.min(Number(meta.totals) || 0, body.length));
  const rows = body.slice(0, body.length - totalsCount).map(pad);
  const totals = body.slice(body.length - totalsCount).map(pad);
  const raw = src.slice(0, Math.min(src.length, pos + used));
  return {
    raw: raw.endsWith('\n') ? raw : raw,
    sheet: {
      columns: pad(header),
      rows,
      totals,
      widths: Array.isArray(meta.widths) ? meta.widths.slice(0, width) : [],
      formats: meta.formats && typeof meta.formats === 'object' ? meta.formats : {},
    },
  };
}

/** Index in `src` where a sheet might begin (used by the Markdown tokenizer). */
export function sheetStart(src) {
  const a = src.search(/(^|\n)<!--\s*commitbook:sheet/);
  const b = src.search(/(^|\n)[^\n]*\|[^\n]*\n\s*\|?\s*:?-{3,}/);
  const idx = [a, b].filter(i => i >= 0).map(i => (src[i] === '\n' ? i + 1 : i));
  return idx.length ? Math.min(...idx) : -1;
}

const cellText = v => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

export function writeSheet(sheet) {
  const width = Math.max(1, sheet.columns.length);
  const all = [sheet.columns, ...sheet.rows, ...sheet.totals].map(r => {
    const x = r.slice(0, width).map(cellText);
    while (x.length < width) x.push('');
    return x;
  });
  const colW = Array.from({ length: width }, (_, c) => Math.min(40, Math.max(3, ...all.map(r => r[c].length))));
  const line = r => '| ' + r.map((v, c) => v.padEnd(colW[c])).join(' | ') + ' |';
  const meta = {};
  if (sheet.totals.length) meta.totals = sheet.totals.length;
  if (sheet.widths && sheet.widths.some(Boolean)) meta.widths = sheet.widths.slice(0, width).map(w => Math.round(w) || 0);
  const formats = Object.fromEntries(Object.entries(sheet.formats || {}).filter(([k, v]) => v && v !== 'general' && Number(k) < width));
  if (Object.keys(formats).length) meta.formats = formats;
  const comment = `<!-- commitbook:sheet${Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''} -->`;
  return [
    comment,
    line(all[0]),
    '| ' + colW.map(w => '-'.repeat(w)).join(' | ') + ' |',
    ...all.slice(1).map(line),
  ].join('\n');
}

/** A new spreadsheet: three unnamed columns (shown as A, B, C) and five empty rows. */
export function emptySheet() {
  return {
    columns: ['', '', ''],
    rows: Array.from({ length: 5 }, () => ['', '', '']),
    totals: [],
    widths: [],
    formats: {},
  };
}

/**
 * Column names are optional. An empty name shows as the column letter. Names that are
 * just the letter, or the old automatic "Column B", count as no name.
 */
export function columnLetter(i) {
  let s = '';
  i++;
  while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
export function isAutoName(name, i) {
  const n = String(name ?? '').trim();
  return n === '' || n === columnLetter(i) || n === `Column ${columnLetter(i)}`;
}
