// Number formats for spreadsheet columns.

export const FORMATS = [
  { id: 'general', label: 'General' },
  { id: 'number', label: 'Number (1,234.50)' },
  { id: 'integer', label: 'Whole number (1,235)' },
  { id: 'gbp', label: 'Pounds (£1,234.50)' },
  { id: 'usd', label: 'Dollars ($1,234.50)' },
  { id: 'eur', label: 'Euros (€1,234.50)' },
  { id: 'percent', label: 'Percent (12.5%)' },
  { id: 'date', label: 'Date (27/10/2026)' },
  { id: 'datelong', label: 'Date (27 Oct 2026)' },
  { id: 'weekday', label: 'Date (Tue 27 Oct 2026)' },
  { id: 'time', label: 'Time (14:30)' },
  { id: 'datetime', label: 'Date and time (27/10/2026 14:30)' },
  { id: 'text', label: 'Plain text' },
];

export const DATE_FORMATS = new Set(['date', 'datelong', 'weekday', 'time', 'datetime']);

// Dates are stored the way spreadsheets store them: days since 30 December 1899,
// with the time of day as the fraction (0.5 = midday).
const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

export function serialToDate(serial) { return new Date(EPOCH + Math.round(serial * 86400) * 1000); }   // to the nearest second
export function dateToSerial(y, m, d, hh = 0, mm = 0, ss = 0) {
  return (Date.UTC(y, m - 1, d, hh, mm, ss) - EPOCH) / DAY_MS;
}

/** Read a typed date or time ("27/10/2026", "27/10/26", "2026-10-27", "14:30", "27/10/2026 14:30"). */
export function parseDateText(text) {
  const t = String(text ?? '').trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let y = Number(m[3]);
    if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return dateToSerial(y, mo, d, Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return dateToSerial(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0)) / 86400;
  return null;
}

const DF = {
  date: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }),
  datelong: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  weekday: new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }),
};

export function formatDate(serial, format) {
  const d = serialToDate(serial);
  if (isNaN(d)) return String(serial);
  if (format === 'time') return DF.time.format(d);
  if (format === 'datetime') return `${DF.date.format(d)} ${DF.time.format(d)}`;
  return DF[format].format(d).replace(',', '');
}

const nf = (min, max) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: min, maximumFractionDigits: max });
const N2 = nf(2, 2), N0 = nf(0, 0), GEN = nf(0, 10), P = nf(0, 2);

export function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const pct = s.endsWith('%');
  const clean = s.replace(/[£$€,\s%]/g, '');
  if (clean === '' || isNaN(clean)) return null;
  return pct ? Number(clean) / 100 : Number(clean);
}

/** Text to show in a cell. `value` is the computed value (number, string, boolean or error). */
export function formatValue(value, format = 'general', { isFormula = false } = {}) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value.type === 'error') return value.label || '#ERROR';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (format === 'text') return String(value);
  if (DATE_FORMATS.has(format)) {
    const serial = typeof value === 'number' ? value : (parseDateText(value) ?? toNumber(value));
    return serial === null || !isFinite(serial) ? String(value) : formatDate(serial, format);
  }
  const n = typeof value === 'number' ? value : toNumber(value);
  if (n === null || !isFinite(n)) return String(value);
  switch (format) {
    case 'number': return N2.format(n);
    case 'integer': return N0.format(n);
    case 'gbp': return (n < 0 ? '-£' : '£') + N2.format(Math.abs(n));
    case 'usd': return (n < 0 ? '-$' : '$') + N2.format(Math.abs(n));
    case 'eur': return (n < 0 ? '-€' : '€') + N2.format(Math.abs(n));
    case 'percent': return P.format(n * 100) + '%';
    default:
      // General: typed values show as typed; calculated values are tidied.
      if (!isFormula && typeof value === 'string') return value;
      return GEN.format(Math.round(n * 1e10) / 1e10);
  }
}

export const isNumericLooking = v => toNumber(v) !== null;
