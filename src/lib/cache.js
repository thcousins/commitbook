// A tiny key-value cache on IndexedDB, with an in-memory fallback (private
// windows, tests). Used for file contents and commit details, which never change
// once they exist, so a cached copy is always correct.

export function createCache(name) {
  const mem = new Map();
  let dbp = null;
  if (typeof indexedDB !== 'undefined') {
    dbp = new Promise(resolve => {
      try {
        const req = indexedDB.open(`commitbook:${name}`, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  const tx = async (mode, fn) => {
    const db = dbp && (await dbp);
    if (!db) return undefined;
    return new Promise(resolve => {
      try {
        const t = db.transaction('kv', mode);
        const req = fn(t.objectStore('kv'));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => resolve(undefined);
        t.onabort = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  };
  return {
    async get(key) {
      if (mem.has(key)) return mem.get(key);
      const v = await tx('readonly', s => s.get(key));
      if (v !== undefined) mem.set(key, v);
      return v;
    },
    async set(key, value) {
      mem.set(key, value);
      await tx('readwrite', s => s.put(value, key));
    },
    async del(key) {
      mem.delete(key);
      await tx('readwrite', s => s.delete(key));
    },
  };
}

// Small synchronous settings and drafts store on localStorage (wrapped, because it
// can be unavailable).
export const local = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};
