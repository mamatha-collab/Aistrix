import { test, expect } from '@playwright/test'
import { openCreate } from './studio.js'

test.beforeEach(({ isMobile }) => { test.skip(!!isMobile, 'Creation is a desktop/tablet workflow.') })

async function start(page) {
  await page.goto('/e2e/fixtures/?scenario=inline-creation')
  await page.evaluate(async () => { const { applyTheme } = await import('/src/utils/theme.ts'); applyTheme('light') })
  await openCreate(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('manual creation stays in the workspace and opens the saved app', async ({ page }, testInfo) => {
  await start(page)
  await page.getByRole('button').filter({ has: page.getByText('Prompt App', { exact: true }) }).click()
  const form = page.getByTestId('developer-creation')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('banner', { name: 'Developer header' })).toBeVisible()
  await form.getByPlaceholder('e.g. Market Research Assistant', { exact: true }).fill('Inline Builder App')
  await form.getByPlaceholder('What does this app do?', { exact: true }).fill('Summarizes support requests.')
  await page.screenshot({ path: testInfo.outputPath('inline-app-creation.png') })
  await form.getByRole('button', { name: 'Next →', exact: true }).click()
  await form.getByPlaceholder('You are a helpful assistant. Be specific, accurate, and actionable in your responses.', { exact: true }).fill('Summarize support requests accurately.')
  await form.getByRole('button', { name: 'Next →', exact: true }).click()
  await form.getByRole('button', { name: '✓ Create App', exact: true }).click()
  await expect(page.getByTestId('developer-creation')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Inline Builder App', exact: true })).toBeVisible()
})

test('stage navigation can retain unfinished app setup or discard it explicitly', async ({ page }) => {
  await start(page)
  await page.getByRole('button').filter({ has: page.getByText('Prompt App', { exact: true }) }).click()
  const name = page.getByPlaceholder('e.g. Market Research Assistant', { exact: true })
  await name.fill('Keep my unfinished app')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await expect(name).toHaveValue('Keep my unfinished app')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await expect(page.getByTestId('developer-creation')).toHaveCount(0)
})

test('Build with AI also runs inline', async ({ page }) => {
  await start(page)
  await page.getByRole('button').filter({ has: page.getByText('Describe an app with AI', { exact: true }) }).click()
  const builder = page.getByRole('region', { name: 'Build with AI', exact: true })
  await expect(builder).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await builder.getByPlaceholder('e.g. I want an app that analyzes invoices and extracts line items...').fill('Check invoice totals for a finance team.')
  await builder.getByRole('button', { name: 'Analyze idea →' }).click()
  await expect(builder.getByText('Who will use it?', { exact: true })).toBeVisible()
})
