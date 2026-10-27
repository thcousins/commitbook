// Browser tests: the built app running against a fake GitHub.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createFakeGitHub } from '../support/fake-github.js';
import { SEED } from '../support/seed.js';

const SHOTS = 'test-output/shots';
fs.mkdirSync(SHOTS, { recursive: true });

async function setup(page, { files = SEED, autosave = true, colorScheme } = {}) {
  const gh = createFakeGitHub({ files });
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    // The browser logs GitHub's expected 409 "conflict" replies; those are handled by the app.
    if (m.type() === 'error' && !/status of 409/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.__problems = problems;
  await page.route('https://api.github.com/**', async route => {
    const req = route.request();
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    const r = gh.handle(req.method(), req.url(), body);
    await route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.body) });
  });
  await page.addInitScript(({ autosave }) => {
    if (!sessionStorage.getItem('cb:test-init')) {
      localStorage.clear();
      localStorage.setItem('cb:settings', JSON.stringify({ owner: 'me', repo: 'notes', token: 'test-token' }));
      localStorage.setItem('cb:autosave', JSON.stringify(autosave));
      sessionStorage.setItem('cb:test-init', '1');
    }
  }, { autosave });
  if (colorScheme) await page.emulateMedia({ colorScheme });
  await page.goto('/');
  await expect(page.locator('.cb-status')).toHaveClass(/is-saved/);
  return { gh, problems };
}

// On failure, keep the page's content and any errors so they can be reviewed.
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const name = `${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`;
  fs.mkdirSync('test-output/failures', { recursive: true });
  const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
  try { await within(page.screenshot({ path: `test-output/failures/${name}.png`, timeout: 5000 }), 6000); } catch { /* page busy or gone */ }
  let html = '';
  try { html = await within(page.evaluate(() => document.querySelector('#cb-page')?.innerHTML || ''), 4000); } catch (e) { html = `(couldn't read the page: ${e.message})`; }
  fs.writeFileSync(`test-output/failures/${name}.txt`, `${(page.__problems || []).join('\n')}\n\n---- #cb-page ----\n${html.slice(0, 20000)}`);
});

