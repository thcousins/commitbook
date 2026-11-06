// The hosted version: sign-in page, first-time setup and editing through the PHP server.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const HOSTED = 'http://127.0.0.1:4175';
const FAKE = 'http://127.0.0.1:4997';
const SHOTS = 'test-output/shots';
fs.mkdirSync(SHOTS, { recursive: true });
test.describe.configure({ mode: 'serial' });
test.use({ baseURL: HOSTED });
test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough for the server side');

async function signIn(page) {
  await page.goto('/');
  await page.waitForSelector('#cb-login, .cb-app');
  if (await page.locator('#cb-login').count()) {
    await page.fill('#username', 'tom');
    await page.fill('#password', 'a long test password');
    await page.click('#cb-login button');
  }
  await expect(page.locator('.cb-folder-row', { hasText: 'House' })).toBeVisible();
}

// Put the cursor at the end of the note (Ctrl/Cmd+End differs between browsers).
const toEnd = page => page.evaluate(() => window.commitbook.editor.commands.focus('end'));

const files = async () => (await fetch(`${FAKE}/__files`)).json();
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/hosted-${name}.png` });

test('first-time setup page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#cb-setup')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toHaveAttribute('autocomplete', 'new-password');
  await shot(page, '01-setup');
  await page.fill('input[name="username"]', 'tom');
  await page.fill('input[name="password"]', 'a long test password');
  await page.fill('input[name="password2"]', 'a long test password');
  await page.fill('input[name="repo"]', 'me/notes');
  await page.fill('input[name="token"]', 'wrong-token');
  await page.click('#cb-setup button');
  await expect(page.locator('.cb-error')).toContainText('access key');
  await expect(page.locator('input[name="username"]')).toHaveValue('tom');
  await page.fill('input[name="password"]', 'a long test password');
  await page.fill('input[name="password2"]', 'a long test password');
  await page.fill('input[name="token"]', 'test-token');
  await page.click('#cb-setup button');
  await expect(page.locator('.cb-folder-row', { hasText: 'House' })).toBeVisible();
  // The access key never reaches the browser.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + document.cookie);
  expect(stored).not.toContain('test-token');
  const cookies = await page.context().cookies();
  expect(cookies.find(c => c.name === 'cb_session')?.httpOnly).toBe(true);
});

test('edit a note through the server', async ({ page }) => {
  await signIn(page);
  await page.locator('.cb-item', { hasText: 'Gift ideas' }).click();
  await page.locator('#cb-editor .tiptap').click();
  await toEnd(page);
  await page.keyboard.type(' Saved via the server.');
  await expect(page.locator('.cb-status')).toHaveClass(/is-saved/, { timeout: 15_000 });
  expect((await files())['gift-ideas.md']).toContain('Saved via the server.');
});

test('sign out, then sign in with the sign-in page', async ({ page }) => {
  await signIn(page);
  await page.locator('#cb-menu').click();
  await page.locator('.cb-pop-item', { hasText: 'Sign out' }).click();
  await expect(page.locator('#cb-login')).toBeVisible();
  await expect(page.locator('.cb-info')).toContainText('signed out');
  // Built for password managers: a real form with the standard field names.
  await expect(page.locator('#cb-login')).toHaveAttribute('method', 'post');
  await expect(page.locator('#username')).toHaveAttribute('autocomplete', 'username');
  await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
  await shot(page, '02-signin');
  await page.fill('#username', 'tom');
  await page.fill('#password', 'not the password');
  await page.click('#cb-login button');
  await expect(page.locator('.cb-error')).toContainText('don’t match');
  await expect(page.locator('#username')).toHaveValue('tom');
  await page.fill('#password', 'a long test password');
  await page.click('#cb-login button');
  await expect(page.locator('.cb-folder-row', { hasText: 'House' })).toBeVisible();
  // Signed in for later visits too ("Keep me signed in" is ticked by default).
  const cookies = await page.context().cookies();
  expect(cookies.some(c => c.name === 'cb_remember')).toBe(true);
});

test('server settings dialog', async ({ page }) => {
  await signIn(page);
  await page.locator('#cb-menu').click();
  await page.locator('.cb-pop-item', { hasText: 'Sign-in and GitHub settings' }).click();
  await page.fill('#cb-ss input[name="currentPassword"]', 'wrong');
  await page.click('#cb-ss .cb-btn-primary');
  await expect(page.locator('#cb-ss .cb-error')).toContainText('current password');
  await shot(page, '03-settings');
  await page.fill('#cb-ss input[name="currentPassword"]', 'a long test password');
  await page.click('#cb-ss .cb-btn-primary');
  await expect(page.locator('.cb-toast')).toContainText('Nothing changed');
});

test('share a note with a link, then stop sharing', async ({ page, browser }) => {
  await signIn(page);
  await page.locator('.cb-item', { hasText: 'Gift ideas' }).click();
  await page.locator('#cb-note-menu').click();
  await page.locator('.cb-pop-item', { hasText: 'Share link' }).click();
  await expect(page.locator('.cb-modal')).toContainText('can’t be guessed');
  await page.locator('.cb-modal [data-act="create"]').click();
  const linkInput = page.locator('.cb-modal .cb-share-link input');
  await expect(linkInput).toHaveValue(/\/s\/[0-9a-f]{40}$/);
  const url = await linkInput.inputValue();
  await shot(page, '04-share-dialog');
  await page.locator('.cb-modal [data-act="close"]').click();
  await expect(page.locator('.cb-item', { hasText: 'Gift ideas' }).locator('.cb-shared-mark')).toBeVisible();

  // Someone else opens it: no sign-in, just the one note, read-only.
  const other = await browser.newContext();
  const guest = await other.newPage();
  await guest.goto(url);
  await expect(guest.locator('.cb-title-static')).toHaveText('Gift ideas');
  await expect(guest.locator('.cb-shared-body')).toContainText('Lego Technic set');
  await expect(guest.locator('.cb-shared-body .tiptap')).toHaveAttribute('contenteditable', 'false');
  await expect(guest.locator('#cb-login, .cb-side')).toHaveCount(0);
  // The note uses the full width of a wide window.
  await guest.setViewportSize({ width: 1600, height: 900 });
  expect((await guest.locator('.cb-shared-body').boundingBox()).width).toBeGreaterThan(1400);
  await guest.screenshot({ path: `${SHOTS}/hosted-05-shared-page.png` });

  // The owner stops sharing; the link no longer works.
  await page.locator('#cb-menu').click();
  await page.locator('.cb-pop-item', { hasText: 'Shared links' }).click();
  await expect(page.locator('.cb-modal .cb-share-row')).toHaveCount(1);
  await page.locator('.cb-modal [data-act="revoke"]').click();
  await page.locator('.cb-modal [data-ok]').click();
  await expect(page.locator('.cb-modal .cb-share-row')).toHaveCount(0);
  await guest.reload();
  await expect(guest.locator('.cb-empty h2')).toHaveText('This note isn’t available');
  await other.close();
});

test('on a shared page, contents links scroll on the same page', async ({ page, browser }) => {
  const filler = n => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} of filler text.`).join('\n\n');
  const text = '---\ntitle: "Shared long note"\ncreated: 2026-11-02T09:00:00Z\nupdated: 2026-11-02T09:00:00Z\n---\n\n'
    + '- [Web link](https://example.com/)\n- [Jump down](#the-end)\n\n' + filler(40) + '\n\n## The end\n\nDone.\n';
  await fetch(`${FAKE}/__put`, { method: 'POST', body: JSON.stringify({ path: 'shared-long-note.md', text }) });
  await signIn(page);
  const shares = await page.evaluate(async () => {
    const r = await fetch('api/shares.php', { method: 'POST', headers: { 'X-Commitbook': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', path: 'shared-long-note.md', title: 'Shared long note', created: '2026-11-02T09:00:00Z' }) });
    return (await r.json()).shares;
  });
  const token = shares.find(s => s.path === 'shared-long-note.md').token;
  // Opened in the same browser as a signed-in owner: still just the shared page.
  const ctx = page.context();
  const guest = await ctx.newPage();
  await guest.goto(`${HOSTED}/s/${token}`);
  await expect(guest.locator('.cb-title-static')).toHaveText('Shared long note');
  const pagesBefore = ctx.pages().length;
  await guest.locator('.cb-shared-body a', { hasText: 'Jump down' }).click();
  await expect(guest.locator('#the-end')).toBeInViewport();
  await guest.waitForTimeout(500);
  expect(ctx.pages().length).toBe(pagesBefore);                  // no new tab
  expect(guest.url()).toBe(`${HOSTED}/s/${token}`);              // still on the shared page
  await expect(guest.locator('.cb-side')).toHaveCount(0);
  // Ordinary web links still open in a new tab.
  await expect(guest.locator('.cb-shared-body a', { hasText: 'Web link' })).toHaveAttribute('target', '_blank');
  await guest.close();
});

test('share a folder: read only, then editable', async ({ page, browser }) => {
  const note = (title, body) => `---\ntitle: "${title}"\ncreated: 2026-11-03T09:00:00Z\nupdated: 2026-11-03T09:00:00Z\n---\n\n${body}\n`;
  for (const [path, text] of [
    ['Trips/italy.md', note('Italy', 'Flights booked.')],
    ['Trips/Days/rome.md', note('Rome', 'Colosseum at 10.')],
  ]) await fetch(`${FAKE}/__put`, { method: 'POST', body: JSON.stringify({ path, text }) });
  await signIn(page);
  await page.locator('.cb-folder[data-folder="Trips"] .cb-folder-more').click({ force: true });
  await page.locator('.cb-pop-item', { hasText: 'Share folder' }).click();
  await expect(page.locator('.cb-modal h3')).toHaveText('Share folder “Trips”');
  await expect(page.locator('.cb-modal .cb-share-new [data-mode="read"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.cb-modal [data-act="create"]').click();
  const url = await page.locator('.cb-modal .cb-share-link input').inputValue();
  expect(url).toMatch(/\/s\/[0-9a-f]{40}$/);
  await shot(page, '06-share-folder-dialog');
  await page.locator('.cb-modal [data-act="close"]').click();
  await expect(page.locator('.cb-folder[data-folder="Trips"] .cb-shared-mark')).toBeVisible();

  // A friend opens it: just this folder, with its subfolder, read only.
  const other = await browser.newContext();
  const guest = await other.newPage();
  await guest.goto(url);
  await expect(guest.locator('.cb-brand')).toContainText('Trips');
  await expect(guest.locator('.cb-item', { hasText: 'Italy' })).toBeVisible();
  await expect(guest.locator('.cb-folder-row', { hasText: 'Days' })).toBeVisible();
  await expect(guest.locator('.cb-item', { hasText: 'Gift ideas' })).toHaveCount(0);
  await expect(guest.locator('.cb-folder-row', { hasText: 'Car' })).toHaveCount(0);
  await expect(guest.locator('#cb-new')).toBeHidden();
  await expect(guest.locator('.cb-folder-more, #cb-trash-link')).toHaveCount(0);
  await expect(guest.locator('.cb-repo')).toHaveText('Shared · read only');
  await guest.locator('.cb-folder-row', { hasText: 'Days' }).click();
  await guest.locator('.cb-item', { hasText: 'Rome' }).click();
  await expect(guest.locator('#cb-editor .tiptap')).toContainText('Colosseum');
  await expect(guest.locator('#cb-editor .tiptap')).toHaveAttribute('contenteditable', 'false');
  await expect(guest.locator('#cb-tools')).toBeHidden();
  await expect(guest.locator('#cb-title')).toHaveAttribute('readonly', '');
  await guest.screenshot({ path: `${SHOTS}/hosted-07-shared-folder.png` });

  // The owner lets people with the link edit; the same link now allows changes.
  await page.locator('#cb-menu').click();
  await page.locator('.cb-pop-item', { hasText: 'Shared links' }).click();
  const row = page.locator('.cb-modal .cb-share-row', { hasText: 'Trips' });
  await row.locator('[data-mode="edit"]').click();
  await expect(row.locator('[data-mode="edit"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.cb-modal [data-act="close"]').click();

  const log = [];
  guest.on('console', m => log.push(`console ${m.type()}: ${m.text()}`));
  guest.on('pageerror', e => log.push(`error: ${e.message}`));
  guest.on('request', r => { if (r.url().includes('guest.php')) log.push(`${Date.now() % 100000} ${r.method()} ${decodeURIComponent(r.url().split('p=')[1] || r.url())}`); });
  await guest.reload();
  await expect(guest.locator('.cb-repo')).toHaveText('Shared · you can edit');
  await guest.locator('.cb-item', { hasText: 'Italy' }).click();
  await expect(guest.locator('#cb-editor .tiptap')).toHaveAttribute('contenteditable', 'true');
  await expect(guest.locator('#cb-editor .tiptap')).toContainText('Flights booked.');
  await toEnd(guest);
  log.push(`${Date.now() % 100000} typing`);
  await guest.keyboard.type(' Hotel near the station.');
  log.push(`${Date.now() % 100000} typed: ${await guest.locator('#cb-editor .tiptap').innerText()}`);
  try {
    await expect.poll(async () => (await files())['Trips/italy.md'], { timeout: 15000 }).toContain('Hotel near the station.');
  } catch (e) {
    log.push('toasts: ' + await guest.locator('.cb-toast, .cb-modal').allInnerTexts());
    log.push('editor: ' + await guest.locator('#cb-editor .tiptap').innerText());
    await guest.screenshot({ path: `${SHOTS}/hosted-08-failed.png` });
    fs.writeFileSync('test-output/guest-debug.log', log.join('\n'));
    throw e;
  }
  const saved = (await files())['Trips/italy.md'];
  expect(saved).toContain('created: 2026-11-03T09:00:00Z');
  expect(saved).toContain('title: "Italy"');
  await guest.screenshot({ path: `${SHOTS}/hosted-08-shared-folder-edit.png` });

  // Notes outside the folder stay out of reach, even by asking the server directly.
  const outside = await guest.evaluate(async t => (await fetch(`api/guest.php?t=${t}&p=${encodeURIComponent('/repos/_/_/contents/gift-ideas.md')}`, { headers: { 'X-Commitbook': '1' } })).status, url.split('/').pop());
  expect(outside).toBe(403);
  await other.close();
});

test('share a note that the other person can edit', async ({ page, browser }) => {
  await signIn(page);
  await page.locator('.cb-item', { hasText: 'Welcome to Commitbook' }).click();
  await page.locator('#cb-note-menu').click();
  await page.locator('.cb-pop-item', { hasText: 'Share link' }).click();
  await page.locator('.cb-modal .cb-share-new [data-mode="edit"]').click();
  await page.locator('.cb-modal [data-act="create"]').click();
  const url = await page.locator('.cb-modal .cb-share-link input').inputValue();
  await expect(page.locator('.cb-modal .cb-share-row [data-mode="edit"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.cb-modal [data-act="close"]').click();

  const other = await browser.newContext();
  const guest = await other.newPage();
  await guest.goto(url);
  await expect(guest.locator('#cb-title')).toHaveValue('Welcome to Commitbook');
  await expect(guest.locator('.cb-side')).toBeHidden();
  await toEnd(guest);
  await guest.keyboard.type(' Edited by a friend.');
  await expect.poll(async () => (await files())['welcome.md'], { timeout: 15000 }).toContain('Edited by a friend.');
  await guest.screenshot({ path: `${SHOTS}/hosted-09-shared-note-edit.png` });
  await other.close();
});
