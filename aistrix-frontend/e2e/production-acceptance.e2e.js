import { test, expect } from '@playwright/test'

const api = process.env.E2E_API_URL
test.skip(!process.env.E2E_BASE_URL || !api || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'A hosted staging environment and dedicated account are required.')

test('public discovery stays public and private screens reject anonymous access', async ({ request }) => {
  const catalog = await request.get('/marketplace')
  expect(catalog.status()).toBe(200)
  expect(await catalog.text()).toContain('Market')
  const privatePage = await request.get('/developer', { maxRedirects: 0 })
  expect([303, 307, 308]).toContain(privatePage.status())
  expect(privatePage.headers().location).toContain('/login')
  const spending = await request.get(`${api}/v1/spend`)
  expect([401, 403]).toContain(spending.status())
  const health = await request.get(`${api}/health`)
  expect(health.status()).toBe(200)
  const publicHealth = await health.json()
  expect(publicHealth).not.toHaveProperty('database_project')
  expect(publicHealth).not.toHaveProperty('process_id')
})

test('dedicated developer sign-in reaches protected routes and sign-out revokes them', async ({ page }) => {
  await page.goto('/login?next=/developer')
  await page.getByPlaceholder('you@example.com').fill(process.env.E2E_EMAIL)
  await page.locator('input[type="password"]').fill(process.env.E2E_PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/developer(?:\?|$)/)
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.goto('/developer')
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
})
