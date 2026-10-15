// Browser tests of the Build flow (Design → Test → Deploy) against a running
// Aistrix (staging by default). Files end in .e2e.js so Vitest ignores them.
//
//   E2E_BASE_URL   site to test, e.g. https://staging.aistrix.app
//   E2E_EMAIL      a dedicated test account (never a real user's)
//   E2E_PASSWORD
//   E2E_APP_NAME   an app of that account that is in Deploy (default "E2E Smoke App")
//
// Run: npx playwright install chromium && npm run test:e2e
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.js$/,
  testIgnore: '**/local/**',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
