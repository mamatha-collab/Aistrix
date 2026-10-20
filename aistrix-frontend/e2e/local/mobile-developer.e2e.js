import { test, expect } from '@playwright/test'

test.beforeEach(({ isMobile }) => { test.skip(!isMobile, 'Phone-specific monitoring layout.') })
const nav = page => page.getByRole('navigation', { name: 'Developer mobile navigation' })

test('phone opens a clean monitoring workspace with four destinations', async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await expect(page.getByRole('heading', { name: 'Monitor', exact: true })).toBeVisible()
  await expect(nav(page).getByRole('button')).toHaveCount(4)
  await expect(page.locator('button[title="Design: Blueprint"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '+ App', exact: true })).toHaveCount(0)
  // Server health: open customer feedback across apps, and no alerts in this data.
  await expect(page.getByRole('button', { name: /2\s*Feedback to review/ })).toBeVisible()
  await expect(page.getByText('No problems found in the last 7 days.')).toBeVisible()
  await expect(page.getByText(/Your own draft and test runs aren't counted/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('mobile-monitor.png') })
  for (const width of [320, 390, 767]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await nav(page).boundingBox()
    expect(box.y + box.height).toBeLessThanOrEqual(844)
    expect(box.y + box.height).toBeGreaterThanOrEqual(840)
  }
})

test('apps are grouped and feedback expands only when requested', async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await nav(page).getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Live apps · 1/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /In Build · 1/ })).toBeVisible()
  await page.getByRole('button').filter({ has: page.getByText('Fixture Assistant', { exact: true }) }).click()
  await expect(page.getByRole('heading', { name: 'App details' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Release history', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: /Feedback to review · 1/ }).click()
  await expect(page.getByLabel('Filter feedback by app')).toHaveValue('app-1')
  await expect(page.getByText('Invoice 123 is complete.', { exact: true })).not.toBeVisible()
  await page.locator('summary').filter({ hasText: 'The answer invented an invoice number.' }).click()
  await expect(page.getByText('Invoice 123 is complete.', { exact: true })).toBeVisible()
  await expect(page.getByText('The translation ignored the glossary.', { exact: true })).toHaveCount(0)
  await page.getByLabel('Filter feedback by app').selectOption('app-2')
  await expect(page.getByText('The translation ignored the glossary.', { exact: true })).toBeVisible()
  await expect(page.getByText('Invoice 123 is complete.', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('mobile-feedback.png') })
})

test('phone health errors are visible and refresh recovers', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await expect(page.getByRole('heading', { name: 'Monitor', exact: true })).toBeVisible()
  await page.evaluate(() => { window.buildFixture.failures['/v1/monitor'] = 'Health unavailable' })
  await page.getByRole('button', { name: 'Refresh app activity' }).click()
  await expect(page.getByRole('alert')).toContainText('Health unavailable')
  await expect(page.getByRole('button', { name: /—\s*Feedback to review/ })).toBeVisible()      // not shown as zero
  await page.evaluate(() => { delete window.buildFixture.failures['/v1/monitor'] })
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /2\s*Feedback to review/ })).toBeVisible()
})

test('tablet retains the full Build workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/e2e/fixtures/?scenario=operations')
  await expect(page.locator('button[title="Design: Blueprint"]').filter({ visible: true })).toBeVisible()
  await expect(nav(page)).toHaveCount(0)
})

test('release maintenance requires confirmation and preserves the draft', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    const app = window.buildFixture.tables.apps[0]
    window.buildFixture.tables.app_versions = [1, 2].map(version_num => ({ app_id: app.id, version_num, version_data: { ...app.prod_snapshot, system_prompt: `Released prompt ${version_num}` }, created_at: new Date().toISOString(), changelog: `Release ${version_num}` }))
  })
  await nav(page).getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button').filter({ has: page.getByText('Fixture Assistant', { exact: true }) }).click()
  await page.getByRole('button', { name: 'Release history', exact: true }).click()
  await page.getByRole('button', { name: 'Roll back', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Make v2 live?', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].live_version)).toBe(1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].live_version)).toBe(1)
  await page.getByRole('button', { name: 'Roll back', exact: true }).click()
  await page.getByRole('button', { name: 'Make v2 live', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.buildFixture.tables.apps[0].live_version)).toBe(2)
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].system_prompt)).toBe('Answer the task in markdown with a Summary section.')
})
