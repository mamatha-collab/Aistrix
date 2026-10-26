import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/next',
  outputDir: './test-results/next',
  testMatch: /.*\.e2e\.js$/,
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [{
    command: 'node e2e/next/services.mjs',
    url: 'http://127.0.0.1:4176/health',
    reuseExistingServer: false,
    timeout: 15_000,
  }, {
    command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 60_000,
  }],
})
