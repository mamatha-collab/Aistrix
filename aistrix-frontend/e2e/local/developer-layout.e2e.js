import { test, expect } from '@playwright/test'

test.beforeEach(({ isMobile }) => { test.skip(!!isMobile, 'Phone keeps its monitoring workspace.') })

async function open(page) {
  await page.goto('/e2e/fixtures/?scenario=shared-row')
  await page.evaluate(async () => { const { applyTheme } = await import('/src/utils/theme.js'); applyTheme('light') })
  await page.locator('.developer-app-list').getByRole('button').filter({ has: page.getByText('Fixture Assistant', { exact: true }) }).click()
  await expect(page.getByLabel('System prompt', { exact: true })).toBeVisible()
}

test('apps, prompt and preview stay in columns; failed prompt saves retain edits', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open(page)
  const sidebar = await page.locator('.developer-app-list').boundingBox()
  const config = await page.getByRole('region', { name: 'Prompt configuration' }).boundingBox()
  const preview = await page.getByRole('region', { name: 'Prompt preview' }).boundingBox()
  expect(sidebar.x).toBeLessThan(config.x)
  expect(config.x + config.width).toBeLessThan(preview.x)
  expect(Math.abs(config.y - preview.y)).toBeLessThan(2)
  await page.getByLabel('System prompt', { exact: true }).fill('Answer accurately. Ask for missing context.')
  await page.evaluate(() => { window.buildFixture.failures['rpc:update_app_fields'] = 'Prompt save unavailable' })
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Prompt save unavailable', { exact: true })).toBeVisible()
  await expect(page.getByLabel('System prompt', { exact: true })).toHaveValue('Answer accurately. Ask for missing context.')
  await page.evaluate(() => { delete window.buildFixture.failures['rpc:update_app_fields'] })
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.buildFixture.tables.apps[0].system_prompt)).toBe('Answer accurately. Ask for missing context.')
  await page.getByRole('button', { name: /Run preview/ }).click()
  await expect(page.getByRole('region', { name: 'Prompt preview' })).toContainText('questions')
  for (const width of [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: testInfo.outputPath('developer-layout.png') })
})

test('changing apps protects prompt edits and opens the intended app after saving', async ({ page }) => {
  await open(page)
  await page.getByLabel('System prompt', { exact: true }).fill('Keep this draft before switching apps.')
  const nextApp = page.locator('.developer-app-list').getByRole('button').filter({ has: page.getByText('Second Assistant', { exact: true }) })
  await nextApp.click()
  const dialog = page.getByRole('dialog', { name: 'Leave without saving the prompt?' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByLabel('System prompt', { exact: true })).toHaveValue('Keep this draft before switching apps.')
  await nextApp.click()
  await dialog.getByRole('button', { name: 'Save prompt, then continue →' }).click()
  await expect(page.getByRole('heading', { name: 'Second Assistant', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].system_prompt)).toBe('Keep this draft before switching apps.')
  await expect(page.getByLabel('System prompt', { exact: true })).not.toHaveValue('Keep this draft before switching apps.')
})
