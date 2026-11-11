import { test, expect } from '@playwright/test'
import { gotoStudio, openWorkflows } from './studio.js'

test.beforeEach(({ isMobile }) => test.skip(isMobile, 'Build editing is a desktop capability.'))

async function openDesign(page) {
  await gotoStudio(page, '/e2e/fixtures/?scenario=shared-row')
  await page.evaluate(() => {
    const fixtureFetch = window.fetch
    window.previewCalls = []
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href)
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
      if (url.pathname.endsWith('/schema')) return json({ input: [], output: [], contract: { execution: { timeout_seconds: 180 }, side_effects: 'external_read', auth: { secrets: ['CRM_KEY'] }, privacy: { model_route: 'external', external_destinations: ['crm.example'] } } })
      if (url.pathname === '/v1/apps/app-1/preview') {
        const version = url.searchParams.get('version')
        return json({ app: { id: 'app-1', name: 'Customer form', app_type: 'native', output_type: 'markdown', ai_provider: 'openai', ai_model: 'gpt-4o',
          form_schema: [{ id: 'task', label: 'Task', type: 'textarea', required: true, placeholder: 'Customer task' }], preview_version: version,
          ...(version === 'live' ? { preview_live_version: 1 } : { preview_draft_hash: 'a'.repeat(20) }) }, version, live_version: 1, is_published: true })
      }
      if (url.pathname === '/v1/apps/app-1' && init.method === 'DELETE') {
        window.buildFixture.tables.apps = window.buildFixture.tables.apps.filter(app => app.id !== 'app-1')
        window.deletedAppRequest = JSON.parse(init.body)
        return json({ ok: true })
      }
      if (url.pathname === '/run') {
        window.previewCalls.push(JSON.parse(init.body))
        return new Response(`data: ${JSON.stringify({ token: 'Saved version preview result.' })}\n\ndata: ${JSON.stringify({ done: true, provider: 'openai', model: 'gpt-4o' })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return fixtureFetch(input, init)
    }
  })
  await page.getByRole('button').filter({ has: page.getByText('Fixture Assistant', { exact: true }) }).first().click()
  await expect(page.getByRole('region', { name: 'Build checklist' })).toBeVisible()
}

test('Build has one checklist and execution declarations persist with the saved blueprint', async ({ page }) => {
  await openDesign(page)
  const checklist = page.getByRole('region', { name: 'Build checklist' })
  await expect(checklist.getByText(/^Next:/)).toBeVisible()
  await expect(checklist.getByRole('button', { name: 'Go to Test', exact: true })).toBeDisabled()
  await expect(page.getByText('Design → Test readiness', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Design Readiness', { exact: true })).toHaveCount(0)
  const permissions = page.getByRole('region', { name: 'Execution permissions' })
  await expect(permissions.getByText('Required secret names: CRM_KEY', { exact: true })).toBeVisible()
  await permissions.getByLabel('Data classification').selectOption('confidential')
  await permissions.getByLabel('External actions').selectOption('external_write')
  await permissions.getByLabel('Execution timeout (seconds)').fill('30')
  await page.getByRole('button', { name: 'Save blueprint', exact: true }).first().click()
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.buildFixture.tables.app_blueprints[0].blueprint.contract)).toEqual({ data_class: 'confidential', side_effects: 'external_write', timeout_seconds: 30 })
})

test('customer preview uses the shared form runner and sends the selected saved-version fingerprint', async ({ page }) => {
  await openDesign(page)
  const preview = page.getByRole('region', { name: 'Customer preview' })
  await preview.getByRole('button', { name: 'Open customer preview' }).click()
  await preview.getByPlaceholder('Customer task').fill('Preview draft input')
  await preview.getByRole('button', { name: '▶ Run App', exact: true }).click()
  await expect(preview.getByText('Saved version preview result.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.previewCalls[0])).toMatchObject({ preview_version: 'draft', preview_draft_hash: 'a'.repeat(20) })
  await preview.getByLabel('Preview version').selectOption('live')
  await preview.getByPlaceholder('Customer task').fill('Preview release input')
  await preview.getByRole('button', { name: '▶ Run App', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.previewCalls.length)).toBe(2)
  expect(await page.evaluate(() => window.previewCalls[1])).toMatchObject({ preview_version: 'live', preview_live_version: 1 })
})

test('an owner can delete an offline app from Developer only after typing its name', async ({ page }) => {
  await openDesign(page)
  await page.getByRole('button', { name: 'Delete app', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete Fixture Assistant?' })
  await expect(dialog.getByRole('button', { name: 'Delete app permanently' })).toBeDisabled()
  await dialog.getByLabel('App name to confirm deletion').fill('Fixture Assistant')
  await dialog.getByRole('button', { name: 'Delete app permanently' }).click()
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => window.deletedAppRequest)).toEqual({ confirm_name: 'Fixture Assistant' })
  await expect(page.locator('aside').getByText('Fixture Assistant', { exact: true })).toHaveCount(0)
})

test('a first-time builder can install a starter, run its sample and inspect captured deliveries', async ({ page }) => {
  await gotoStudio(page, '/e2e/fixtures/?scenario=empty&shell=1')
  await page.evaluate(() => {
    const fixtureFetch = window.fetch
    window.fetch = async (input, init = {}) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname
      const json = body => new Response(JSON.stringify(body))
      if (path === '/v1/reference-workflows') return json({ workflows: [{ key: 'invoice', name: 'Invoice starter', description: 'Process sample invoices.', apps: ['Invoice helper'], steps: ['Invoice helper'], sample_input: 'Sample invoice' }] })
      if (path === '/v1/test-destinations') return json({ destinations: [{ name: 'crm', description: 'Captures test deliveries', url: 'https://fixture.invalid/capture' }], datasets: [] })
      if (path === '/v1/test-deliveries') return json({ deliveries: [{ id: 'delivery', destination: 'crm', method: 'POST', body: '{"sample":true}', created_at: '2026-10-25T12:00:00Z' }] })
      if (path === '/v1/reference-workflows/invoice/install') {
        const app = { id: 'installed-app', name: 'Invoice helper', created_by: 'fixture-user', is_published: false, app_type: 'prompt', ai_provider: 'openai', ai_model: 'gpt-4o', system_prompt: 'Handle invoices.' }
        window.buildFixture.tables.apps.push(app)
        const flow = { id: 'starter-flow', user_id: 'fixture-user', name: 'Invoice starter', kind: 'developer', trigger: { type: 'manual', fields: [] }, steps: [{ id: 's1', app_id: app.id, app_name: app.name, version: 'draft' }], flow_schedules: [{ enabled: true }] }
        window.buildFixture.tables.flows = [flow]
        return json({ flow_id: flow.id, name: flow.name, sample_input: 'Sample invoice' })
      }
      if (path.endsWith('/schema')) return json({ input: [], output: [] })
      if (path === '/v1/flows/starter-flow/runs') return json(init.method === 'POST' ? { id: 'r', status: 'done', steps: [{ index: 0, status: 'ok', name: 'Invoice helper', output: 'Starter result' }] } : { runs: [] })
      return fixtureFetch(input, init)
    }
  })
  await openWorkflows(page)
  await page.getByRole('button', { name: 'Open library', exact: true }).click()
  await page.getByRole('button', { name: 'Install draft workflow', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('Invoice starter')
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Input text')).toHaveValue('Sample invoice')
  await page.getByRole('button', { name: 'Run test', exact: true }).click()
  await expect(page.getByText('Starter result', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open library', exact: true }).click()
  await page.getByText('Captured test deliveries (1)', { exact: true }).click()
  await expect(page.getByText('{"sample":true}', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Workflow name' }).fill('Unsaved invoice changes')
  await page.getByRole('button', { name: 'Install draft workflow', exact: true }).click()
  const guard = page.getByRole('dialog', { name: 'Unsaved workflow changes' })
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('Unsaved invoice changes')
  expect(await page.evaluate(() => window.buildFixture.tables.flows.length)).toBe(1)
})
