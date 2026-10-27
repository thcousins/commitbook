// Rewriting cell references inside formulas, e.g. when rows are sorted.
// Row numbers are 1-based data rows (row 1 = first row under the column names).

const REF_RE = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g;

/** Apply fn(row) to every relative row number in a formula, skipping text in "quotes". */
export function mapRowRefs(formula, fn) {
  if (typeof formula !== 'string' || !formula.trim().startsWith('=')) return formula;
  let out = '';
  let i = 0;
  const s = formula;
  while (i < s.length) {
    if (s[i] === '"') {
      const j = s.indexOf('"', i + 1);
      const end = j === -1 ? s.length : j + 1;
      out += s.slice(i, end);
      i = end;
      continue;
    }
    const nextQuote = s.indexOf('"', i);
    const chunkEnd = nextQuote === -1 ? s.length : nextQuote;
    const chunk = s.slice(i, chunkEnd);
    out += chunk.replace(REF_RE, (all, d1, col, d2, row, off, str) => {
      const before = str[off - 1];
      const after = str[off + all.length];
      if (before && /[A-Za-z0-9_.]/.test(before)) return all;   // part of a name, e.g. LOG10
      if (after === '(' || (after && /[A-Za-z0-9_]/.test(after))) return all;
      if (d2 === '$') return all;                                // absolute row: leave alone
      return `${d1}${col}${d2}${fn(Number(row))}`;
    });
    i = chunkEnd;
  }
  return out;
}

/** After a sort, a formula that pointed at its own row should follow the row. */
export function moveOwnRow(formula, fromRow, toRow) {
  return mapRowRefs(formula, r => (r === fromRow ? toRow : r));
}

/** Sort data rows by a column. `valueOf(row, originalIndex)` gives the value to compare. */
export function sortRows(rows, col, dir, valueOf) {
  const keyed = rows.map((row, i) => ({ row, i, v: valueOf ? valueOf(row, i) : row[col] }));
  const num = v => {
    if (typeof v === 'number') return v;
    const s = String(v ?? '').replace(/[£$€,%\s]/g, '');
    return s !== '' && !isNaN(s) ? Number(s) : null;
  };
  keyed.sort((a, b) => {
    const x = num(a.v), y = num(b.v);
    const ea = a.v === '' || a.v == null, eb = b.v === '' || b.v == null;
    if (ea !== eb) return ea ? 1 : -1;                 // blanks always last
    let c;
    if (x !== null && y !== null) c = x - y;
    else if (x !== null) c = -1;
    else if (y !== null) c = 1;
    else c = String(a.v).localeCompare(String(b.v), 'en-GB', { numeric: true, sensitivity: 'base' });
    return c ? c * dir : a.i - b.i;
  });
  return keyed.map(({ row, i }, to) => row.map(v => moveOwnRow(v, i + 1, to + 1)));
}
