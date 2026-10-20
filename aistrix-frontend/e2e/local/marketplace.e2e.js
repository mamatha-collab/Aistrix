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

const listingTitle = page => page.locator('label:has-text("Title *") + input')

test("teammates see the app's listing, and a newer edit is never overwritten", async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    window.buildFixture.tables.marketplace_listings = [{ id: 'l-1', app_id: 'app-1', user_id: 'teammate', title: 'Teammate title',
      tagline: 'Answers business tasks', category: 'Productivity', status: 'draft', updated_at: '2026-10-20T09:00:00Z' }]
  })
  await tab(page, 'Marketplace: List')
  await expect(page.getByText('Answers business tasks')).toBeVisible()          // created by a teammate, shown to this editor
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
  await listingTitle(page).fill('My title')
  await page.evaluate(() => Object.assign(window.buildFixture.tables.marketplace_listings[0], { title: 'Newer teammate title', updated_at: '2026-10-20T09:05:00Z' }))
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByText(/Someone else changed this listing since you opened it/)).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.marketplace_listings[0].title)).toBe('Newer teammate title')
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
  await expect(listingTitle(page)).toHaveValue('Newer teammate title')
  await listingTitle(page).fill('My title')
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByText('Listing saved')).toBeVisible()
  const saved = await page.evaluate(() => window.buildFixture.tables.marketplace_listings[0])
  expect(saved.title).toBe('My title')
  expect(saved.user_id).toBe('teammate')                                          // the listing keeps its creator
})

test('pricing: no false setup-mode notice, and prices below the card minimum are refused', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await tab(page, 'Marketplace: List')
  await expect(page.getByText('Payments are in setup mode')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Set up Stripe/ })).toHaveCount(0)
  await expect(page.getByText(/projected revenue/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Paid', exact: true }).first().click()
  await page.getByPlaceholder('0.50').first().fill('0.05')
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await expect(page.getByText(/at least \$0\.50 per run/)).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].price_per_run ?? null)).not.toBe(0.05)
})
