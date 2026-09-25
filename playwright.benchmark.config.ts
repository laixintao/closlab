import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.benchmark.ts',
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  outputDir: 'test-results/benchmark',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    launchOptions: { args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : ['--enable-gpu'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60000,
  },
});