const shot = (page, name, info) => page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` });
const openNote = (page, title) => page.locator('.cb-item', { hasText: title }).first().click();
const waitSaved = page => expect(page.locator('.cb-status')).toHaveClass(/is-saved/, { timeout: 15_000 });

test('loads notes and folders, opens a note with a spreadsheet', async ({ page }, info) => {
  const { problems } = await setup(page);
  await expect(page.locator('.cb-folder-row', { hasText: 'House' })).toBeVisible();
  await page.locator('.cb-folder-row', { hasText: 'House' }).click();
  await openNote(page, 'Kitchen renovation');
  await expect(page.locator('#cb-title')).toHaveValue('Kitchen renovation');
  await expect(page.locator('.cb-meta')).toContainText('Created');
  await expect(page.locator('.cb-meta')).toContainText('House/kitchen-renovation.md');
  const sheet = page.locator('.cb-sheet').first();
  await expect(sheet.locator('thead')).toContainText('Supplier');
  await expect(sheet.locator('tfoot.cb-totals')).toContainText('£1,839.00');
  await expect(sheet.locator('tfoot.cb-totals')).toContainText('£306.50');
  await shot(page, '01-kitchen', info);
  expect(problems).toEqual([]);
});

test('typing saves automatically and keeps the file format', async ({ page }) => {
  const { gh, problems } = await setup(page);
  await openNote(page, 'Gift ideas');
  const ed = page.locator('#cb-editor .tiptap');
  await ed.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Dad');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- Walking boots');
  await expect(page.locator('.cb-status')).toHaveClass(/is-unsaved|is-saving/);
  await waitSaved(page);
  const text = gh.files()['gift-ideas.md'];
  expect(text).toMatch(/^---\ntitle: "Gift ideas"\ncreated: 2026-09-12T10:00:00Z\nupdated: /);
  expect(text).toContain('## Dad');
  expect(text).toContain('- Walking boots');
  expect(text).toContain('- [ ] Ask about sizes');
  // Undo works in the editor.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(ed).not.toContainText('Walking boots');
  expect(problems).toEqual([]);
});

test('spreadsheet: edit a cell, totals update, saved as a table', async ({ page }, info) => {
  const { gh, problems } = await setup(page);
  await page.locator('.cb-folder-row', { hasText: 'House' }).click();
  await openNote(page, 'Kitchen renovation');
  const sheet = page.locator('.cb-sheet').first();
  const cell = sheet.locator('tbody tr').nth(0).locator('td').nth(4); // first data row, Cost column
  await cell.dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('700');
  await page.keyboard.press('Enter');
  await expect(sheet.locator('tfoot.cb-totals')).toContainText('£1,899.00');
  await waitSaved(page);
  const text = gh.files()['House/kitchen-renovation.md'];
  expect(text).toMatch(/\| Oak worktop\s+\| Howdens\s+\| Ordered\s+\| 700\s+\|/);
  expect(text).toContain('=SUM(D:D)');
  expect(text).toContain('<!-- commitbook:sheet {"totals":2');
  await shot(page, '02-sheet-edited', info);
  expect(problems).toEqual([]);
});

test('spreadsheet: per-row formulas, sorting and adding rows', async ({ page }, info) => {
  const { gh, problems } = await setup(page);
  await page.locator('.cb-folder-row', { hasText: 'Car' }).click();
  await openNote(page, 'MOT and tyres');
  const sheet = page.locator('.cb-sheet').first();
  await expect(sheet.locator('tbody')).toContainText('236');
  await expect(sheet.locator('tfoot')).toContainText('£210.00');
  // Sort by price with the context menu.
  await sheet.locator('thead td').nth(3).click({ button: 'right' });
  await page.locator('.jcontextmenu >> text=Sort A → Z').click();
  await expect(sheet.locator('tbody tr').first()).toContainText('Local');
  await expect(sheet.locator('tbody tr').first()).toContainText('210');
  await sheet.locator('[data-act="row"]').click();
  await expect(sheet.locator('tbody tr')).toHaveCount(4);
  await waitSaved(page);
  const text = gh.files()['Car/mot-and-tyres.md'];
  expect(text).toMatch(/\| Local \(Plympton\)\s+\| Michelin Primacy 4\s+\| 105\s+\| =C1\*2\s+\|/);
  await shot(page, '03-sorted', info);
  expect(problems).toEqual([]);
});

test('insert a spreadsheet from the toolbar', async ({ page }) => {
  const { gh, problems } = await setup(page);
  await openNote(page, 'Gift ideas');
  await page.locator('#cb-editor .tiptap').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.locator('.cb-tool[data-cmd="sheet"]').click();
  const sheet = page.locator('.cb-sheet');
  await expect(sheet).toHaveCount(1);
  await sheet.locator('tbody tr').nth(0).locator('td').nth(1).click();
  await page.keyboard.type('Boots');
  await page.keyboard.press('Tab');
  await page.keyboard.type('85');
  await page.keyboard.press('Enter');
  await expect(sheet.locator('tfoot')).toContainText('85');
  await waitSaved(page);
  expect(gh.files()['gift-ideas.md']).toMatch(/\| Boots\s+\| 85\s+\|/);
  expect(problems).toEqual([]);
});

test('new note in a folder, with tags, then filter by tag', async ({ page }, info) => {
  const { gh, problems } = await setup(page);
  await page.locator('[data-folder-menu="House"]').click({ force: true });
  await page.locator('.cb-pop-item', { hasText: 'New note here' }).click();
  await page.locator('#cb-title').fill('Boiler service');
  await page.locator('#cb-editor .tiptap').click();
  await page.keyboard.type('Serviced every October.');
  await page.locator('#cb-tag-input').fill('Annual');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  expect(gh.files()['House/boiler-service.md']).toContain('tags: ["Annual"]');
  await expect(page.locator('.cb-meta')).toContainText('House/boiler-service.md');
  await page.locator('#cb-tagfilter').click();
  await page.locator('.cb-pop-check', { hasText: 'Annual' }).locator('input').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cb-list .cb-item')).toHaveCount(1);
  await expect(page.locator('.cb-list .cb-item')).toContainText('Boiler service');
  await shot(page, '04-tag-filter', info);
  expect(problems).toEqual([]);
});

test('folders: create, drag a note in, rename', async ({ page }) => {
  const { gh, problems } = await setup(page);
  await page.locator('#cb-menu').click();
  await page.locator('.cb-pop-item', { hasText: 'New folder' }).click();
  await page.locator('.cb-modal input').fill('Presents');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cb-folder-row', { hasText: 'Presents' })).toBeVisible();
  expect(gh.files()['Presents/.keep']).toBe('');
  await page.locator('.cb-item', { hasText: 'Gift ideas' }).dragTo(page.locator('.cb-folder', { hasText: 'Presents' }));
  await expect.poll(() => Object.keys(gh.files()).includes('Presents/gift-ideas.md')).toBe(true);
  await page.locator('[data-folder-menu="Presents"]').click({ force: true });
  await page.locator('.cb-pop-item', { hasText: 'Rename' }).click();
  await page.locator('.cb-modal input').fill('Gifts');
  await page.keyboard.press('Enter');
  await expect.poll(() => Object.keys(gh.files()).includes('Gifts/gift-ideas.md')).toBe(true);
  expect(problems).toEqual([]);
});

test('revision history: view and restore an older version', async ({ page }, info) => {
  const { gh, problems } = await setup(page);
  await openNote(page, 'Gift ideas');
  await page.locator('#cb-title').fill('Gift ideas 2026');
  await waitSaved(page);
  await page.locator('#cb-history').click();
  await expect(page.locator('.cb-version')).toHaveCount(2);
  await page.locator('.cb-version').nth(1).click();
  await expect(page.locator('.cb-version-title')).toHaveText('Gift ideas');
  await shot(page, '05-history', info);
  await page.locator('[data-act="restore"]').click();
  await page.locator('.cb-modal [data-ok]').click();
  await expect(page.locator('#cb-title')).toHaveValue('Gift ideas');
  expect(gh.files()['gift-ideas.md']).toContain('title: "Gift ideas"');
  expect(problems).toEqual([]);
});

test('delete to Trash and restore', async ({ page }, info) => {
  const { gh, problems } = await setup(page);
  await openNote(page, 'Gift ideas');
  await page.locator('#cb-note-menu').click();
  await page.locator('.cb-pop-item', { hasText: 'Delete note' }).click();
  await page.locator('.cb-modal [data-ok]').click();
  await expect(page.locator('.cb-trash-link .cb-count')).toHaveText('1');
  expect(Object.keys(gh.files())).toContain('.trash/gift-ideas.md');
  await page.locator('#cb-trash-link').click();
  await expect(page.locator('.cb-trash-item')).toHaveCount(1);
  await shot(page, '06-trash', info);
  await page.locator('.cb-trash-item [data-act="restore"]').click();
  await expect(page.locator('#cb-title')).toHaveValue('Gift ideas');
  expect(Object.keys(gh.files())).toContain('gift-ideas.md');
  expect(Object.keys(gh.files())).not.toContain('.trash/gift-ideas.md');
  expect(problems).toEqual([]);
});

test('manual saving: Save button, and a warning when leaving', async ({ page }, info) => {
  const { gh, problems } = await setup(page, { autosave: false });
  await expect(page.locator('#cb-autosave')).not.toBeChecked();
  await openNote(page, 'Gift ideas');
  await page.locator('#cb-editor .tiptap').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Extra words');
  await page.waitForTimeout(3500);
  expect(gh.files()['gift-ideas.md']).not.toContain('Extra words');
  await expect(page.locator('#cb-save')).toBeEnabled();
  await page.locator('.cb-item', { hasText: 'Welcome' }).click();
  await expect(page.locator('.cb-modal')).toContainText('Save your changes?');
  await shot(page, '07-save-prompt', info);
  await page.locator('.cb-modal [data-id="cancel"]').click();
  await expect(page.locator('#cb-title')).toHaveValue('Gift ideas');
  await page.locator('#cb-save').click();
  await waitSaved(page);
  expect(gh.files()['gift-ideas.md']).toContain('Extra words');
  await page.locator('#cb-editor .tiptap').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' and more');
  await page.locator('.cb-item', { hasText: 'Welcome' }).click();
  await page.locator('.cb-modal [data-id="discard"]').click();
  await expect(page.locator('#cb-title')).toHaveValue('Welcome to Commitbook');
  expect(gh.files()['gift-ideas.md']).not.toContain('and more');
  expect(problems).toEqual([]);
});

test('changes made elsewhere: refresh and conflict', async ({ page }) => {
  const { gh, problems } = await setup(page);
  await openNote(page, 'Gift ideas');
  gh.externalEdit({ 'gift-ideas.md': gh.files()['gift-ideas.md'].replace('Climbing wall voucher', 'Climbing wall voucher (from Claude)') });
  await page.evaluate(() => window.commitbook.checkForChanges());
  await expect(page.locator('#cb-editor')).toContainText('(from Claude)');
  // Now a real conflict: edit locally while it changes remotely.
  await page.locator('#cb-editor .tiptap').click();
  await page.keyboard.press('ControlOrMeta+End');
  gh.externalEdit({ 'gift-ideas.md': gh.files()['gift-ideas.md'] + '\nRemote line\n' });
  await page.keyboard.type(' local words');
  await expect(page.locator('.cb-modal')).toContainText('changed somewhere else', { timeout: 15_000 });
  await page.locator('.cb-modal [data-id="both"]').click();
  await expect.poll(() => Object.keys(gh.files()).some(p => p.includes('my-copy'))).toBe(true);
  expect(gh.files()['gift-ideas.md']).toContain('Remote line');
  expect(problems).toEqual([]);
});

test('search, including older versions', async ({ page }, info) => {
  const { problems } = await setup(page);
  await openNote(page, 'Gift ideas');
  await page.locator('#cb-editor .tiptap').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('All bought now.');
  await waitSaved(page);
  await page.locator('#cb-q').fill('lego');
  await expect(page.locator('.cb-list-head').first()).toContainText('0 notes found');
  await page.locator('#cb-old').check();
  await expect(page.locator('.cb-item-old')).toHaveCount(1);
  await page.locator('.cb-item-old').click();
  await expect(page.locator('.cb-preview')).toContainText('Lego Technic');
  await shot(page, '08-old-search', info);
  await page.locator('#cb-q').fill('worktop');
  await expect(page.locator('.cb-list .cb-item[data-path]')).toHaveCount(1);
  expect(problems).toEqual([]);
});

test('looks right on a phone and in dark mode', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'screenshots once');
  await page.setViewportSize({ width: 390, height: 844 });
  const { problems } = await setup(page, { colorScheme: 'dark' });
  await shot(page, '09-phone-list-dark', info);
  await page.locator('.cb-folder-row', { hasText: 'House' }).click();
  await openNote(page, 'Kitchen renovation');
  await expect(page.locator('.cb-sheet')).toBeVisible();
  await shot(page, '10-phone-note-dark', info);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(wide).toBe(false);
  await page.setViewportSize({ width: 1400, height: 900 });
  await shot(page, '11-desktop-dark', info);
  expect(problems).toEqual([]);
});

test('sign-in screen when not set up', async ({ page }, info) => {
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.setItem('cb:test-init', '1'); });
  await page.goto('/');
  await expect(page.locator('#cb-signin')).toBeVisible();
  await shot(page, '12-signin', info);
});

test('appearance: light, dark or follow the system, remembered', async ({ page }, info) => {
  const { problems } = await setup(page, { colorScheme: 'light' });
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.locator('#cb-menu').click();
  await page.locator('[data-theme-choice="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).not.toBe(light);
  await shot(page, '13-menu-dark', info);
  // Remembered after a reload, before the app has even started.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // "System" follows the device again.
  await page.locator('#cb-menu').click();
  await page.locator('[data-theme-choice="system"]').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  expect(await bg()).toBe(light);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bg()).not.toBe(light);
  // "Light" wins over a dark device.
  await page.locator('[data-theme-choice="light"]').click();
  expect(await bg()).toBe(light);
  expect(problems).toEqual([]);
});
