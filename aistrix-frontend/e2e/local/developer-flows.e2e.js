import { test, expect } from '@playwright/test'

test.beforeEach(({ isMobile }) => {
  test.skip(!!isMobile, 'Phones use the monitoring workspace; Build and release steps are tested on desktop.')
})

async function open(page, query = '') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || url.protocol === 'data:' ? route.continue() : route.abort()
  })
  await page.goto(`/e2e/fixtures/${query}`)
}

async function openLiveDeploy(page) {
  await open(page, '?scenario=live')
  await page.getByRole('button', { name: /^\W*Deploy(\s+Publish)?$/ }).first().click()
  await page.getByRole('button').filter({ has: page.getByText('Fixture Assistant', { exact: true }) }).first().click()
  await expect(page.getByText('Launch', { exact: true })).toBeVisible()
}

test('unpublishing asks first and says which workflows run the app', async ({ page }) => {
  await openLiveDeploy(page)
  await page.evaluate(() => {
    window.buildFixture.tables.flows = [
      { id: 'wf-1', user_id: 'fixture-user', kind: 'developer', name: 'Invoice flow', webhook_token: 'on', steps: [{ id: 's1', app_id: 'app-1' }] },
      { id: 'wf-2', user_id: 'fixture-user', kind: 'developer', name: 'Other apps only', steps: [{ id: 's1', app_id: 'app-2' }] },
    ]
  })
  await page.getByRole('button', { name: '⏸ Unpublish (set to draft)', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Unpublish this app?' })
  await expect(dialog.getByText('1 workflow has a step that runs this app.')).toBeVisible()
  await expect(dialog.getByText('Invoice flow (webhook is on)')).toBeVisible()
  await expect(dialog.getByText('Other apps only')).toHaveCount(0)
  await expect(dialog.getByText("People can't run it as soon as you confirm.")).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].is_published)).toBe(true)
  await page.getByRole('button', { name: '⏸ Unpublish (set to draft)', exact: true }).click()
  await page.getByRole('dialog', { name: 'Unpublish this app?' }).getByRole('button', { name: 'Unpublish', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.buildFixture.tables.apps[0].is_published)).toBe(false)
})

test('an app no workflow uses unpublishes after a plain confirmation', async ({ page }) => {
  await openLiveDeploy(page)
  await page.getByRole('button', { name: '⏸ Unpublish (set to draft)', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Unpublish this app?' })
  await expect(dialog.getByRole('button', { name: 'Unpublish', exact: true })).toBeEnabled()
  await expect(dialog.getByText(/workflows? (has|have) /)).toHaveCount(0)
})

test('coming back from GitHub lands on the GitHub setting and says what happened', async ({ page }) => {
  await open(page, '?github_connected=1')
  await expect(page.getByText(/GitHub is connected/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Issue to improve' })).toBeVisible()
  expect(new URL(page.url()).searchParams.has('github_connected')).toBe(false)
})

test('a GitHub connection that did not finish is reported, not silently dropped', async ({ page }) => {
  await open(page, '?github_connected=0')
  await expect(page.getByText(/GitHub didn't finish connecting/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Issue to improve' })).toBeVisible()
})

test('an expired payout setup link explains how to continue', async ({ page }) => {
  await open(page, '?stripe_connect=refresh')
  await expect(page.getByText(/payout setup link expired/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Payout account' })).toBeVisible()
})

test('design readiness never says every check passes while the design is incomplete', async ({ page }) => {
  await open(page)
  await page.getByRole('button').filter({ has: page.getByText('Fixture Assistant', { exact: true }) }).first().click()
  await expect(page.getByText(/Design Readiness/)).toBeVisible()
  await expect(page.getByText('Design incomplete', { exact: true })).toBeVisible()
  await expect(page.getByText('all design checks pass')).toHaveCount(0)
  await expect(page.getByText('the design above is still incomplete', { exact: false })).toBeVisible()
})
