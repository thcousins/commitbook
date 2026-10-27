import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from '../support/fake-github.js';
import { Store, ConflictError, TAGS_PATH } from '../../src/store.js';
import { gitBlobSha } from '../../src/github.js';

const NOTE = (title, body, extra = '') => `---\ntitle: "${title}"\ncreated: 2026-10-01T09:00:00Z\nupdated: 2026-10-01T09:00:00Z\n${extra}---\n\n${body}\n`;

function setup(files, opts = {}) {
  const gh = createFakeGitHub({ files, ...opts });
  const store = new Store({ owner: 'me', repo: 'notes', token: 't', fetchImpl: gh.fetch, cacheName: 'test-' + Math.random() });
  return { gh, store };
}

test('git blob sha matches git', async () => {
  // `printf 'hello\n' | git hash-object --stdin`
  assert.equal(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('loads notes, folders and tags; ignores repo docs and hidden files', async () => {
  const { store } = setup({
    'README.md': '# About',
    'CLAUDE.md': 'rules',
    'boiler-service.md': NOTE('Boiler service', 'Serviced in October.', 'tags: ["House"]\n'),
    'House/Kitchen/budget.md': NOTE('Kitchen budget', 'Costs'),
    'Empty/.keep': '',
    '.trash/old.md': NOTE('Old', 'gone', 'deleted: 2026-10-02T00:00:00Z\ndeletedFrom: "old.md"\n'),
    '.github/workflows/x.md': 'not a note',
    [TAGS_PATH]: JSON.stringify({ tags: [{ name: 'House', color: '#2e7d5b' }] }),
  });
  await store.connect();
  await store.load();
  assert.deepEqual([...store.notes.keys()].sort(), ['House/Kitchen/budget.md', 'boiler-service.md']);
  assert.deepEqual([...store.folders].sort(), ['Empty', 'House', 'House/Kitchen']);
  assert.equal(store.trash.size, 1);
  assert.equal(store.notes.get('boiler-service.md').title, 'Boiler service');
  assert.deepEqual(store.notes.get('boiler-service.md').tags, ['House']);
  assert.equal(store.tagColour('house'), '#2e7d5b');
});

test('an empty repository is set up on first load', async () => {
  const { gh, store } = setup({}, { empty: true });
  await store.connect();
  const r = await store.load();
  assert.equal(r.initialised, true);
  const files = gh.files();
  assert.ok(files['README.md'] && files['CLAUDE.md'] && files[TAGS_PATH]);
  assert.equal(store.notes.size, 0);
});

test('create, edit and detect conflicts', async () => {
  const { gh, store } = setup({ 'a.md': NOTE('A', 'one') });
  await store.connect(); await store.load();
  const created = await store.saveNote({ path: null, data: {} }, { title: 'Car – MOT & tyres', body: 'MOT due March.', tags: ['Car'], folder: 'Car' });
  assert.equal(created.path, 'Car/car-mot-and-tyres.md');
  assert.ok(gh.files()['Car/car-mot-and-tyres.md'].includes('tags: ["Car"]'));
  assert.ok(store.tags.some(t => t.name === 'Car'));
  assert.equal(created.sha, await gitBlobSha(gh.files()['Car/car-mot-and-tyres.md']));

  const edited = await store.saveNote(created, { title: 'Car – MOT & tyres', body: 'MOT due 3 March.', tags: ['Car'] });
  assert.equal(edited.path, created.path);
  assert.equal(edited.created, created.created);
  assert.ok(gh.files()[created.path].includes('MOT due 3 March.'));

  // A second note with the same title gets its own file.
  const twin = await store.saveNote({ path: null, data: {} }, { title: 'Car – MOT & tyres', body: 'x', tags: [], folder: 'Car' });
  assert.equal(twin.path, 'Car/car-mot-and-tyres-2.md');

  // Someone else edits the note; our next save must not overwrite it silently.
  gh.externalEdit({ [created.path]: NOTE('Car – MOT & tyres', 'Edited by Claude') });
  await assert.rejects(store.saveNote(edited, { title: 'Car – MOT & tyres', body: 'Mine', tags: [] }), ConflictError);
  const remote = await store.fetchRemote(created.path);
  assert.ok(remote.body.includes('Edited by Claude'));
  await store.forceSave(edited, { title: 'Car – MOT & tyres', body: 'Mine wins', tags: [] });
  assert.ok(gh.files()[created.path].includes('Mine wins'));
});

test('refresh picks up changes made elsewhere', async () => {
  const { gh, store } = setup({ 'a.md': NOTE('A', 'one') });
  await store.connect(); await store.load();
  assert.deepEqual(await store.refresh(), []);
  gh.externalEdit({ 'a.md': NOTE('A', 'two'), 'b.md': NOTE('B', 'new') });
  const changed = await store.refresh();
  assert.deepEqual(changed.sort(), ['a.md', 'b.md']);
  assert.equal(store.notes.get('a.md').body.trim(), 'two');
});

test('folders: create, move a note in, rename, delete to Trash', async () => {
  const { gh, store } = setup({ 'a.md': NOTE('A', 'one'), 'b.md': NOTE('B', 'two') });
  await store.connect(); await store.load();
  await store.createFolder('House');
  assert.ok('House/.keep' in gh.files());
  const moved = await store.moveNote(store.notes.get('a.md'), 'House');
  assert.equal(moved.path, 'House/a.md');
  assert.ok(!('House/.keep' in gh.files()), 'the .keep marker goes once the folder has a note');
  await store.createFolder('House/Kitchen');
  await store.renameFolder('House', 'Home');
  assert.deepEqual(Object.keys(gh.files()).filter(p => p.startsWith('Ho')).sort(), ['Home/Kitchen/.keep', 'Home/a.md']);
  assert.deepEqual([...store.folders].sort(), ['Home', 'Home/Kitchen']);
  await store.deleteFolder('Home');
  assert.ok(gh.files()['.trash/Home/a.md'].includes('deletedFrom: "Home/a.md"'));
  assert.ok(!Object.keys(gh.files()).some(p => p.startsWith('Home/')));
  assert.equal(store.folders.size, 0);
});

test('trash: delete keeps the folder, restore puts the note back', async () => {
  const { gh, store } = setup({ 'House/a.md': NOTE('A', 'one') });
  await store.connect(); await store.load();
  await store.trashNote(store.notes.get('House/a.md'));
  assert.ok('House/.keep' in gh.files(), 'the folder stays');
  assert.ok(store.folders.has('House'));
  const item = [...store.trash.values()][0];
  assert.equal(item.path, '.trash/House/a.md');
  const back = await store.restoreNote(item);
  assert.equal(back.path, 'House/a.md');
  assert.ok(!gh.files()['House/a.md'].includes('deleted'));
  assert.ok(!('House/.keep' in gh.files()));
  await store.trashNote(back);
  await store.purge([...store.trash.values()]);
  assert.ok(!Object.keys(gh.files()).some(p => p.startsWith('.trash/')));
});

test('tags: add, rename everywhere, delete everywhere', async () => {
  const { gh, store } = setup({
    'a.md': NOTE('A', 'one', 'tags: ["House", "Car"]\n'),
    'b.md': NOTE('B', 'two', 'tags: ["house"]\n'),
    [TAGS_PATH]: JSON.stringify({ tags: [{ name: 'House', color: '#111111' }, { name: 'Car', color: '#222222' }] }),
  });
  await store.connect(); await store.load();
  await store.addTag('Garden', '#333333');
  await assert.rejects(store.addTag('garden'), /already/);
  await store.renameTag('House', 'Home');
  assert.ok(gh.files()['a.md'].includes('tags: ["Home", "Car"]'));
  assert.ok(gh.files()['b.md'].includes('tags: ["Home"]'));
  assert.ok(JSON.parse(gh.files()[TAGS_PATH]).tags.some(t => t.name === 'Home' && t.color === '#111111'));
  await store.deleteTag('Car');
  assert.ok(gh.files()['a.md'].includes('tags: ["Home"]'));
  assert.deepEqual(store.tags.map(t => t.name), ['Home', 'Garden']);
  await store.recolourTag('Garden', '#444444');
  assert.ok(gh.files()[TAGS_PATH].includes('#444444'));
});

test('history: list versions, view one, restore it, search old text', async () => {
  const { gh, store } = setup({ 'a.md': NOTE('A', 'The pressure was 1.3 bar') });
  await store.connect(); await store.load();
  let n = store.notes.get('a.md');
  n = await store.saveNote(n, { title: 'A', body: 'The pressure was 1.5 bar', tags: [] });
  n = await store.saveNote(n, { title: 'A', body: 'All fine now', tags: [] });
  const versions = await store.history('a.md');
  assert.equal(versions.length, 3);
  const oldest = await store.versionAt('a.md', versions[2].sha);
  assert.ok(oldest.body.includes('1.3 bar'));
  const restored = await store.restoreVersion(n, oldest, '1 Oct');
  assert.ok(restored.body.includes('1.3 bar'));
  assert.ok(gh.files()['a.md'].includes('1.3 bar'));
  const hits = await store.searchHistory('1.5 bar');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'a.md');
  const v = await store.versionAt('a.md', hits[0].ref);
  assert.ok(v.body.includes('1.5 bar'));
});

test('several saves in a row keep working after someone else commits a different file', async () => {
  const { gh, store } = setup({ 'a.md': NOTE('A', 'one'), 'b.md': NOTE('B', 'two') });
  await store.connect(); await store.load();
  gh.externalEdit({ 'b.md': NOTE('B', 'changed elsewhere') });
  // Moving uses the git data API, which must rebase onto the new head.
  const moved = await store.moveNote(store.notes.get('a.md'), 'Folder');
  assert.equal(moved.path, 'Folder/a.md');
  assert.ok(gh.files()['b.md'].includes('changed elsewhere'));
});
