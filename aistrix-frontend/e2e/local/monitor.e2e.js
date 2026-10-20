import { expect, test } from '@playwright/test'

test.beforeEach(({ isMobile }) => {
  test.skip(!!isMobile, 'Phones use the monitoring workspace (covered in mobile-developer).')
})

const tab = (page, title) => page.locator(`button[title="${title}"]`).filter({ visible: true }).click()

test('Monitor shows production health from the server with alerts, per-app detail and versions', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=monitor')
  await tab(page, 'Monitor: Usage')
  const attention = page.getByRole('region', { name: 'Needs attention' })
  await expect(attention).toContainText('Fixture Assistant: 40% of runs failed in the last 24 hours')
  await expect(page.getByRole('row', { name: /Fixture Assistant/ })).toContainText('needs attention')
  await expect(page.getByRole('row', { name: /Second Assistant/ })).toContainText('0')
  await expect(page.getByText(/your own draft and test runs aren't counted/i)).toBeVisible()

  await page.getByRole('row', { name: /Fixture Assistant/ }).getByRole('button', { name: 'Details →' }).click()
  await expect(page.getByLabel('App to monitor')).toHaveValue('app-1')
  await expect(page.getByText('Typical response')).toBeVisible()
  await expect(page.getByRole('row', { name: /v2\s*live/ })).toBeVisible()
  await expect(page.getByText('Timed out')).toBeVisible()
  await expect(page.getByText('Website visitors', { exact: true })).toBeVisible()

  await page.getByLabel('Period').selectOption('30')
  await expect.poll(() => page.evaluate(() => window.buildFixture.requests.some(r => r.path === '/v1/apps/app-1/monitor'))).toBe(true)
  await expect(page.getByRole('img', { name: /last 30 days/ })).toBeVisible()
})

test('Monitor errors are shown with a retry, never as zero traffic', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=monitor')
  await page.evaluate(() => { window.buildFixture.failures['/v1/monitor'] = 'Monitoring is temporarily unavailable' })
  await tab(page, 'Monitor: Usage')
  await expect(page.getByRole('alert')).toContainText('Monitoring is temporarily unavailable')
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.evaluate(() => { delete window.buildFixture.failures['/v1/monitor'] })
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('row', { name: /Fixture Assistant/ })).toBeVisible()
})
