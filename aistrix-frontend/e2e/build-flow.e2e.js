// Build flow smoke test: sign in, open Dev Studio, walk Design → Test →
// Deploy, and check each step renders without a crash card. On Deploy, the
// launch status, publish checklist and user preview must load from the
// server. Read-only: it doesn't publish, run tests or change the app.
import { test, expect } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
const APP_NAME = process.env.E2E_APP_NAME || 'E2E Smoke App'

test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD (a dedicated test account) to run')

// A crash anywhere shows a role="alert" error card (ErrorBoundary/SafeCard).
async function expectNoCrash(page) {
  await expect(page.getByRole('alert')).toHaveCount(0)
}

async function signIn(page) {
  await page.addInitScript(() => localStorage.setItem('aistrix_mode', 'developer'))
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
}

async function openStage(page, label) {
  // The Build stage buttons read "<icon> Design Blueprint" etc.
  await page.getByRole('button', { name: new RegExp(`^\\W*${label}\\b`) }).first().click()
}

test('Design, Test and Deploy load without crashing', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))

  await signIn(page)
  await page.goto('/developer')
  await expect(page.getByText('App Pipeline')).toBeVisible()
  await expectNoCrash(page)

  for (const stage of ['Design', 'Test', 'Deploy']) {
    await openStage(page, stage)
    await expect(page.getByText('App Pipeline')).toBeVisible()
    await expectNoCrash(page)
  }

  // Deploy: open the test app and check the launch flow loaded from the server.
  await openStage(page, 'Deploy')
  await page.getByText(APP_NAME, { exact: true }).first().click()
  await expect(page.getByText('Launch', { exact: true })).toBeVisible()
  for (const tile of ['Draft', 'Test gate', 'Publish checks', 'Live version']) {
    await expect(page.getByText(tile, { exact: true })).toBeVisible()
  }
  await expect(page.getByText('Checking this draft…')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText(/What users will see/i)).toBeVisible()
  await expect(page.getByText('Loading preview…')).toHaveCount(0, { timeout: 30_000 })
  await expectNoCrash(page)

  expect(pageErrors, `Uncaught errors: ${pageErrors.join(' | ')}`).toEqual([])
})
