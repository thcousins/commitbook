// An in-memory stand-in for the GitHub REST API endpoints Commitbook uses.
// Used by the unit tests (as a fetch replacement) and the browser tests
// (through Playwright's request routing), so tests never touch real GitHub.

import { createHash } from 'node:crypto';

const sha1 = s => createHash('sha1').update(s).digest('hex');
const blobSha = text => sha1(`blob ${Buffer.byteLength(text)}\0${text}`);
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const unb64 = s => Buffer.from(s, 'base64').toString('utf8');

function naivePatch(oldText, newText) {
  const a = oldText == null ? [] : oldText.split('\n');
  const b = newText == null ? [] : newText.split('\n');
  const sa = new Set(a), sb = new Set(b);
  return ['@@ -1 +1 @@', ...a.filter(l => !sb.has(l)).map(l => '-' + l), ...b.filter(l => !sa.has(l)).map(l => '+' + l)].join('\n');
}

export function createFakeGitHub({ owner = 'me', repo = 'notes', files = {}, empty = false, startDate = Date.UTC(2026, 9, 1, 9, 0, 0) } = {}) {
  const blobs = new Map();          // blob sha -> text
  const trees = new Map();          // tree sha -> Map(path -> blob sha)
  const commits = new Map();        // commit sha -> { sha, tree, parents, message, date }
  let head = null;
  let counter = 0;
  let clock = startDate;
  const calls = [];

  const putBlob = text => { const s = blobSha(text); blobs.set(s, text); return s; };
  const putTree = map => { const s = sha1('tree' + JSON.stringify([...map].sort())); trees.set(s, new Map(map)); return s; };
  const makeCommit = (treeSha, message, parents) => {
    clock += 60000;
    const sha = sha1(`commit ${counter++} ${treeSha} ${message}`);
    commits.set(sha, { sha, tree: treeSha, parents, message, date: new Date(clock).toISOString().replace(/\.\d{3}Z$/, 'Z') });
    return sha;
  };
  const filesAt = commitSha => (commitSha ? trees.get(commits.get(commitSha).tree) : new Map());

  function commitFiles(changes, message) {
    const map = new Map(filesAt(head));
    for (const [p, text] of Object.entries(changes)) {
      if (text === null) map.delete(p); else map.set(p, putBlob(text));
    }
    head = makeCommit(putTree(map), message, head ? [head] : []);
    return head;
  }

  if (!empty) commitFiles(files, 'Initial notes');

  const ok = (body, status = 200) => ({ status, body });
  const err = (status, message) => ({ status, body: { message } });

  function commitJson(c) {
    return {
      sha: c.sha,
      commit: { message: c.message, author: { name: 'Owner', date: c.date }, committer: { name: 'Owner', date: c.date } },
      parents: c.parents.map(sha => ({ sha })),
    };
  }

  function changedPaths(c) {
    const now = trees.get(c.tree);
    const before = c.parents[0] ? filesAt(c.parents[0]) : new Map();
    const out = [];
    for (const [p, s] of now) if (before.get(p) !== s) out.push({ path: p, status: before.has(p) ? 'modified' : 'added', old: before.has(p) ? blobs.get(before.get(p)) : null, new: blobs.get(s) });
    for (const [p, s] of before) if (!now.has(p)) out.push({ path: p, status: 'removed', old: blobs.get(s), new: null });
    return out;
  }

  // Like GitHub, report a removed file plus a similar added file as one rename.
  function withRenames(files) {
    const similar = (x, y) => {
      const a = new Set(String(x).split('\n')), b = new Set(String(y).split('\n'));
      let common = 0;
      for (const l of a) if (b.has(l)) common++;
      return common / Math.max(a.size, b.size) >= 0.5;
    };
    const removed = files.filter(f => f.status === 'removed');
    const out = [];
    for (const f of files) {
      if (f.status === 'removed') continue;
      if (f.status === 'added') {
        const i = removed.findIndex(r => similar(r.old, f.new));
        if (i >= 0) { const r = removed.splice(i, 1)[0]; out.push({ ...f, status: 'renamed', previous: r.path, old: r.old }); continue; }
      }
      out.push(f);
    }
    return [...out, ...removed];
  }

  function handle(method, rawUrl, body) {
    const url = new URL(rawUrl);
    const path = decodeURIComponent(url.pathname);
    calls.push(`${method} ${url.pathname}${url.search}`);
    const base = `/repos/${owner}/${repo}`;
    if (!path.startsWith(base)) return err(404, 'Not Found');
    const rest = path.slice(base.length);
    let m;

    if (rest === '' && method === 'GET') return ok({ full_name: `${owner}/${repo}`, default_branch: 'main', private: true, permissions: { admin: true, push: true, pull: true } });

    if (rest === '/git/ref/heads/main' && method === 'GET') return head ? ok({ ref: 'refs/heads/main', object: { sha: head, type: 'commit' } }) : err(409, 'Git Repository is empty.');

    if ((m = rest.match(/^\/git\/trees\/([^/]+)$/)) && method === 'GET') {
      const id = m[1] === 'main' ? head : m[1];
      const t = commits.has(id) ? trees.get(commits.get(id).tree) : trees.get(id);
      if (!t) return err(404, 'Not Found');
      return ok({ sha: id, truncated: false, tree: [...t].map(([p, s]) => ({ path: p, mode: '100644', type: 'blob', sha: s })) });
    }
    if ((m = rest.match(/^\/git\/blobs\/([0-9a-f]+)$/)) && method === 'GET') {
      if (!blobs.has(m[1])) return err(404, 'Not Found');
      return ok({ sha: m[1], encoding: 'base64', content: b64(blobs.get(m[1])) });
    }
    if ((m = rest.match(/^\/git\/commits\/([0-9a-f]+)$/)) && method === 'GET') {
      const c = commits.get(m[1]);
      return c ? ok({ sha: c.sha, tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })), message: c.message }) : err(404, 'Not Found');
    }
    if (rest === '/git/trees' && method === 'POST') {
      const map = new Map(body.base_tree ? trees.get(body.base_tree) : []);
      for (const e of body.tree) {
        if (e.sha === null) map.delete(e.path);
        else if (e.content !== undefined) map.set(e.path, putBlob(e.content));
        else map.set(e.path, e.sha);
      }
      return ok({ sha: putTree(map) }, 201);
    }
    if (rest === '/git/commits' && method === 'POST') return ok({ sha: makeCommit(body.tree, body.message, body.parents) }, 201);
    if (rest === '/git/refs/heads/main' && method === 'PATCH') {
      const c = commits.get(body.sha);
      if (!c || (c.parents[0] || null) !== head) return err(422, 'Update is not a fast forward');
      head = body.sha;
      return ok({ object: { sha: head } });
    }

    if ((m = rest.match(/^\/contents\/(.+)$/))) {
      const p = m[1];
      const ref = url.searchParams.get('ref');
      if (method === 'GET') {
        const map = filesAt(ref ? (commits.has(ref) ? ref : head) : head);
        if (!map || !map.has(p)) return err(404, 'Not Found');
        const s = map.get(p);
        return ok({ path: p, sha: s, encoding: 'base64', content: b64(blobs.get(s)) });
      }
      if (method === 'PUT') {
        const cur = filesAt(head).get(p);
        if (cur && !body.sha) return err(422, "Invalid request.\n\n\"sha\" wasn't supplied.");
        if (cur && body.sha !== cur) return err(409, `${p} does not match ${body.sha}`);
        if (!cur && body.sha) return err(404, 'Not Found');
        const c = commitFiles({ [p]: unb64(body.content) }, body.message);
        return ok({ content: { path: p, sha: filesAt(c).get(p) }, commit: { sha: c } }, cur ? 200 : 201);
      }
      if (method === 'DELETE') {
        const cur = filesAt(head).get(p);
        if (!cur) return err(404, 'Not Found');
        if (body.sha !== cur) return err(409, 'sha does not match');
        const c = commitFiles({ [p]: null }, body.message);
        return ok({ commit: { sha: c } });
      }
    }

    if (rest === '/commits' && method === 'GET') {
      const want = url.searchParams.get('path');
      const per = Number(url.searchParams.get('per_page') || 30);
      const page = Number(url.searchParams.get('page') || 1);
      const list = [];
      for (let s = head; s; s = commits.get(s).parents[0]) {
        const c = commits.get(s);
        if (!want || changedPaths(c).some(f => f.path === want)) list.push(commitJson(c));
      }
      return ok(list.slice((page - 1) * per, page * per));
    }
    if ((m = rest.match(/^\/commits\/([0-9a-f]+)$/)) && method === 'GET') {
      const c = commits.get(m[1]);
      if (!c) return err(404, 'Not Found');
      return ok({ ...commitJson(c), files: withRenames(changedPaths(c)).map(f => ({ filename: f.path, status: f.status, ...(f.previous ? { previous_filename: f.previous } : {}), patch: naivePatch(f.old, f.new) })) });
    }
    return err(404, `Fake GitHub has no route for ${method} ${rest}`);
  }

  /** A fetch() replacement for Node tests. */
  async function fetchImpl(url, opts = {}) {
    const r = handle(opts.method || 'GET', String(url), opts.body ? JSON.parse(opts.body) : null);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '0' } });
  }

  return {
    handle,
    fetch: fetchImpl,
    calls,
    /** Make a change "somewhere else", e.g. as Claude would. */
    externalEdit(changes, message = 'Edit from elsewhere') { return commitFiles(changes, message); },
    files() { const map = filesAt(head); return Object.fromEntries([...map].map(([p, s]) => [p, blobs.get(s)])); },
    commitCount() { let n = 0; for (let s = head; s; s = commits.get(s).parents[0]) n++; return n; },
    get head() { return head; },
  };
}
