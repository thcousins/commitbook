// Tests for the PHP server side (public/api), using PHP's built-in web server and
// the fake GitHub. Skipped if PHP isn't installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeServer } from '../support/fake-server.js';
import { Store } from '../../src/store.js';

const hasPhp = spawnSync('php', ['-v']).status === 0;
const PHP_PORT = 4176, GH_PORT = 4998;
const BASE = `http://127.0.0.1:${PHP_PORT}`;
let php, fake, dataDir, webRoot;

class Browser {
  constructor() { this.jar = new Map(); }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async fetch(url, opts = {}) {
    const res = await fetch(url.startsWith('http') ? url : BASE + url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie: this.cookieHeader() } });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (!v || /expires=Thu, 01 Jan 1970|max-age=0/i.test(c) || /expires=([^;]+)/i.exec(c) && new Date(/expires=([^;]+)/i.exec(c)[1]) < new Date()) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  form(url, fields) {
    return this.fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  }
  api(url, opts = {}) {
    return this.fetch(url, { ...opts, headers: { 'x-commitbook': '1', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } });
  }
  json(url, opts) { return this.api(url, opts).then(async r => ({ status: r.status, body: await r.json() })); }
}

const GOOD = { username: 'tom', password: 'correct horse battery', password2: 'correct horse battery', repo: 'me/notes', token: 'test-token', remember: '1' };
const loc = r => new URL(r.headers.get('location'), BASE);

