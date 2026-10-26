import { defineConfig } from '@playwright/test'

// Deterministic browser checks of real Build components, with in-memory
// persistence and API responses. No account, provider calls or cloud writes.
export default defineConfig({
  testDir: './e2e/local',
  outputDir: './test-results/local',
  testMatch: /.*\.e2e\.js$/,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config e2e/fixtures/vite.config.js --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/e2e/fixtures/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
