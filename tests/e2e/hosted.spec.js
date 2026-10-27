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
