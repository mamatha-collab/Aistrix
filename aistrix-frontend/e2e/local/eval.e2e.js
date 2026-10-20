import { expect, test } from '@playwright/test'

test.beforeEach(({ isMobile }) => test.skip(!!isMobile, 'Regression authoring belongs on desktop/tablet.'))
const flow = page => page.getByRole('region', { name: 'Operate and Grow workflow' })
const open = async page => { await page.goto('/e2e/fixtures/?scenario=operations'); await page.locator('button[title="Evaluate: Quality"]').filter({ visible: true }).click() }

test('triage notes persist, failures retain edits and Improve has one context card', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await open(page)
  await flow(page).getByLabel('Triage note', { exact: true }).fill('Reproduced on v1. Missing invoice number must be explicit.')
  await page.evaluate(() => { window.buildFixture.failures[`/v1/feedback/${window.buildFixture.feedback[0].id}`] = 'Triage storage unavailable' })
  await flow(page).getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(flow(page).getByRole('alert')).toContainText('Triage storage unavailable')
  await expect(flow(page).getByLabel('Triage note', { exact: true })).toHaveValue(/Reproduced on v1/)
  await page.evaluate(() => { delete window.buildFixture.failures[`/v1/feedback/${window.buildFixture.feedback[0].id}`] })
  await flow(page).getByRole('button', { name: 'Save note', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.buildFixture.feedback[0].note)).toContain('Reproduced on v1')
  await flow(page).getByLabel('Expected behavior').fill('Keep this unsaved expectation')
  await flow(page).getByLabel('Feedback status').selectOption('verified')
  await expect(flow(page).getByRole('alert')).toContainText('Save a regression test')
  await expect(flow(page).getByLabel('Feedback status')).toHaveValue('new')
  await flow(page).getByLabel('App to operate').selectOption('app-2')
  await expect(flow(page).getByLabel('Regression input')).toHaveValue('Translate the receipt.')
  await flow(page).getByLabel('App to operate').selectOption('app-1')
  await expect(flow(page).getByLabel('Expected behavior')).toHaveValue('Keep this unsaved expectation')
  await flow(page).getByRole('button', { name: 'Continue to Improve' }).click()
  await expect(flow(page).getByRole('heading', { name: 'Evaluated issue' })).toBeVisible()
  await expect(flow(page).getByLabel('Triage note', { exact: true })).toHaveCount(0)
  await expect(flow(page).getByLabel('Regression input')).toHaveCount(0)
  await expect(flow(page).getByText(/Reproduced on v1/)).toBeVisible()
  expect(errors).toEqual([])
})

test('the full queue is paginated and shared empty evidence differs from private evidence', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    const sample = window.buildFixture.feedback[0]
    window.buildFixture.feedback = Array.from({ length: 205 }, (_, i) => ({ ...sample, id: `report-${i}`, run_id: `run-${i}`, comment: `Report ${i}`, shared_input: i === 0 ? '' : null, shared_output: null }))
  })
  await page.locator('button[title="Evaluate: Quality"]').filter({ visible: true }).click()
  await expect(flow(page).getByLabel('Feedback list').getByRole('button')).toHaveCount(20)
  await flow(page).getByText('Customer question', { exact: true }).click()
  await expect(flow(page).getByText('Shared, but empty', { exact: true })).toBeVisible()
  for (let i = 0; i < 10; i++) {
    await flow(page).getByRole('button', { name: 'Next', exact: true }).click()
    await expect(flow(page).getByText(`Page ${i + 2}`, { exact: true })).toBeVisible()
    await expect(flow(page).getByLabel('Feedback list').getByRole('button').first()).toContainText(`Report ${(i + 1) * 20}`)
  }
  await expect(flow(page).getByLabel('Feedback list').getByRole('button')).toHaveCount(5)
  await expect(flow(page).getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await expect(flow(page).getByText(/The customer didn't share/)).toBeVisible()
  await flow(page).getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(flow(page).getByText('Page 10', { exact: true })).toBeVisible()
})

test('a saved regression survives a failed feedback link and retry without duplicate cases', async ({ page }) => {
  await open(page)
  await flow(page).getByLabel('Expected behavior').fill('Missing invoice number')
  await page.evaluate(() => { window.buildFixture.failures[`/v1/feedback/${window.buildFixture.feedback[0].id}`] = 'Link unavailable' })
  await flow(page).getByRole('button', { name: 'Save regression test' }).click()
  await expect(flow(page).getByRole('alert')).toContainText('Test saved, but feedback linking failed')
  await expect.poll(() => page.evaluate(() => window.buildFixture.tables.app_test_cases.length)).toBe(1)
  await page.evaluate(() => { delete window.buildFixture.failures[`/v1/feedback/${window.buildFixture.feedback[0].id}`] })
  await flow(page).getByRole('button', { name: 'Retry feedback link' }).click()
  await expect(flow(page).getByRole('alert')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.buildFixture.feedback[0].test_case_id)).toBeTruthy()
  await flow(page).getByRole('button', { name: 'Refresh feedback' }).click()
  await expect(flow(page).getByText(/Regression test saved. Run and edit it/)).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.app_test_cases.length)).toBe(1)
})

