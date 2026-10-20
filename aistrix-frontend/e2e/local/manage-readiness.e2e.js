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

test('secrets a tool needs but the app lacks are flagged and can be added from the warning', async ({ page, isMobile }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    window.buildFixture.secretsByApp = { 'app-1': [{ key: 'SERVICE_TOKEN', updated_at: new Date().toISOString() }] }
    window.buildFixture.secretsNeeded = { 'app-1': [{ key: 'SERVICE_TOKEN', used_by: ['Lookup'] }, { key: 'CRM_KEY', used_by: ['CRM sync'] }] }
  })
  await openSection(page, isMobile, 'secrets')
  const panel = page.getByRole('region', { name: 'App secrets' })
  await expect(panel.getByText('Used by Lookup')).toBeVisible()
  const warning = panel.getByRole('alert').filter({ hasText: 'Missing secrets' })
  await expect(warning).toContainText('CRM_KEY')
  await expect(warning).toContainText('used by CRM sync')
  await warning.getByRole('button', { name: 'Add' }).click()
  await expect(panel.getByLabel('Secret name')).toHaveValue('CRM_KEY')
  await panel.getByLabel('Secret value').fill('synthetic-value')
  await panel.getByRole('button', { name: 'Save secret' }).click()
  await expect(panel.getByRole('status')).toContainText('CRM_KEY saved')
  await expect(panel.getByText('Missing secrets', { exact: false })).toHaveCount(0)
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

test('revenue: period, refunds, owed payouts and CSV for accounting', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop; the phone uses the same component.')
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    window.buildFixture.earnings = { total_gross: 230, total_dev_share: 184, total_pending: 40, owed_count: 2, total_refunded: 20, disputed_count: 1,
      platform_fee_pct: 20, by_app: [], recent: [{ app_id: 'app-1', plan: 'pay_per_run', dev_share: 20, refunded_amount: 20, payout_status: 'refunded', created_at: '2026-10-19T10:00:00Z' }] }
  })
  await openSection(page, isMobile, 'revenue')
  const revenue = page.getByRole('region', { name: 'Revenue details' })
  await expect(revenue.getByText('Refunded to buyers')).toBeVisible()
  await expect(revenue.getByText('Chargebacks opened')).toBeVisible()
  await revenue.getByText('Recent purchases', { exact: true }).click()
  await expect(revenue.getByText(/One run · Refunded/)).toBeVisible()

  await revenue.getByLabel('Revenue period').selectOption('30')
  await expect.poll(() => page.evaluate(() => window.buildFixture.requests.some(r => r.path === '/stripe/earnings' && r.search === '?days=30'))).toBe(true)

  const [download] = await Promise.all([page.waitForEvent('download'), revenue.getByRole('button', { name: 'Download CSV' }).click()])
  expect(download.suggestedFilename()).toBe('aistrix-revenue-30d-2026-10-19.csv')

  await revenue.getByRole('button', { name: 'Send owed payouts' }).click()
  await expect(page.getByText('Sent 2 payouts')).toBeVisible()
  await expect(revenue.getByRole('button', { name: 'Send owed payouts' })).toHaveCount(0)
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
