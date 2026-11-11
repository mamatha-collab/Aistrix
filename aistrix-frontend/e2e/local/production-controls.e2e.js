import { test, expect } from '@playwright/test'
import { gotoStudio, openWorkflows } from './studio.js'

async function installWorkflow(page) {
  await page.goto('/e2e/fixtures/?scenario=business')
  await page.evaluate(() => {
    window.buildFixture.tables.flows = [{ id: 'controls-flow', name: 'Production controls workflow', user_id: 'fixture-user', kind: 'developer', privacy: 'standard', revision: 1,
      trigger: { type: 'manual', fields: [] }, steps: [{ id: 's1', app_id: 'app-1', app_name: 'Original app step', version: 'published', input_map: {} }] }]
    const fixtureFetch = window.fetch
    window.controlCalls = []
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href)
      const path = url.pathname
      const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      if (/\/v1\/apps\/[^/]+\/schema/.test(path)) return response({ input: [], output: [], structured: false, contract: { side_effects: 'none', privacy: { model_route: 'external', output_webhook: false, external_destinations: [] } } })
      if (path.startsWith('/v1/flows/controls-flow/')) {
        const body = init.body ? JSON.parse(init.body) : null
        window.controlCalls.push({ path, search: url.search, body })
        const run = { id: 'run-1', status: 'failed', current_step: 0, trigger: 'schedule', started_at: '2026-10-25T12:00:00Z', needs_review: true, can_continue: true,
          error: 'Delivery interrupted', steps: [{ index: 0, name: 'Original CRM delivery', status: 'failed', error: 'Connection reset after sending', uncertain: true, attempts: 1 }],
          display_steps: [{ id: 's1', app_name: 'Original CRM delivery', step_type: 'api_call' }] }
        if (path.endsWith('/validate')) return response(window.buildFixture.tables.flows[0].privacy === 'standard' ? { ok: true, problems: [], plan_id: 'plan-fixture' }
          : { ok: false, problems: [{ step: 0, text: 'uses an outside AI model; private-only workflows need an approved private model' }] })
        if (path.endsWith('/continue')) {
          if (window.continueConflict) return response({ detail: 'Someone else already continued this run. Reload it.' }, 409)
          if (!body.confirm_repeat) return response({ code: 'confirm_repeat', error: 'CRM delivery may already have written to crm.example. Check there before repeating.', step: 0 }, 409)
          return response({ ...run, status: 'done', needs_review: false, steps: [{ index: 0, name: 'Original CRM delivery', status: 'ok', output: 'Recovered delivery' }] })
        }
        if (path.endsWith('/review')) { window.wasReviewed = true; return response({ ...run, needs_review: false, review_note: body.note }) }
        if (path.endsWith('/runs')) return response({ runs: window.wasReviewed && url.searchParams.get('needs_review') ? [] : [run] })
        if (path.endsWith('/runs/run-1')) return response(run)
        if (path.endsWith('/schedule')) return response({ schedule: null })
      }
      return fixtureFetch(input, init)
    }
  })
}

