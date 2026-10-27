// Small helpers shared across the app.

export function slugify(title) {
  const s = String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return s || 'untitled-note';
}

export const dirname = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const basename = p => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);
export const joinPath = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

/** Pick a file path that isn't already taken: folder/slug.md, folder/slug-2.md, … */
export function uniquePath(folder, slug, taken) {
  let n = 1;
  let path;
  do {
    path = joinPath(folder, `${slug}${n > 1 ? '-' + n : ''}.md`);
    n++;
  } while (taken.has(path.toLowerCase()));
  return path;
}

// UTF-8 safe base64 (GitHub's API uses base64 for file contents).
export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const DAY = 86400000;
export function friendlyDate(iso, { withTime = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  const diffMin = (now - d) / 60000;
  if (diffMin >= 0 && diffMin < 1) return 'just now';
  if (diffMin >= 0 && diffMin < 60) return `${Math.floor(diffMin)} min ago`;
  if (diffDays === 0) return withTime ? `today, ${time}` : 'today';
  if (diffDays === 1) return withTime ? `yesterday, ${time}` : 'yesterday';
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts) + (withTime && diffDays < 7 ? `, ${time}` : '');
}
export function longDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ', ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Run async tasks with limited parallelism. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Text for list previews: like plainText, but without spreadsheet contents. */
export function previewText(md) {
  return plainText(String(md || '').split('\n').filter(l => !/^\s*\|/.test(l)).join('\n'));
}

/** Plain text of a note body, for search and list previews. */
export function plainText(md) {
  return String(md || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\|?\s*:?-{3,}.*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Group versions (newest first) by the local day they were saved.
 * Returns [{ key: '2026-10-27', label: 'Today' | 'Yesterday' | 'Mon 26 Oct 2026', today, items: [{ v, i }] }].
 */
export function groupByDay(versions, now = new Date()) {
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayKey = dayKey(now);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterdayKey = dayKey(y);
  const groups = [];
  versions.forEach((v, i) => {
    const d = new Date(v.date);
    const key = isNaN(d) ? 'unknown' : dayKey(d);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const label = key === todayKey ? 'Today' : key === yesterdayKey ? 'Yesterday' : isNaN(d) ? 'Unknown date'
        : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '');
      g = { key, label, today: key === todayKey, items: [] };
      groups.push(g);
    }
    g.items.push({ v, i });
  });
  return groups;
}
