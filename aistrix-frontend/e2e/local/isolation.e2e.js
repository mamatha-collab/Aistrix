import { expect, test } from '@playwright/test'

// Each part fails on its own: a crash in one card, widget or Settings section
// leaves the rest of the screen (and the rest of Dev Studio) working.
// SafeCard's development-only switch 'aistrix_crash_card' breaks one part by name.
test.beforeEach(({ isMobile }) => {
  test.skip(!!isMobile, 'The same cards are covered on desktop.')
})

const crash = (page, name) => page.addInitScript(card => localStorage.setItem('aistrix_crash_card', card), name)
const tab = (page, title) => page.locator(`button[title="${title}"]`).filter({ visible: true }).click()

test('a broken Revenue card leaves payouts, the other tabs and the header working', async ({ page }) => {
  await crash(page, 'Revenue')
  await page.goto('/e2e/fixtures/?scenario=operations')
  await tab(page, 'Revenue: Profit')
  await expect(page.getByRole('alert').filter({ hasText: "Revenue couldn't load" })).toBeVisible()
  await expect(page.getByText('The rest of this page still works.').first()).toBeVisible()
  await expect(page.getByRole('region', { name: 'Payout account' })).toBeVisible()
  await tab(page, 'Monitor: Usage')
  await expect(page.getByLabel('App to monitor')).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search apps, prompts, runs and pages' })).toBeVisible()
})

test('a broken header widget disappears without taking the header with it', async ({ page }) => {
  await crash(page, 'Notifications')
  await page.goto('/e2e/fixtures/?scenario=operations')
  await expect(page.getByRole('searchbox', { name: 'Search apps, prompts, runs and pages' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Keys/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveCount(0)    // the broken widget is hidden
  await expect(page.getByRole('alert')).toHaveCount(0)                                  // …without an error in the header
  await tab(page, 'Version: History')
  await expect(page.getByText('Published versions').first()).toBeVisible()
})

test('one broken Settings section leaves the others usable', async ({ page }) => {
  await crash(page, 'Developer plan')
  await page.goto('/e2e/fixtures/?scenario=shared-row')
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('menu').getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByTestId('developer-settings')
  await expect(settings.getByRole('alert').filter({ hasText: "Developer plan couldn't load" })).toBeVisible()
  for (const section of ['Profile', 'API Keys', 'Your account']) await expect(settings.getByText(section, { exact: true })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Download my data' })).toBeVisible()
})

test('a broken Market card leaves pricing and the rest of Market working', async ({ page }) => {
  await crash(page, 'Developer profile')
  await page.goto('/e2e/fixtures/?scenario=operations')
  await tab(page, 'Marketplace: List')
  await expect(page.getByRole('alert').filter({ hasText: "Developer profile couldn't load" })).toBeVisible()
  await expect(page.getByText('Pricing editor', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('Marketplace listings', { exact: false }).first()).toBeVisible()
})