before(async () => {
  if (!hasPhp) return;
  fake = await startFakeServer(GH_PORT);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-data-'));
  // Serve a copy of the server files plus the app page, as an installed copy would be.
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-web-'));
  fs.cpSync('public', webRoot, { recursive: true });
  fs.copyFileSync('index.html', path.join(webRoot, 'index.html'));
  php = spawn('php', ['-S', `127.0.0.1:${PHP_PORT}`, '-t', webRoot], {
    env: { ...process.env, COMMITBOOK_DATA: dataDir, COMMITBOOK_API_BASE: `http://127.0.0.1:${GH_PORT}` },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/session.php'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
});

after(() => {
  php?.kill();
  fake?.server.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  if (webRoot) fs.rmSync(webRoot, { recursive: true, force: true });
});

test('server side: setup, sign in and out, proxy limits, key stays on the server', { skip: !hasPhp && 'PHP not installed' }, async () => {
  const b = new Browser();
  let s = await b.json('/api/session.php');
  assert.equal(s.body.app, 'commitbook');
  assert.equal(s.body.setup, false);
  assert.equal(s.body.signedIn, false);

  // Setup checks its inputs.
  let r = await b.form('/api/setup.php', { ...GOOD, password2: 'different password' });
  assert.equal(loc(r).searchParams.get('setup'), 'mismatch');
  assert.equal(loc(r).searchParams.get('u'), 'tom');
  r = await b.form('/api/setup.php', { ...GOOD, password: 'short', password2: 'short' });
  assert.equal(loc(r).searchParams.get('setup'), 'short');
  r = await b.form('/api/setup.php', { ...GOOD, token: 'wrong-token' });
  assert.equal(loc(r).searchParams.get('setup'), 'github');
  assert.match(loc(r).searchParams.get('msg'), /access key/);

  r = await b.form('/api/setup.php', GOOD);
  assert.equal(r.status, 303);
  assert.equal(loc(r).searchParams.get('setup'), 'ok');
  assert.ok(b.jar.has('cb_session') && b.jar.has('cb_remember'));
  s = await b.json('/api/session.php');
  assert.deepEqual([s.body.setup, s.body.signedIn, s.body.repo], [true, true, { owner: 'me', repo: 'notes' }]);

  // The settings file is outside the web folder and holds a hashed password.
  const conf = fs.readFileSync(path.join(dataDir, 'config.php'), 'utf8');
  assert.ok(conf.includes("'token' => 'test-token'"));
  assert.ok(!conf.includes('correct horse'));
  assert.equal(fs.statSync(path.join(dataDir, 'config.php')).mode & 0o077, 0, 'only the owner can read it');
  // Setup can't be run again.
  r = await b.form('/api/setup.php', { ...GOOD, username: 'intruder' });
  assert.equal(loc(r).searchParams.get('setup'), 'done');

  // The proxy reaches GitHub with the key added by the server, never sent by the browser.
  let g = await b.json('/api/github.php?p=' + encodeURIComponent('/repos/me/notes/git/ref/heads/main'));
  assert.equal(g.status, 200);
  assert.ok(g.body.object.sha);
  const tree = await b.json('/api/github.php?p=' + encodeURIComponent(`/repos/me/notes/git/trees/${g.body.object.sha}?recursive=1`));
  assert.ok(tree.body.tree.some(e => e.path === 'gift-ideas.md'));
  const put = await b.json('/api/github.php?p=' + encodeURIComponent('/repos/me/notes/contents/new-note.md'), {
    method: 'PUT', body: JSON.stringify({ message: 'Add', content: Buffer.from('---\ntitle: "New"\n---\n\nHi\n').toString('base64'), branch: 'main' }),
  });
  assert.equal(put.status, 201);
  assert.ok(fake.gh.files()['new-note.md'].includes('Hi'));

  // …but only for the notes repository and the parts of the API the app uses.
  assert.equal((await b.json('/api/github.php?p=' + encodeURIComponent('/repos/me/other/contents/x'))).status, 403);
  assert.equal((await b.json('/api/github.php?p=' + encodeURIComponent('/repos/me/notes/hooks'))).status, 403);
  assert.equal((await b.json('/api/github.php?p=' + encodeURIComponent('/user/repos'))).status, 403);
  assert.equal((await b.json('/api/github.php?p=' + encodeURIComponent('/repos/me/notes/contents/../../other'))).status, 403);
  assert.equal((await b.json('/api/github.php?p=' + encodeURIComponent('/repos/me/notes'), { method: 'DELETE' })).status, 403);
  // Requests without the app's header are refused (stops other websites using your session).
  assert.equal((await b.fetch('/api/github.php?p=' + encodeURIComponent('/repos/me/notes'))).status, 400);
  // Nothing the browser received contains the key.
  const all = JSON.stringify([s.body, g.body, tree.body, put.body]);
  assert.ok(!all.includes('test-token'));

  // Shared files can't be downloaded.
  for (const f of ['lib.php']) {
    const res = await fetch(BASE + '/api/' + f);
    assert.ok((await res.text()).length === 0, `${f} shows nothing`);
  }

  // Sign out, then the proxy refuses.
  assert.equal((await b.json('/api/logout.php', { method: 'POST' })).status, 200);
  assert.equal((await b.json('/api/github.php?p=' + encodeURIComponent('/repos/me/notes'))).status, 401);
  assert.equal((await b.json('/api/session.php')).body.signedIn, false);
});

test('server side: sign-in, keep me signed in, lockout and settings', { skip: !hasPhp && 'PHP not installed' }, async () => {
  const b = new Browser();
  // Wrong password
  let r = await b.form('/api/login.php', { username: 'tom', password: 'nope' });
  assert.equal(loc(r).searchParams.get('signin'), 'failed');
  assert.equal(loc(r).searchParams.get('u'), 'tom');
  // Right password, username in any case
  r = await b.form('/api/login.php', { username: 'TOM', password: GOOD.password, remember: '1' });
  assert.equal(loc(r).search, '');
  assert.equal((await b.json('/api/session.php')).body.signedIn, true);

  // "Keep me signed in": a new session on the same device signs straight in.
  const later = new Browser();
  later.jar.set('cb_remember', b.jar.get('cb_remember'));
  assert.equal((await later.json('/api/session.php')).body.signedIn, true);

  // Change the password: other devices are signed out, this one stays in.
  let st = await b.json('/api/settings.php', { method: 'POST', body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'another long password' }) });
  assert.equal(st.status, 403);
  st = await b.json('/api/settings.php', { method: 'POST', body: JSON.stringify({ currentPassword: GOOD.password, newPassword: 'another long password', remember: true }) });
  assert.deepEqual(st.body.changed, ['password']);
  const other = new Browser();
  other.jar.set('cb_remember', later.jar.get('cb_remember'));
  other.jar.delete('cb_session');
  assert.equal((await other.json('/api/session.php')).body.signedIn, false);
  assert.equal((await b.json('/api/session.php')).body.signedIn, true);
  st = await b.json('/api/settings.php', { method: 'POST', body: JSON.stringify({ currentPassword: 'another long password', token: 'wrong-token' }) });
  assert.equal(st.status, 422);
  assert.match(st.body.message, /access key/);

  // Lockout after repeated wrong passwords.
  const c = new Browser();
  for (let i = 0; i < 5; i++) await c.form('/api/login.php', { username: 'tom', password: 'guess' + i });
  r = await c.form('/api/login.php', { username: 'tom', password: 'another long password' });
  assert.equal(loc(r).searchParams.get('signin'), 'locked');
  assert.ok(Number(loc(r).searchParams.get('wait')) >= 1);
  assert.ok((await c.json('/api/session.php')).body.lockedFor > 0);
});

