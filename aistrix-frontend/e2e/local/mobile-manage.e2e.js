import { test, expect } from '@playwright/test'

test.beforeEach(({ isMobile }) => { test.skip(!isMobile, 'Phone Manage layout.') })
const sections = page => page.getByRole('navigation', { name: 'Manage sections' })
async function openManage(page) {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    window.buildFixture.earnings = { total_gross: 150, total_dev_share: 120, total_pending: 40, platform_fee_pct: 20,
      by_app: [{ app_id: 'app-1', total_gross: 150, total_dev_share: 120, sale_count: 3 }],
      recent: [{ app_id: 'app-1', dev_share: 40, plan: 'subscription', payout_status: 'pending', created_at: new Date().toISOString() }] }
    window.buildFixture.secretsByApp = { 'app-1': [{ key: 'INVOICE_TOKEN', updated_at: new Date().toISOString() }], 'app-2': [{ key: 'TRANSLATION_TOKEN', updated_at: new Date().toISOString() }] }
  })
  await page.getByRole('navigation', { name: 'Developer mobile navigation' }).getByRole('button', { name: 'Manage' }).click()
}

test('Manage shows recorded revenue in a narrow layout with expandable details', async ({ page }, testInfo) => {
  await openManage(page)
  await expect(sections(page).getByRole('button')).toHaveCount(3)
  await expect(page.getByRole('heading', { name: 'Revenue', exact: true })).toBeVisible()
  await expect(page.getByText('$120.00', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('$40.00', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Recorded sales', { exact: true })).toBeVisible()
  await expect(page.getByText('subscription · pending', { exact: false })).not.toBeVisible()
  await page.getByText('Recent purchases', { exact: true }).click()
  await expect(page.getByText(/subscription · pending/)).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.requests.some(r => r.path === '/stripe/earnings' && r.authorized))).toBe(true)
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('mobile-revenue.png') })
})

test('revenue errors do not masquerade as zero earnings and can be retried', async ({ page }) => {
  await openManage(page)
  await expect(page.getByText('$120.00', { exact: true }).first()).toBeVisible()
  await page.evaluate(() => { window.buildFixture.failures['/stripe/earnings'] = 'Earnings temporarily unavailable' })
  await page.getByRole('button', { name: 'Refresh revenue' }).click()
  await expect(page.getByRole('alert')).toContainText('Earnings temporarily unavailable')
  await expect(page.getByText('$0.00', { exact: true })).toHaveCount(0)
  await page.evaluate(() => { delete window.buildFixture.failures['/stripe/earnings'] })
  await page.getByRole('button', { name: 'Retry revenue' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('$120.00', { exact: true }).first()).toBeVisible()
})

test('Manage versions and secrets retain app context; secret replacement is confirmed', async ({ page }) => {
  await openManage(page)
  await sections(page).getByRole('button', { name: 'Versions' }).click()
  await expect(page.getByText('Published versions', { exact: true })).toBeVisible()
  await sections(page).getByRole('button', { name: 'Secrets' }).click()
  await expect(page.getByText('INVOICE_TOKEN', { exact: true })).toBeVisible()
  await page.getByLabel('App to manage').selectOption('app-2')
  await expect(page.getByText('TRANSLATION_TOKEN', { exact: true })).toBeVisible()
  await expect(page.getByText('INVOICE_TOKEN', { exact: true })).toHaveCount(0)
  await page.getByText('Add or replace a secret', { exact: true }).click()
  await page.getByLabel('Secret name').fill('TRANSLATION_TOKEN')
  await page.getByLabel('Secret value').fill('synthetic-replacement-value')
  await page.getByRole('button', { name: 'Save secret', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Replace TRANSLATION_TOKEN?')
  expect(await page.evaluate(() => window.buildFixture.requests.filter(r => r.method === 'PUT').length)).toBe(0)
  await page.getByRole('button', { name: 'Replace secret', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('TRANSLATION_TOKEN saved')
  await expect(page.getByLabel('Secret value')).toHaveValue('')
  await expect(page.getByText('synthetic-replacement-value', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.buildFixture.requests.some(r => r.path === '/apps/app-2/secrets' && r.method === 'PUT' && r.authorized))).toBe(true)
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
