import { test, expect } from '@playwright/test'

async function openSection(page, isMobile, name) {
  if (isMobile) {
    await page.getByRole('navigation', { name: 'Developer mobile navigation' }).getByRole('button', { name: 'Manage' }).click()
    if (name === 'secrets') await page.getByRole('navigation', { name: 'Manage sections' }).getByRole('button', { name: 'Secrets' }).click()
  } else {
    await page.locator(`button[title="${name === 'secrets' ? 'Secrets: Env vars' : 'Revenue: Profit'}"]`).filter({ visible: true }).click()
  }
}

test('secret deletion requires confirmation and failure never reports success', async ({ page, isMobile }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => { window.buildFixture.secretsByApp = { 'app-1': [{ key: 'SERVICE_TOKEN', updated_at: new Date().toISOString() }] } })
  await openSection(page, isMobile, 'secrets')
  await page.getByRole('button', { name: 'Remove SERVICE_TOKEN', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Remove SERVICE_TOKEN?')
  expect(await page.evaluate(() => window.buildFixture.requests.filter(r => r.method === 'DELETE').length)).toBe(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('SERVICE_TOKEN', { exact: true })).toBeVisible()
  await page.evaluate(() => { window.buildFixture.failures['/apps/app-1/secrets/SERVICE_TOKEN'] = 'Deletion temporarily unavailable' })
  await page.getByRole('button', { name: 'Remove SERVICE_TOKEN', exact: true }).click()
  await page.getByRole('button', { name: 'Remove secret', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Deletion temporarily unavailable')
  await expect(page.getByText('SERVICE_TOKEN', { exact: true })).toBeVisible()
  await expect(page.getByText('SERVICE_TOKEN removed', { exact: true })).toHaveCount(0)
  await page.evaluate(() => { delete window.buildFixture.failures['/apps/app-1/secrets/SERVICE_TOKEN'] })
  await page.getByRole('button', { name: 'Remove SERVICE_TOKEN', exact: true }).click()
  await page.getByRole('button', { name: 'Remove secret', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('SERVICE_TOKEN removed')
  await expect(page.getByText('SERVICE_TOKEN', { exact: true })).toHaveCount(0)
})

test('desktop and mobile use the same recorded earnings and error states', async ({ page, isMobile }, testInfo) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    window.buildFixture.earnings = { total_gross: 250, total_dev_share: 200, total_pending: 60, platform_fee_pct: 20, by_app: [], recent: [] }
  })
  await openSection(page, isMobile, 'revenue')
  const revenue = page.getByRole('region', { name: 'Revenue details' })
  await expect(revenue.getByText('$200.00', { exact: true })).toBeVisible()
  await expect(revenue.getByText('$60.00', { exact: true })).toBeVisible()
  await expect(revenue.getByText('$250.00', { exact: true })).toBeVisible()
  await expect(revenue.getByText('Potential revenue', { exact: true })).toHaveCount(0)
  await page.evaluate(() => { window.buildFixture.failures['/stripe/earnings'] = 'Ledger unavailable' })
  await revenue.getByRole('button', { name: 'Refresh revenue' }).click()
  await expect(revenue.getByRole('alert')).toContainText('Ledger unavailable')
  await expect(revenue.getByText('$0.00', { exact: true })).toHaveCount(0)
  await page.evaluate(() => { delete window.buildFixture.failures['/stripe/earnings'] })
  await revenue.getByRole('button', { name: 'Retry revenue' }).click()
  await expect(revenue.getByText('$200.00', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('manage-revenue.png') })
})

test('payout verification errors remain visible instead of implying a disconnected account', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Payout onboarding remains in the desktop workspace.')
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => { window.buildFixture.failures['/stripe/connect/status'] = 'Payout verification unavailable' })
  await openSection(page, isMobile, 'revenue')
  const panel = page.getByRole('region', { name: 'Payout account' })
  await expect(panel.getByRole('alert')).toContainText('Payout verification unavailable')
  await expect(panel.getByRole('button', { name: 'Set up payouts →', exact: true })).toHaveCount(0)
  await page.evaluate(() => { delete window.buildFixture.failures['/stripe/connect/status'] })
  await panel.getByRole('button', { name: 'Refresh payout status' }).click()
  await expect(panel.getByText('Payout account setup is incomplete.', { exact: true })).toBeVisible()
})