test('the whole notebook works through the server, without the key in the app', { skip: !hasPhp && 'PHP not installed' }, async () => {
  const b = new Browser();
  const r = await b.form('/api/login.php', { username: 'tom', password: 'another long password' });
  // The lockout test above may still be in force for this address; wait it out isn't practical, so clear it.
  if (loc(r).searchParams.get('signin') === 'locked') fs.writeFileSync(path.join(dataDir, 'attempts.json'), '{}');
  await b.form('/api/login.php', { username: 'tom', password: 'another long password' });
  assert.equal((await b.json('/api/session.php')).body.signedIn, true);
  const already = (await (await fetch(`http://127.0.0.1:${GH_PORT}/__seen`)).json()).length;
  const store = new Store({
    owner: 'me', repo: 'notes', token: null, proxy: BASE + '/api/github.php', cacheName: 'srv',
    fetchImpl: (url, opts) => b.fetch(url, opts),
  });
  await store.connect();
  await store.load();
  assert.ok(store.notes.has('House/kitchen-renovation.md'));
  const n = await store.saveNote({ path: null, data: {} }, { title: 'Through the server', body: 'Hello', tags: ['Server'], folder: 'Tests' });
  assert.equal(n.path, 'Tests/through-the-server.md');
  const moved = await store.moveNote(n, 'Elsewhere');
  const versions = await store.history(moved.path);
  assert.equal(versions.length, 2);
  assert.ok(fake.gh.files()['Elsewhere/through-the-server.md'].includes('Hello'));
  // Every request GitHub saw carried the key added by the server.
  const seen = (await (await fetch(`http://127.0.0.1:${GH_PORT}/__seen`)).json()).slice(already).filter(x => !x.url.startsWith('/__'));
  assert.ok(seen.length > 5 && seen.every(x => x.auth === 'Bearer test-token'));
});

