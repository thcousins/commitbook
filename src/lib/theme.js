// Appearance: 'system' (follow the device), 'light' or 'dark'. Kept per device.
import { local } from './cache.js';

const KEY = 'cb:theme';
const COLOURS = { light: '#f2f3f7', dark: '#1c1e25' };

export function getTheme() {
  const t = local.get(KEY, 'system');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  // The browser's own bar colour (Safari, iPhone home-screen app).
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  meta.content = dark ? COLOURS.dark : COLOURS.light;
  document.querySelectorAll('meta[name="theme-color"][media]').forEach(m => m.remove());
}

export function setTheme(theme) {
  local.set(KEY, theme);
  applyTheme(theme);
}

// Keep the bar colour right when the device switches while on "System".
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getTheme() === 'system') applyTheme('system'); });
} catch { /* old browsers */ }
