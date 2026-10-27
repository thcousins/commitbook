// Front matter: the small header at the top of every note file.
//
//   ---
//   title: "Boiler service"
//   created: 2026-10-14T09:12:00Z
//   updated: 2026-10-20T18:40:11Z
//   tags: ["House", "Annual"]
//   ---
//
// Only a small, predictable subset of YAML is written, so the files stay easy for
// people (and Claude) to edit by hand. Reading is forgiving: unknown keys are kept.

const ORDER = ['title', 'created', 'updated', 'tags', 'deleted', 'deletedFrom'];

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v.startsWith('"')) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    try { return JSON.parse(v); } catch { /* fall through to a loose split */ }
    return inner.split(',').map(s => parseScalar(s)).filter(s => s !== '');
  }
  return v;
}

export function splitFrontMatter(text) {
  const src = (text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { data: {}, body: src };
  const data = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const km = line.match(/^([A-Za-z_][\w-]*):(.*)$/);
    if (!km) continue;
    const key = km[1];
    let value = km[2];
    // Block-style list:
    //   tags:
    //     - House
    if (value.trim() === '' && i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
      const list = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i++;
        list.push(parseScalar(lines[i].replace(/^\s*-\s+/, '')));
      }
      data[key] = list;
      continue;
    }
    data[key] = parseScalar(value);
  }
  if (data.tags && !Array.isArray(data.tags)) data.tags = String(data.tags).split(',').map(s => s.trim()).filter(Boolean);
  return { data, body: src.slice(m[0].length).replace(/^\n+/, '') };
}

function formatScalar(v) {
  if (Array.isArray(v)) return '[' + v.map(x => JSON.stringify(String(x))).join(', ') + ']';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v ?? '');
  // Dates stay bare so they read naturally; everything else is quoted safely.
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s)) return s;
  return JSON.stringify(s);
}

export function joinFrontMatter(data, body) {
  const keys = [...ORDER.filter(k => k in data), ...Object.keys(data).filter(k => !ORDER.includes(k))];
  const lines = keys
    .filter(k => data[k] !== undefined && data[k] !== null && data[k] !== '')
    .filter(k => !(k === 'tags' && Array.isArray(data[k]) && data[k].length === 0))
    .map(k => `${k}: ${formatScalar(data[k])}`);
  const text = (body || '').replace(/\s+$/, '');
  return `---\n${lines.join('\n')}\n---\n\n${text}\n`;
}
