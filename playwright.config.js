import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  globalTimeout: 14 * 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-output/results.json' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
    // The hosted version: the built app plus its PHP server side, talking to a fake GitHub.
    { command: 'node tests/support/fake-server.js 4997', url: 'http://127.0.0.1:4997/__files', reuseExistingServer: false, timeout: 30_000 },
    {
      command: 'sh -c \'d=$(mktemp -d) && COMMITBOOK_DATA=$d COMMITBOOK_API_BASE=http://127.0.0.1:4997 php -S 127.0.0.1:4175 -t dist\'',
      url: 'http://127.0.0.1:4175/api/session.php', reuseExistingServer: false, timeout: 30_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1400, height: 900 } } },
  ].filter(p => !process.env.PW_PROJECTS || process.env.PW_PROJECTS.split(',').includes(p.name)),
});