test('share links: one note, read-only, follows moves, can be turned off', { skip: !hasPhp && 'PHP not installed' }, async () => {
  fs.writeFileSync(path.join(dataDir, 'attempts.json'), '{}');
  const owner = new Browser();
  await owner.form('/api/login.php', { username: 'tom', password: 'another long password' });
  assert.equal((await owner.json('/api/session.php')).body.signedIn, true);
  const make = body => owner.json('/api/shares.php', { method: 'POST', body: JSON.stringify(body) });

  // Only the owner can make or list links.
  const stranger = new Browser();
  assert.equal((await stranger.json('/api/shares.php')).status, 401);
  assert.equal((await make({ action: 'create', path: '.trash/x.md' })).status, 422);
  assert.equal((await make({ action: 'create', path: '../config.php' })).status, 422);

  let r = await make({ action: 'create', path: 'gift-ideas.md', title: 'Gift ideas', created: '2026-09-12T10:00:00Z' });
  assert.equal(r.status, 200);
  const share = r.body.shares.find(s => s.path === 'gift-ideas.md');
  assert.match(share.token, /^[0-9a-f]{40}$/);
  const view = () => stranger.fetch(`/api/shared.php?t=${share.token}`).then(async x => ({ status: x.status, body: await x.json() }));
  const clearCache = () => { for (const f of fs.readdirSync(dataDir)) if (f.startsWith('share-cache-')) fs.unlinkSync(path.join(dataDir, f)); };

  // Anyone with the link sees that note (but not its tags or anything else), without signing in.
  let v = await view();
  assert.equal(v.status, 200);
  assert.equal(v.body.title, 'Gift ideas');
  assert.ok(v.body.body.includes('Lego Technic set'));
  assert.ok(!JSON.stringify(v.body).includes('Gifts'), 'tags stay private');
  assert.ok(!v.body.body.startsWith('---'));

  // The share page is the app, told which link it's showing.
  const page = await stranger.fetch(`/s/${share.token}`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes(`<meta name="cb-share" content="${share.token}"`));
  assert.ok(html.includes('<base href="/"'));

  // A wrong or made-up link shows nothing.
  assert.equal((await stranger.fetch(`/api/shared.php?t=${'0'.repeat(40)}`)).status, 404);
  assert.equal((await stranger.fetch('/api/shared.php?t=gift-ideas')).status, 404);

  // Live: an edit shows up (after the short cache).
  const text = fake.gh.files()['gift-ideas.md'];
  fake.gh.externalEdit({ 'gift-ideas.md': text.replace('Lego Technic set', 'Lego Technic crane') });
  clearCache();
  assert.ok((await view()).body.body.includes('Lego Technic crane'));

  // Moved somewhere else (e.g. by Claude): the link follows it.
  const moved = fake.gh.files()['gift-ideas.md'];
  fake.gh.externalEdit({ 'gift-ideas.md': null, 'Presents/gift-ideas.md': moved });
  clearCache();
  v = await view();
  assert.equal(v.status, 200);
  const list = (await owner.json('/api/shares.php')).body.shares;
  assert.equal(list.find(s => s.token === share.token).path, 'Presents/gift-ideas.md');

  // A different note later taking the old name isn't shown by mistake.
  fake.gh.externalEdit({ 'gift-ideas.md': '---\ntitle: "Other"\ncreated: 2026-11-01T00:00:00Z\n---\n\nSomething else\n' });
  r = await make({ action: 'repath', path: 'Presents/gift-ideas.md', to: 'gift-ideas.md' });
  clearCache();
  v = await view();
  assert.equal(v.status, 200);
  assert.ok(v.body.body.includes('Lego'), 'still the shared note, found by its created date');

  // In the Trash: the link stops working.
  fake.gh.externalEdit({ 'Presents/gift-ideas.md': null, '.trash/Presents/gift-ideas.md': moved });
  clearCache();
  assert.equal((await view()).status, 404);

  // Turned off: gone for good.
  fake.gh.externalEdit({ '.trash/Presents/gift-ideas.md': null, 'Presents/gift-ideas.md': moved });
  clearCache();
  assert.equal((await view()).status, 200);
  await make({ action: 'revoke', token: share.token });
  clearCache();
  assert.equal((await view()).status, 404);

  // Links can expire.
  r = await make({ action: 'create', path: 'Presents/gift-ideas.md', title: 'Gift ideas', days: 7 });
  const exp = r.body.shares[0];
  assert.ok(exp.expires > Date.now() / 1000 + 6 * 86400);
  const shares = JSON.parse(fs.readFileSync(path.join(dataDir, 'shares.json'), 'utf8'));
  shares[exp.token].expires = 1;
  fs.writeFileSync(path.join(dataDir, 'shares.json'), JSON.stringify(shares));
  assert.equal((await stranger.fetch(`/api/shared.php?t=${exp.token}`)).status, 404);
  assert.equal((await owner.json('/api/shares.php')).body.shares.length, 0, 'expired links are tidied away');
});