test('quality outages stay unknown and recover without a false readiness claim', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    window.buildFixture.failures['/v1/apps/app-1/monitor'] = 'Ratings unavailable'
    window.buildFixture.failures['/v1/apps/app-1/tests/status'] = 'Test results unavailable'
  })
  await page.locator('button[title="Evaluate: Quality"]').filter({ visible: true }).click()
  const quality = page.getByRole('region', { name: 'Quality', exact: true })
  await expect(quality.getByRole('alert')).toContainText('Test results unavailable')
  await expect(quality.getByText('Required checks passed on this draft')).toHaveCount(0)
  await expect(quality.getByText('0%', { exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    delete window.buildFixture.failures['/v1/apps/app-1/monitor']
    delete window.buildFixture.failures['/v1/apps/app-1/tests/status']
  })
  await quality.getByRole('button', { name: 'Retry quality summary' }).click()
  await expect(quality.getByRole('alert')).toHaveCount(0)
  await quality.getByText('Current draft validation details', { exact: true }).click()
  await expect(quality.getByRole('button', { name: 'Run the tests →' })).toBeVisible()
})

test('linked regression edits are preserved and a missing linked test blocks duplicates', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=operations')
  await page.evaluate(() => {
    window.buildFixture.feedback[0].test_case_id = 'existing-edited-case'
    window.buildFixture.tables.app_test_cases.push({ id: 'existing-edited-case', app_id: 'app-1', user_id: 'fixture-user', name: 'Developer edited regression', input: 'Edited input', rules: [{ type: 'must-not-contain', value: 'Edited assertion' }] })
  })
  await page.locator('button[title="Evaluate: Quality"]').filter({ visible: true }).click()
  await expect(flow(page).getByText('Developer edited regression')).toBeVisible()
  await expect(flow(page).getByRole('button', { name: 'Save regression test' })).toHaveCount(0)
  await page.evaluate(() => { window.buildFixture.tables.app_test_cases = [] })
  // Switching apps remounts the coverage check, as a separate visit would.
  await flow(page).getByLabel('App to operate').selectOption('app-2')
  await expect(flow(page).getByLabel('Regression input')).toHaveValue('Translate the receipt.')
  await flow(page).getByLabel('App to operate').selectOption('app-1')
  await expect(flow(page).getByRole('alert')).toContainText('The linked test is unavailable')
  await flow(page).getByLabel('Expected behavior').fill('Do not create another case')
  await expect(flow(page).getByRole('button', { name: 'Save regression test' })).toBeDisabled()
})

test('both Monitor and Eval disclose delayed telemetry until recovery', async ({ page }) => {
  await page.goto('/e2e/fixtures/?scenario=monitor')
  await page.evaluate(() => { window.buildFixture.telemetryHealth = { status: 'delayed', pending: 3, failed: 1, recovery_path_configured: true } })
  await page.locator('button[title="Monitor: Usage"]').filter({ visible: true }).click()
  await expect(page.getByText(/3 run outcomes awaiting delivery/)).toBeVisible()
  await page.locator('button[title="Evaluate: Quality"]').filter({ visible: true }).click()
  await expect(page.getByText(/3 run outcomes awaiting delivery/)).toBeVisible()
  await page.evaluate(() => { window.buildFixture.telemetryHealth = { status: 'ok', pending: 0, failed: 0, recovery_path_configured: true } })
  await flow(page).getByRole('button', { name: 'Refresh feedback' }).click()
  await expect(page.getByText(/run outcomes awaiting delivery/)).toHaveCount(0)
})
