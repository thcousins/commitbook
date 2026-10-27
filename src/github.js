// Thin client for the parts of the GitHub REST API that Commitbook uses.
// Everything runs in the browser with a fine-grained personal access token that
// has "Contents: read and write" on the one data repository.

import { toBase64, fromBase64 } from './lib/util.js';

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
export class ConflictError extends GitHubError {}
/** The server's sign-in has expired (hosted mode only). */
export class SignedOutError extends GitHubError {}

/** Git's own blob id, so we can know a file's sha without asking GitHub. */
export async function gitBlobSha(text) {
  const bytes = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const encPath = p => p.split('/').map(encodeURIComponent).join('/');

export class GitHubRepo {
  /**
   * Either `token` (the browser talks to GitHub directly) or `proxy` (the URL of the
   * Commitbook server's github.php, which adds the access key on the server).
   */
  constructor({ owner, repo, token, proxy = null, fetchImpl, apiBase = 'https://api.github.com' }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.proxy = proxy;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.api = apiBase;
    this.branch = null;
    this.rate = null;
  }

  get base() { return `${this.api}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`; }

  async request(method, url, body, { allow = [] } = {}) {
    let target, headers;
    if (this.proxy) {
      const path = `/repos/${this.owner}/${this.repo}${url}`;
      target = `${this.proxy}?p=${encodeURIComponent(path)}`;
      headers = { Accept: 'application/json', 'X-Commitbook': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) };
    } else {
      target = url.startsWith('http') ? url : this.base + url;
      headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      };
    }
    const res = await this.fetch(target, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (this.proxy && res.status === 401) {
      let msg = '';
      try { msg = (await res.clone().json()).message || ''; } catch { /* ignore */ }
      if (/sign in/i.test(msg)) throw new SignedOutError('You’ve been signed out. Please sign in again.', 401);
    }
    const remaining = res.headers?.get?.('x-ratelimit-remaining');
    if (remaining != null) this.rate = { remaining: Number(remaining), reset: Number(res.headers.get('x-ratelimit-reset')) * 1000 };
    if (allow.includes(res.status)) return { __status: res.status };
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && data.message) || `GitHub returned ${res.status}`;
      if (res.status === 409 || (res.status === 422 && /sha/i.test(msg))) throw new ConflictError(msg, res.status, data);
      throw new GitHubError(friendlyError(res.status, msg), res.status, data);
    }
    return data;
  }

  async getRepo() {
    const r = await this.request('GET', '');
    this.branch = r.default_branch || 'main';
    return r;
  }

  /** Latest commit on the branch, or null if the repository has no commits yet. */
  async getHead() {
    const r = await this.request('GET', `/git/ref/heads/${encodeURIComponent(this.branch)}`, null, { allow: [404, 409] });
    if (r.__status) return null;
    return r.object.sha;
  }

  async getTree(commitSha) {
    const r = await this.request('GET', `/git/trees/${commitSha}?recursive=1`);
    return { entries: r.tree.filter(e => e.type === 'blob'), truncated: !!r.truncated };
  }

  async getBlob(sha) {
    const r = await this.request('GET', `/git/blobs/${sha}`);
    return r.encoding === 'base64' ? fromBase64(r.content) : r.content;
  }

  /** A file's contents at a given commit (or the branch head). Null if it didn't exist. */
  async getFile(path, ref) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const r = await this.request('GET', `/contents/${encPath(path)}${q}`, null, { allow: [404] });
    if (r.__status) return null;
    if (Array.isArray(r)) return null;
    let text;
    if (r.content != null && r.encoding === 'base64' && r.content !== '') text = fromBase64(r.content);
    else text = await this.getBlob(r.sha);   // large files come back without content
    return { text, sha: r.sha };
  }

  /**
   * Create or update one file in a single commit. `sha` is the version we started
   * from (null for a new file); GitHub refuses the write if the file has changed since.
   */
  async putFile(path, text, { sha = null, message }) {
    const body = { message, content: toBase64(text), branch: this.branch };
    if (sha) body.sha = sha;
    try {
      const r = await this.request('PUT', `/contents/${encPath(path)}`, body);
      return { sha: r.content.sha, commit: r.commit.sha };
    } catch (e) {
      // Creating a file that already exists comes back as 422 "sha wasn't supplied".
      if (e.status === 422 && !sha) throw new ConflictError('A file with this name already exists.', 422, e.body);
      throw e;
    }
  }

  async deleteFile(path, { sha, message }) {
    const r = await this.request('DELETE', `/contents/${encPath(path)}`, { message, sha, branch: this.branch });
    return { commit: r.commit.sha };
  }

  /**
   * Several file changes in one commit, using the Git data API.
   * changes: [{ path, text }] to write, [{ path, delete: true }] to remove.
   * expect:  { path: sha | null } — fail with ConflictError if any of these files
   *          isn't at the expected version (null = must not exist).
   */
  async commitChanges(changes, message, { expect = {} } = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const head = await this.getHead();
      if (!head) throw new GitHubError('The repository is empty.', 409);
      const commit = await this.request('GET', `/git/commits/${head}`);
      const paths = Object.keys(expect);
      if (paths.length) {
        const { entries } = await this.getTree(head);
        const now = new Map(entries.map(e => [e.path, e.sha]));
        for (const p of paths) {
          const want = expect[p];
          const have = now.get(p) || null;
          if (want !== have) throw new ConflictError(`“${p}” was changed somewhere else.`, 409, { path: p });
        }
      }
      const tree = await this.request('POST', '/git/trees', {
        base_tree: commit.tree.sha,
        tree: changes.map(c => c.delete
          ? { path: c.path, mode: '100644', type: 'blob', sha: null }
          : { path: c.path, mode: '100644', type: 'blob', content: c.text }),
      });
      const created = await this.request('POST', '/git/commits', { message, tree: tree.sha, parents: [head] });
      const upd = await this.request('PATCH', `/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: created.sha, force: false }, { allow: [422] });
      if (!upd.__status) return { commit: created.sha };
      // Someone else committed in between: try again on top of their commit.
    }
    throw new GitHubError('GitHub kept changing while saving. Please try again.', 409);
  }

  /** Commits that touched a path (newest first). */
  async listCommits({ path, page = 1, perPage = 50 } = {}) {
    const q = new URLSearchParams({ sha: this.branch, per_page: String(perPage), page: String(page) });
    if (path) q.set('path', path);
    const r = await this.request('GET', `/commits?${q}`);
    return r.map(c => ({
      sha: c.sha,
      message: c.commit?.message || '',
      date: c.commit?.committer?.date || c.commit?.author?.date,
      author: c.commit?.author?.name || c.author?.login || '',
      parents: (c.parents || []).map(p => p.sha),
    }));
  }

  /** One commit with the files it changed and their diffs. */
  async getCommit(sha) {
    const c = await this.request('GET', `/commits/${sha}`);
    return {
      sha: c.sha,
      message: c.commit?.message || '',
      date: c.commit?.committer?.date || c.commit?.author?.date,
      parents: (c.parents || []).map(p => p.sha),
      files: (c.files || []).map(f => ({ path: f.filename, status: f.status, patch: f.patch || '', previous: f.previous_filename || null })),
    };
  }
}

function friendlyError(status, msg) {
  if (status === 401) return 'GitHub didn’t accept the access key. It may have expired or been revoked.';
  if (status === 403 && /rate limit/i.test(msg)) return 'GitHub’s hourly limit was reached. Try again in a few minutes.';
  if (status === 403) return 'The access key doesn’t have permission for this. It needs “Contents: Read and write” on the notes repository.';
  if (status === 404) return 'GitHub couldn’t find that. Check the repository name, and that the access key includes this repository.';
  return msg;
}