async function openBusinessRuns(page, isMobile) {
  if (isMobile) await page.getByRole('button', { name: 'Toggle menu' }).click()
  await (isMobile ? page.locator('aside') : page.getByRole('navigation', { name: 'Business sections' })).getByRole('button', { name: 'Workflows', exact: true }).click()
  const card = page.locator('div.group').filter({ has: page.getByText('Production controls workflow', { exact: true }) }).last()
  await card.getByRole('button', { name: /Run workflow/ }).click()
  await page.getByRole('button', { name: 'All runs', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Needs review only' }).check()
  await page.getByRole('region', { name: 'Run history' }).getByRole('button', { name: /Needs review/ }).click()
}

test('private workflow settings save before server validation and problems appear beside the affected step', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Workflow editing is a desktop capability.')
  await installWorkflow(page)
  await page.getByRole('button', { name: 'Developer', exact: true }).click()
  await openWorkflows(page)
  await page.getByLabel('Execution privacy').selectOption('private_only')
  await expect(page.getByText(/There is no fallback to a public AI provider/)).toBeVisible()
  await page.getByText('Model and tool access by step', { exact: true }).click()
  await expect(page.getByText(/External AI model/)).toBeVisible()
  await page.getByRole('button', { name: 'Validate workflow', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Server validation found 1 problem' })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.tables.flows[0].privacy)).toBe('private_only')
  const problem = 'uses an outside AI model; private-only workflows need an approved private model'
  const step = page.getByRole('button').filter({ has: page.getByText('Fixture Assistant', { exact: true }) }).filter({ hasText: problem })
  await expect(step).toBeVisible()
  await step.click()
  await expect(page.getByRole('complementary', { name: 'Step settings' }).getByRole('alert')).toHaveText(problem)
  expect(await page.evaluate(() => window.controlCalls.some(call => call.path.endsWith('/runs') && call.body))).toBe(false)
  await page.getByLabel('Execution privacy').selectOption('standard')
  await expect(page.getByRole('status').filter({ hasText: 'The workflow changed.' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Step settings' }).getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Validate workflow', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Server validation passed' })).toBeVisible()
})

test('uncertain workflow actions require destination acknowledgement before continuing', async ({ page, isMobile }) => {
  await installWorkflow(page)
  await openBusinessRuns(page, isMobile)
  const details = page.getByRole('region', { name: 'Run details' })
  await expect(details.getByText('Original CRM delivery', { exact: true })).toBeVisible()
  await details.getByRole('button', { name: 'Continue run', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'This step may repeat an external action' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Repeat step and continue' })).toBeDisabled()
  expect(await page.evaluate(() => window.controlCalls.filter(call => call.path.endsWith('/continue')).map(call => call.body.confirm_repeat))).toEqual([false])
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Repeat step and continue' }).click()
  await expect(details.getByText('Recovered delivery', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.controlCalls.filter(call => call.path.endsWith('/continue')).map(call => call.body.confirm_repeat))).toEqual([false, true])
})

test('reviewing a run records a note without replaying it and ordinary conflicts never offer a repeat', async ({ page, isMobile }) => {
  await installWorkflow(page)
  await openBusinessRuns(page, isMobile)
  await page.evaluate(() => { window.continueConflict = true })
  const details = page.getByRole('region', { name: 'Run details' })
  await details.getByRole('button', { name: 'Continue run', exact: true }).click()
  await expect(details.getByRole('alert')).toContainText('Someone else already continued')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await details.getByLabel('Review note').fill('Confirmed delivery in the CRM.')
  await details.getByRole('button', { name: 'Mark reviewed without rerunning' }).click()
  await expect(details.getByText('Review note: Confirmed delivery in the CRM.')).toBeVisible()
  expect(await page.evaluate(() => window.controlCalls.filter(call => call.path.endsWith('/continue')).length)).toBe(1)
  await expect(page.getByRole('region', { name: 'Run history' }).getByText('No runs need review.', { exact: true })).toBeVisible()
})

test('spending caps distinguish zero from unlimited and preserve server permission failures', async ({ page }) => {
  await gotoStudio(page, '/e2e/fixtures/?scenario=shared-row')
  await page.evaluate(() => {
    const fixtureFetch = window.fetch
    window.spendWrites = []
    window.fetch = async (input, init = {}) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname
      const scope = { period: 'month', limit_usd: 10, used_usd: 3.5, since: '2026-10-01T00:00:00Z' }
      const response = (body, status = 200) => new Response(JSON.stringify(body), { status })
      if (path === '/v1/spend') return response(window.spendUnavailable ? { detail: 'Spending database unavailable' } : { key: scope, workspace: { id: 'team-1', ...scope } }, window.spendUnavailable ? 503 : 200)
      if (path === '/v1/spend/caps/key') {
        const body = JSON.parse(init.body); window.spendWrites.push(body)
        return response({ key: { ...scope, ...body } })
      }
      if (path === '/v1/workspaces/team-1/spend-cap') return response({ detail: 'Workspace billing permission was removed' }, 404)
      return fixtureFetch(input, init)
    }
  })
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const keys = page.getByRole('form', { name: 'Your AI keys', exact: true })
  await expect(keys.getByText('$6.50', { exact: true })).toBeVisible()
  await keys.getByLabel('Your AI keys limit (USD)').fill('0')
  await keys.getByLabel('Your AI keys period').selectOption('day')
  await keys.getByRole('button', { name: 'Save limit', exact: true }).click()
  await expect(keys.getByRole('status')).toHaveText('Spending limit saved.')
  expect(await page.evaluate(() => window.spendWrites[0])).toEqual({ limit_usd: 0, period: 'day' })
  await keys.getByLabel('Your AI keys limit (USD)').fill('')
  await keys.getByRole('button', { name: 'Save limit', exact: true }).click()
  await expect(keys.getByText('No cap set', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.spendWrites[1].limit_usd)).toBe(null)
  const workspace = page.getByRole('form', { name: 'Active workspace', exact: true })
  await workspace.getByRole('button', { name: 'Save limit', exact: true }).click()
  await expect(workspace.getByRole('status')).toHaveText('Workspace billing permission was removed')
  await page.evaluate(() => { window.spendUnavailable = true })
  await page.getByRole('button', { name: 'Refresh spending', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Spending database unavailable' })).toBeVisible()
  await expect(keys.getByRole('button', { name: 'Save limit', exact: true })).toBeDisabled()
})

test('unverified spending totals never become a zero balance or an editable cap', async ({ page }) => {
  await gotoStudio(page, '/e2e/fixtures/?scenario=shared-row')
  await page.evaluate(() => {
    const fixtureFetch = window.fetch
    window.fetch = (input, init = {}) => new URL(typeof input === 'string' ? input : input.url, location.href).pathname === '/v1/spend'
      ? Promise.resolve(new Response(JSON.stringify({ key: {}, workspace: null }))) : fixtureFetch(input, init)
  })
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Spending totals could not be verified' })).toBeVisible()
  await expect(page.getByRole('form', { name: 'Your AI keys' })).toHaveCount(0)
})
