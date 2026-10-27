// Number formats for spreadsheet columns.

export const FORMATS = [
  { id: 'general', label: 'General' },
  { id: 'number', label: 'Number (1,234.50)' },
  { id: 'integer', label: 'Whole number (1,235)' },
  { id: 'gbp', label: 'Pounds (£1,234.50)' },
  { id: 'usd', label: 'Dollars ($1,234.50)' },
  { id: 'eur', label: 'Euros (€1,234.50)' },
  { id: 'percent', label: 'Percent (12.5%)' },
  { id: 'text', label: 'Plain text' },
];

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
