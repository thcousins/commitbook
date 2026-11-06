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
