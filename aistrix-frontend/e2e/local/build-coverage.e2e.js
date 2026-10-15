// Build journeys that need a real publish, a key-less account, an AI call or
// a file download — covered here against the in-memory fixture (no account,
// provider or cloud writes).
import fs from 'node:fs'
import { expect, test } from '@playwright/test'

async function stage(page, label) {
  await page.getByRole('button', { name: new RegExp(`^\\W*${label}(\\s+(Blueprint|Validate|Publish))?$`) }).first().click()
}

async function open(page, query = '') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || url.protocol === 'data:' ? route.continue() : route.abort()
  })
  await page.goto(`/e2e/fixtures/${query}`)
  if (query.includes('ai-builder')) return
  if (query.includes('live')) await stage(page, 'Deploy')
  await pickApp(page)
  if (query.includes('live')) await expect(page.getByText('Launch', { exact: true })).toBeVisible()
  else await expect(page.getByRole('button', { name: 'Save blueprint', exact: true }).first()).toBeVisible()
}

async function pickApp(page, name = 'Fixture Assistant') {
  await page.getByRole('button').filter({ has: page.getByText(name, { exact: true }) }).first().click()
}

const fallback = page => page.getByPlaceholder('e.g. Ask for the missing job description before proceeding')

async function expectPdfDownload(page, button, namePart) {
  const [download] = await test.step(`download the ${namePart} report`, () =>
    Promise.all([page.waitForEvent('download', { timeout: 20_000 }), button.click()]))
  expect(download.suggestedFilename()).toMatch(new RegExp(`fixture-assistant-${namePart}-report-\\d{4}-\\d{2}-\\d{2}\\.pdf`))
  const file = await download.path()
  expect(fs.readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-')
}

test('unsaved design edits survive a reload and can be restored', async ({ page }) => {
  await open(page)
  await fallback(page).fill('Keep me after a crash.')
  await page.waitForTimeout(700)                       // the browser copy is written after a short pause
  await page.reload()
  await pickApp(page)
  await expect(page.getByText('Restore your unsaved changes?')).toBeVisible()
  await page.getByRole('button', { name: 'Restore my changes', exact: true }).click()
  await expect(fallback(page)).toHaveValue('Keep me after a crash.')
})

test('discarding the restore offer keeps the saved design and forgets the edits', async ({ page }) => {
  await open(page)
  await fallback(page).fill('Throw this away.')
  await page.waitForTimeout(700)
  await page.reload()
  await pickApp(page)
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(fallback(page)).toHaveValue('Ask for the missing task.')
  await page.reload()
  await pickApp(page)
  await expect(page.getByText('Restore your unsaved changes?')).toHaveCount(0)
})

test('saving clears the browser copy (no restore offer afterwards)', async ({ page }) => {
  await open(page)
  await fallback(page).fill('Saved properly.')
  await page.getByRole('button', { name: 'Save blueprint', exact: true }).first().click()
  await expect(page.getByText('Blueprint saved')).toBeVisible()
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('aistrix_draft:')))).toEqual([])
})

test('publishing shows "Your app is live" with open, copy and embed actions', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Save blueprint', exact: true }).first().click()
  await stage(page, 'Test')
  await pickApp(page)
  await page.getByRole('button', { name: /Run tests$/ }).click()
  await expect(page.getByRole('button', { name: /Run tests again/ })).toBeVisible()
  await page.getByRole('button', { name: /Continue to Deploy/ }).click()
  await page.getByRole('button', { name: /Publish app/ }).click()
  await expect(page.getByText(/Your app is live/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open app ↗', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Copy link/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Embed on website/ })).toBeVisible()
})

test('a developer without an AI key is warned before users run the app', async ({ page }) => {
  await open(page, '?scenario=live-nokey')
  await expect(page.getByText(/No \w+ key: users will run it on their own key or the Aistrix free allowance/)).toBeVisible()
})

test('Design, Test and Deploy each download a PDF report', async ({ page }) => {
  await open(page)
  await expectPdfDownload(page, page.getByRole('button', { name: /PDF report/ }).first(), 'design')

  await page.getByRole('button', { name: 'Save blueprint', exact: true }).first().click()
  await stage(page, 'Test')
  await pickApp(page)
  const testPdf = page.getByRole('button', { name: /PDF report/ }).first()
  await expect(testPdf).toBeDisabled()                 // nothing to report before the tests run
  await page.getByRole('button', { name: /Run tests$/ }).click()
  await expect(page.getByRole('button', { name: /Run tests again/ })).toBeVisible()
  await expectPdfDownload(page, testPdf, 'test')

  await page.getByRole('button', { name: /Continue to Deploy/ }).click()
  await expectPdfDownload(page, page.getByRole('button', { name: /PDF$/ }).first(), 'deploy')
})

test('Build with AI: "Save for Test" saves the app straight into the Test step without publishing', async ({ page }) => {
  await open(page, '?scenario=ai-builder')
  await page.getByPlaceholder(/I want an app that analyzes invoices/).fill('Check invoices for missing fields')
  await page.getByRole('button', { name: /Analyze idea/ }).click()
  await page.getByRole('button', { name: 'Finance team' }).click()
  await page.getByRole('button', { name: /Generate App/ }).click()
  await page.getByRole('button', { name: /Save for Test/ }).click()
  await expect.poll(() => page.evaluate(() => window.buildFixture.tables.apps.some(a => a.name === 'Invoice Checker'))).toBe(true)
  const created = await page.evaluate(() => {
    const app = window.buildFixture.tables.apps.find(a => a.name === 'Invoice Checker')
    const bp = window.buildFixture.tables.app_blueprints.find(b => b.app_id === app.id)
    return { published: app.is_published, phase: bp?.blueprint?.dev_phase }
  })
  expect(created).toEqual({ published: false, phase: 'test' })
  expect(await page.evaluate(() => window.buildFixture.requests.some(r => r.path.endsWith('/promote')))).toBe(false)
  await expect(page.getByText('Testing Invoice Checker')).toBeVisible()
})

test('phones: the stage bar switches tabs and keeps the open tab visible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phone layout only')
  await open(page)
  const bar = page.getByRole('button', { name: '📡 Monitor', exact: true }).filter({ visible: true })
  await bar.scrollIntoViewIfNeeded()
  await bar.click()
  await expect(bar).toHaveAttribute('aria-current', 'page')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
