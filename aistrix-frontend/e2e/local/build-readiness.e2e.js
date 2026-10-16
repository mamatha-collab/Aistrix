import { test, expect } from '@playwright/test'

test.beforeEach(({ isMobile }) => {
  test.skip(!!isMobile, 'Phones use the monitoring workspace; Build and regression authoring are tested on desktop.')
})

async function stage(page, label) {
  await page.getByRole('button', { name: new RegExp(`^\\W*${label}(\\s+(Blueprint|Validate|Publish))?$`) }).first().click()
}

async function open(page, query = '') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || url.protocol === 'data:' ? route.continue() : route.abort()
  })
  await page.goto(`/e2e/fixtures/${query}`)
  if (query.includes('live')) await stage(page, 'Deploy')
  await pickApp(page)
  if (query.includes('live')) await expect(page.getByText('Launch', { exact: true })).toBeVisible()
  else if (query.includes('read-failure')) await expect(page.getByRole('alert')).toBeVisible()
  else await expect(page.getByRole('button', { name: 'Save blueprint', exact: true }).first()).toBeVisible()
}

async function pickApp(page, name = 'Fixture Assistant') {
  await page.getByRole('button').filter({ has: page.getByText(name, { exact: true }) }).first().click()
}

const fallback = page => page.getByPlaceholder('e.g. Ask for the missing job description before proceeding')
const save = page => page.getByRole('button', { name: 'Save blueprint', exact: true }).first().click()

test('failed blueprint load preserves the saved record and can be retried', async ({ page }) => {
  await open(page, '?scenario=read-failure')
  await expect(page.getByRole('alert')).toContainText('Could not load your saved design')
  await expect(page.getByRole('button', { name: 'Save blueprint', exact: true })).toHaveCount(0)
  await page.evaluate(() => { delete window.buildFixture.failures['app_blueprints:select'] })
  await page.getByRole('button', { name: 'Retry loading design' }).click()
  await expect(fallback(page)).toHaveValue('Ask for the missing task.')
})

test('save failure keeps edits available for a successful retry', async ({ page }) => {
  await open(page)
  await fallback(page).fill('Ask the user for a company name.')
  await page.evaluate(() => { window.buildFixture.failures['app_blueprints:update'] = 'Connection interrupted' })
  await save(page)
  await expect(page.getByText('Connection interrupted', { exact: true })).toBeVisible()
  await expect(fallback(page)).toHaveValue('Ask the user for a company name.')
  await page.evaluate(() => { delete window.buildFixture.failures['app_blueprints:update'] })
  await save(page)
  await expect(page.getByText('Blueprint saved', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.app_blueprints[0].blueprint.ai_behavior.fallback_behavior)).toBe('Ask the user for a company name.')
})

test('leaving with unsaved edits can save them first, then continue', async ({ page }) => {
  await open(page)
  await fallback(page).fill('Save me before leaving.')
  await stage(page, 'Test')
  await page.getByRole('dialog').filter({ hasText: 'Leave without saving?' })
    .getByRole('button', { name: /Save changes, then continue/ }).click()
  await expect(page.getByText(/Still designing — blueprint may be incomplete/)).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.app_blueprints[0].blueprint.ai_behavior.fallback_behavior)).toBe('Save me before leaving.')
})

test('stage navigation can be cancelled without discarding edits', async ({ page }) => {
  await open(page)
  await fallback(page).fill('Keep this unsaved change.')
  await stage(page, 'Test')
  const leave = page.getByRole('dialog').filter({ hasText: 'Leave without saving?' })
  await leave.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(fallback(page)).toHaveValue('Keep this unsaved change.')
  await stage(page, 'Test')
  await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page.getByText(/Still designing — blueprint may be incomplete/)).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.app_blueprints[0].blueprint.ai_behavior.fallback_behavior)).toBe('Ask for the missing task.')
})

test('concurrent saves show a conflict and preserve the newer saved design', async ({ page }) => {
  await open(page)
  await fallback(page).fill('My older edit.')
  await page.evaluate(() => {
    const row = window.buildFixture.tables.app_blueprints[0]
    row.updated_at = '2026-10-14T13:00:00.000Z'
    row.blueprint.ai_behavior.fallback_behavior = 'A teammate saved this.'
  })
  await save(page)
  await expect(page.getByRole('dialog')).toContainText('This design changed since you opened it')
  expect(await page.evaluate(() => window.buildFixture.tables.app_blueprints[0].blueprint.ai_behavior.fallback_behavior)).toBe('A teammate saved this.')
  await page.getByRole('button', { name: /Load their version instead/ }).click()
  await expect(fallback(page)).toHaveValue('A teammate saved this.')
})

test('a failed phase move stays in its original phase', async ({ page }) => {
  await open(page)
  await stage(page, 'Test')
  await page.evaluate(() => { window.buildFixture.failures['app_blueprints:update'] = 'Phase save refused' })
  await pickApp(page)
  await expect(page.getByText('Could not move app: Phase save refused', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.app_blueprints[0].blueprint.dev_phase)).toBe('design')
  await expect(page.getByText(/Still designing — blueprint may be incomplete/)).toBeVisible()
})

test('Design to Test to Publish records a live version', async ({ page }, testInfo) => {
  await open(page)
  await save(page)
  await stage(page, 'Test')
  await pickApp(page)
  await page.getByRole('button', { name: /Run tests$/ }).click()
  await expect(page.getByRole('button', { name: /Run tests again/ })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.testRuns.length)).toBeGreaterThan(3)
  await page.getByRole('button', { name: /Continue to Deploy/ }).click()
  await page.getByRole('button', { name: /Publish app/ }).click()
  await expect(page.getByText('Published versions', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.buildFixture.tables.apps[0].live_version)).toBe(1)
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].prod_snapshot.system_prompt)).toContain('Summary')
  const logo = page.locator('img[src="/aistrix-logo.svg"]').filter({ visible: true })
  if (testInfo.project.name === 'mobile') {
    expect((await logo.boundingBox()).x).toBeGreaterThanOrEqual(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.screenshot({ path: testInfo.outputPath('build-published.png'), fullPage: true })
})

