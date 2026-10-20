import { expect, test } from '@playwright/test'

test.beforeEach(({ isMobile }) => {
  test.skip(!!isMobile, 'Marketplace listings are managed on desktop.')
})

const tab = (page, title) => page.locator(`button[title="${title}"]`).filter({ visible: true }).click()

test('a complete listing for a published app goes live through the server', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    window.buildFixture.tables.marketplace_listings = [{ id: 'l-1', app_id: 'app-1', user_id: 'fixture-user', title: 'Fixture Assistant',
      tagline: 'Answers business tasks', category: 'Productivity', status: 'draft' }]
  })
  await tab(page, 'Marketplace: List')
  await page.getByRole('button', { name: 'Go live →' }).click()
  await expect(page.getByText('live', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.requests.some(r => r.path === '/v1/apps/app-1/listing/go-live' && r.method === 'POST'))).toBe(true)
})

test('a server refusal keeps the listing in draft and says why', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    window.buildFixture.tables.marketplace_listings = [{ id: 'l-1', app_id: 'app-1', user_id: 'fixture-user', title: 'Fixture Assistant',
      tagline: 'Answers business tasks', category: 'Productivity', status: 'draft' }]
    window.buildFixture.failures['/v1/apps/app-1/listing/go-live'] = 'Publish the app in Deploy first (it must pass its tests)'
  })
  await tab(page, 'Marketplace: List')
  await page.getByRole('button', { name: 'Go live →' }).click()
  await expect(page.getByText('Publish the app in Deploy first (it must pass its tests)')).toBeVisible()
  await expect(page.getByText('draft', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.marketplace_listings[0].status)).toBe('draft')
})
