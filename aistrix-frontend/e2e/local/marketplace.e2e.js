import { expect, test } from '@playwright/test'

test.beforeEach(({ isMobile }, testInfo) => {
  test.skip(!!isMobile && !/^(customers|customer|paid customer)/.test(testInfo.title), 'Marketplace listings are managed on desktop.')
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
  await expect(page.getByText('Answers business tasks').filter({ visible: true })).toBeVisible()          // created by a teammate, shown to this editor
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

test('unlisting is confirmed, can be cancelled, and preserves the deployed app', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => { window.buildFixture.tables.marketplace_listings = [{ id:'l-1',app_id:'app-1',user_id:'fixture-user',title:'Fixture Assistant',tagline:'Helpful answers',category:'Productivity',status:'live' }] })
  await tab(page, 'Marketplace: List')
  await page.getByRole('button', { name:'Unlist from Marketplace' }).click()
  await page.getByRole('button', { name:'Keep listed' }).click()
  expect(await page.evaluate(() => window.buildFixture.tables.marketplace_listings[0].status)).toBe('live')
  await page.getByRole('button', { name:'Unlist from Marketplace' }).click()
  await page.evaluate(() => { window.buildFixture.failures['/v1/apps/app-1/listing/unlist']='Temporary unlist failure' })
  await page.getByRole('button', { name:'Confirm unlist' }).click()
  await expect(page.getByText('Temporary unlist failure')).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.marketplace_listings[0].status)).toBe('live')
  await page.evaluate(() => { delete window.buildFixture.failures['/v1/apps/app-1/listing/unlist'] })
  await page.getByRole('button', { name:'Confirm unlist' }).click()
  await expect(page.getByText('draft', { exact:true })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].is_published)).toBe(true)
})

test('listing read failures are visible and retryable', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => { window.buildFixture.failures['marketplace_listings:select']='Listing store unavailable' })
  await tab(page, 'Marketplace: List')
  await expect(page.getByRole('alert').filter({ hasText:'Listing store unavailable' })).toBeVisible()
  await page.evaluate(() => { delete window.buildFixture.failures['marketplace_listings:select'] })
  await page.getByRole('button', { name:'Retry listings' }).click()
  await expect(page.getByText('Marketplace listings', { exact:true })).toBeVisible()
})

test('customers can search all pages, filter and open the shared app runtime', async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/?scenario=market-customer')
  await expect(page.getByRole('button', { name:'Listed app 1', exact:true })).toBeVisible()
  await expect(page.getByRole('button', { name:'Unpublished app', exact:true })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Listed app 26', exact:true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('market-discovery.png') })
  await page.getByRole('button', { name:'Next', exact:true }).click()
  await expect(page.getByRole('button', { name:'Listed app 26', exact:true })).toBeVisible()
  await page.getByLabel('Search apps by title').fill('Listed app 26')
  await expect(page.getByRole('button', { name:'Listed app 26', exact:true })).toBeVisible()
  await expect(page.getByText('Page 1', { exact:true })).toBeVisible()
  await page.getByRole('button', { name:'Listed app 26', exact:true }).click()
  // Fixture uses one app with many listings to exercise paging; detail returns the first.
  await page.getByRole('link', { name:'Open app →' }).click()
  await expect(page.getByText('Shared app runner destination')).toBeVisible()
})

test('customer read outages show an error and recover without pretending the catalog is empty', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=market-customer')
  await expect(page.getByRole('button', { name:'Listed app 1', exact:true })).toBeVisible()
  await page.evaluate(() => { window.buildFixture.failures['marketplace_listings:select']='Catalog temporarily offline' })
  await page.getByLabel('Search apps by title').fill('Listed')
  await expect(page.getByRole('alert')).toContainText('Catalog temporarily offline')
  await page.evaluate(() => { delete window.buildFixture.failures['marketplace_listings:select'] })
  await page.getByRole('button', { name:'Retry Marketplace' }).click()
  await page.getByRole('button', { name:'Listed app 1', exact:true }).click()
  await expect(page.getByRole('link', { name:'Open app →' })).toBeVisible()
})

test('paid customer access reflects unused quota and can be refreshed', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=market-customer')
  await expect(page.getByRole('button', { name:'Listed app 1', exact:true })).toBeVisible()
  await page.evaluate(() => {
    Object.assign(window.buildFixture.tables.apps[0], { is_paid:true,price_per_run:2 })
    window.buildFixture.tables.app_entitlements=[{id:'ent',app_id:'app-1',user_id:'fixture-user',plan:'pay_per_run',status:'active',run_quota:1,runs_used:1}]
  })
  await page.getByRole('button', { name:'Listed app 1', exact:true }).click()
  await expect(page.getByRole('button', { name:'Buy one run' })).toBeVisible()
  await page.evaluate(() => { window.buildFixture.tables.app_entitlements[0].run_quota=2 })
  await page.getByRole('button', { name:'Refresh access' }).click()
  await expect(page.getByRole('button', { name:'Buy one run' })).toHaveCount(0)
  await expect(page.getByRole('link', { name:'Open app →' })).toBeVisible()
})