test('creates an app through the real creation form and opens its design', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '+ App', exact: true }).click()
  await page.getByPlaceholder('e.g. Market Research Assistant', { exact: true }).fill('New Browser App')
  await page.getByPlaceholder('What does this app do?', { exact: true }).fill('Summarizes business tasks.')
  await page.getByRole('dialog').getByRole('button', { name: 'Next →', exact: true }).click()
  await page.getByPlaceholder('You are a helpful assistant. Be specific, accurate, and actionable in your responses.', { exact: true }).fill('Summarize the business task clearly.')
  await page.getByRole('dialog').getByRole('button', { name: 'Next →', exact: true }).click()
  await page.getByRole('button', { name: '✓ Create App', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save blueprint', exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.apps.some(app => app.name === 'New Browser App'))).toBe(true)
})

test('promotion changes the live snapshot only after confirmation; rollback preserves the draft', async ({ page }) => {
  await open(page, '?scenario=live')
  const livePrompt = () => page.evaluate(() => window.buildFixture.tables.apps[0].prod_snapshot.system_prompt)
  expect(await livePrompt()).toBe('Current published prompt.')
  await page.getByRole('button', { name: /Promote draft to live/ }).click()
  await expect(page.getByText('System prompt', { exact: true })).toBeVisible()
  expect(await livePrompt()).toBe('Current published prompt.')
  await page.getByRole('button', { name: 'Next →', exact: true }).click()
  await page.getByRole('button', { name: /Promote to production/ }).click()
  await expect.poll(livePrompt).toContain('Summary')
  await page.getByRole('button', { name: 'Roll back', exact: true }).last().click()
  await page.getByRole('button', { name: 'Make v1 live', exact: true }).click()
  await expect.poll(livePrompt).toBe('Original published prompt.')
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].system_prompt)).toContain('Summary')
})

test('an unavailable promotion review cannot advance to publication', async ({ page }) => {
  await open(page, '?scenario=live')
  await page.evaluate(() => { window.buildFixture.failures['app_tools:select'] = 'Could not load tools' })
  await page.getByRole('button', { name: /Promote draft to live/ }).click()
  await expect(page.getByRole('alert')).toContainText('Could not load tools')
  await expect(page.getByRole('button', { name: 'Next →', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].live_version)).toBe(2)
})

test('provider refusal stops the suite and never unlocks deployment', async ({ page }) => {
  await open(page)
  await stage(page, 'Test')
  await pickApp(page)
  await page.evaluate(() => { window.buildFixture.failures['/v1/apps/app-1/tests/run'] = 'OpenAI turned this run away.' })
  await page.getByRole('button', { name: /Run tests$/ }).click()
  await expect(page.getByText('OpenAI turned this run away.', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Continue to Deploy/ })).toHaveCount(0)
  const attempts = await page.evaluate(() => window.buildFixture.requests.filter(request => request.path.endsWith('/tests/run')).length)
  expect(attempts).toBe(1)
})

test('a recovered live preview clears its earlier failure message', async ({ page }) => {
  await open(page, '?scenario=live-preview-failure')
  await expect(page.getByText('Temporary preview failure', { exact: true })).toBeVisible()
  await page.evaluate(() => { delete window.buildFixture.failures['/v1/apps/app-1/live-preview'] })
  await page.getByRole('button', { name: /Promote draft to live/ }).click()
  await page.getByRole('button', { name: 'Next →', exact: true }).click()
  await page.getByRole('button', { name: /Promote to production/ }).click()
  await expect.poll(() => page.evaluate(() => window.buildFixture.tables.apps[0].live_version)).toBe(3)
  await expect(page.getByText('Temporary preview failure', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Preview of the app page', { exact: true })).toBeVisible()
})

test('unpublishing refreshes the preview to show that the app is offline', async ({ page }) => {
  await open(page, '?scenario=live')
  await expect(page.getByText(/^Live · v2/)).toBeVisible()
  await page.getByRole('button', { name: '⏸ Unpublish (set to draft)', exact: true }).click()
  await expect(page.getByText('Unpublished — this is the last live version', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].is_published)).toBe(false)
})

test('app settings: a save based on the current value goes through', async ({ page }) => {
  await open(page, '?scenario=live')
  const box = page.getByPlaceholder('Explain what this app does, who it helps, and what result it produces.')
  await box.fill('Summarises meeting notes for busy teams.')
  await box.locator('xpath=..').getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.buildFixture.tables.apps[0].description)).toBe('Summarises meeting notes for busy teams.')
})

test("app settings: a teammate's newer change is never overwritten", async ({ page }) => {
  await open(page, '?scenario=live')
  // A teammate saves a different description after this page loaded.
  await page.evaluate(() => { window.buildFixture.tables.apps[0].description = 'Teammate wrote this.' })
  const box = page.getByPlaceholder('Explain what this app does, who it helps, and what result it produces.')
  await box.fill('My stale edit.')
  await box.locator('xpath=..').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Someone else changed the description/)).toBeVisible()
  await expect(box).toHaveValue('Teammate wrote this.')
  expect(await page.evaluate(() => window.buildFixture.tables.apps[0].description)).toBe('Teammate wrote this.')
})