test('shared folders: only that folder, read-only or editable, nothing else reachable', { skip: !hasPhp && 'PHP not installed' }, async () => {
  fs.writeFileSync(path.join(dataDir, 'attempts.json'), '{}');
  const owner = new Browser();
  await owner.form('/api/login.php', { username: 'tom', password: 'another long password' });
  const make = body => owner.json('/api/shares.php', { method: 'POST', body: JSON.stringify(body) });
  fake.gh.externalEdit({
    'House/Kitchen/tiles.md': '---\ntitle: "Tiles"\ncreated: 2026-11-01T00:00:00Z\n---\n\nWhite metro tiles.\n',
    'House/Kitchen/.keep': '',
    'Private/bank.md': '---\ntitle: "Bank"\ncreated: 2026-11-01T00:00:00Z\n---\n\nSecret.\n',
  });
  assert.equal((await make({ action: 'create', kind: 'folder', path: '.trash' })).status, 422);
  let r = await make({ action: 'create', kind: 'folder', path: 'House', title: 'House' });
  const share = r.body.shares.find(x => x.kind === 'folder');
  assert.equal(share.mode, 'read');
  const t = share.token;
  const guest = new Browser();
  const api = (p, opts = {}) => guest.json(`/api/guest.php?t=${t}&p=${encodeURIComponent('/repos/_/_' + p)}`, opts);

  // What's shared.
  const info = await guest.fetch(`/api/guest.php?t=${t}&info=1`).then(x => x.json());
  assert.deepEqual(info, { kind: 'folder', mode: 'read', path: 'House', title: 'House' });
  assert.equal((await guest.fetch(`/api/guest.php?t=${'1'.repeat(40)}&info=1`)).status, 404);

  // The app's own requests: the repository, the latest commit, the file list (only House).
  const repo = await api('');
  assert.equal(repo.body.permissions.push, false);
  assert.ok(!JSON.stringify(repo.body).includes('notes'), 'repository name not shown');
  const head = (await api('/git/ref/heads/main')).body.object.sha;
  const tree = (await api(`/git/trees/${head}?recursive=1`)).body.tree.map(e => e.path).sort();
  assert.deepEqual(tree, ['.commitbook/tags.json', 'House/Kitchen/.keep', 'House/Kitchen/tiles.md', 'House/kitchen-renovation.md']);
  // Reading a note inside, by id and by path.
  const tiles = (await api(`/git/trees/${head}?recursive=1`)).body.tree.find(e => e.path === 'House/Kitchen/tiles.md');
  assert.equal((await api(`/git/blobs/${tiles.sha}`)).status, 200);
  assert.equal((await api('/contents/House/Kitchen/tiles.md')).status, 200);
  // Nothing outside it: not by path, not by file id, not its history.
  const full = await (await fetch(`http://127.0.0.1:${GH_PORT}/__files`)).json();
  assert.ok(full['Private/bank.md']);
  const ownerTree = await owner.json('/api/github.php?p=' + encodeURIComponent(`/repos/me/notes/git/trees/${head}?recursive=1`));
  const bank = ownerTree.body.tree.find(e => e.path === 'Private/bank.md');
  assert.equal((await api(`/git/blobs/${bank.sha}`)).status, 403);
  assert.equal((await api('/contents/Private/bank.md')).status, 403);
  assert.equal((await api('/contents/House/../Private/bank.md')).status, 403);
  assert.equal((await api('/commits?path=Private%2Fbank.md')).status, 403);
  assert.equal((await api('/commits')).status, 403);
  assert.equal((await api(`/commits/${head}`)).status, 200, 'the latest change touched House');
  // Read-only: no saving.
  const put = body => api('/contents/House/Kitchen/tiles.md', { method: 'PUT', body: JSON.stringify(body) });
  assert.equal((await put({ message: 'x', content: Buffer.from('hi').toString('base64'), sha: tiles.sha })).status, 403);

  // Switch the same link to editing.
  r = await make({ action: 'mode', token: t, mode: 'edit' });
  assert.equal(r.body.shares.find(x => x.token === t).mode, 'edit');
  assert.equal((await api('')).body.permissions.push, true);
  const edited = '---\ntitle: "Tiles"\ncreated: 2026-11-01T00:00:00Z\n---\n\nGrey metro tiles.\n';
  r = await put({ message: 'Edit “Tiles”', content: Buffer.from(edited).toString('base64'), sha: tiles.sha, branch: 'main' });
  assert.equal(r.status, 200);
  assert.ok(fake.gh.files()['House/Kitchen/tiles.md'].includes('Grey'));
  const log = await owner.json('/api/github.php?p=' + encodeURIComponent('/repos/me/notes/commits?path=House%2FKitchen%2Ftiles.md'));
  assert.equal(log.body[0].commit.message, 'Edit “Tiles” (shared link)');
  // Still no new notes, no saving outside, no other kinds of change.
  assert.equal((await api('/contents/House/new.md', { method: 'PUT', body: JSON.stringify({ message: 'x', content: 'aGk=' }) })).status, 403);
  assert.equal((await api('/contents/Private/bank.md', { method: 'PUT', body: JSON.stringify({ message: 'x', content: 'aGk=', sha: bank.sha }) })).status, 403);
  assert.equal((await api('/contents/.commitbook/tags.json', { method: 'PUT', body: JSON.stringify({ message: 'x', content: 'e30=', sha: 'x' }) })).status, 403);
  assert.equal((await api('/contents/House/Kitchen/tiles.md', { method: 'DELETE', body: JSON.stringify({ message: 'x', sha: 'x' }) })).status, 403);
  assert.equal((await api('/git/trees', { method: 'POST', body: JSON.stringify({ tree: [] }) })).status, 403);
  assert.equal((await api('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: 'x' }) })).status, 403);
  // Requests must come from the app.
  assert.equal((await guest.fetch(`/api/guest.php?t=${t}&p=${encodeURIComponent('/repos/_/_')}`)).status, 400);

  // A folder renamed in the app: the link follows it.
  await make({ action: 'repath', path: 'House', to: 'Home', folder: true });
  assert.equal((await guest.fetch(`/api/guest.php?t=${t}&info=1`).then(x => x.json())).path, 'Home');
  await make({ action: 'repath', path: 'Home', to: 'House', folder: true });

  // The whole notebook works through a shared link, limited to the folder.
  const store = new Store({ owner: '_', repo: '_', token: null, proxy: `${BASE}/api/guest.php?t=${t}`, cacheName: 'guest-' + t, fetchImpl: (url, opts) => guest.fetch(url, opts) });
  await store.connect();
  await store.load();
  assert.deepEqual([...store.notes.keys()].sort(), ['House/Kitchen/tiles.md', 'House/kitchen-renovation.md']);
  const note = store.notes.get('House/Kitchen/tiles.md');
  const saved = await store.saveNote(note, { title: 'Tiles', body: 'Grey metro tiles, matt.', tags: [] });
  assert.ok(fake.gh.files()['House/Kitchen/tiles.md'].includes('matt'));
  assert.ok((await store.history(saved.path)).length >= 2);
  await assert.rejects(store.moveNote(saved, 'Private'));

  // Turned off: everything stops.
  await make({ action: 'revoke', token: t });
  assert.equal((await api('')).status, 404);
});
