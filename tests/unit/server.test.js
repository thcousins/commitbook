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
let php, fake, dataDir;

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
  php = spawn('php', ['-S', `127.0.0.1:${PHP_PORT}`, '-t', 'public'], {
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
