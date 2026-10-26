import { test, expect } from '@playwright/test'

test('Developer and Business use the same wired workflow record and runtime', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Developer workflow editing is a desktop capability')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/e2e/fixtures/?scenario=business')
  await page.evaluate(() => {
    const fixtureFetch = window.fetch
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href)
      if (url.pathname === '/v1/flows/shared-flow/runs') {
        if (init.method === 'POST') {
          window.buildFixture.lastWorkflowRun = JSON.parse(init.body)
          return new Response(JSON.stringify({ id: 'run-1', status: 'done', steps: [{ index: 0, name: 'Fixture Assistant', status: 'ok', output: 'Shared result' }], trigger: 'interactive' }), { status: 200 })
        }
        return new Response(JSON.stringify({ runs: [] }), { status: 200 })
      }
      return fixtureFetch(input, init)
    }
    window.buildFixture.tables.flows = [
      { id: 'shared-flow', user_id: 'fixture-user', name: 'Shared invoice workflow', kind: 'developer', emoji: '🔀', trigger: { type: 'manual', fields: [] }, steps: [{ id: 's1', app_id: 'app-1', app_name: 'Fixture Assistant', version: 'published' }] },
      { id: 'legacy-flow', user_id: 'fixture-user', name: 'Existing memory workflow', kind: 'business', emoji: '🔗', steps: [{ app_id: 'app-1', app_name: 'Fixture Assistant' }] },
    ]
  })
  const businessNav = page.getByRole('navigation', { name: 'Business sections' })
  await businessNav.getByRole('button', { name: 'Workflows', exact: true }).click()
  await expect(page.getByRole('paragraph').filter({ hasText: /^Shared invoice workflow$/ })).toBeVisible()
  await expect(page.getByRole('paragraph').filter({ hasText: /^Existing memory workflow$/ })).toBeVisible()
  const card = page.locator('div.group').filter({ has: page.getByText('Shared invoice workflow', { exact: true }) }).last()
  await card.getByRole('button', { name: /Run workflow/ }).click()
  // Runs as a page in the workspace, not a window over it.
  await expect(page.getByRole('heading', { name: 'Shared invoice workflow', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await page.getByRole('region', { name: 'Start the workflow' }).getByRole('button', { name: 'Run workflow', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Results' }).getByText('Shared result', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.buildFixture.lastWorkflowRun)).toEqual({ input: '', live: true })
  await page.getByRole('button', { name: 'Back to Workflows' }).click()
  await card.hover()
  await card.getByRole('button', { name: 'Edit', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Edit workflow' })
  await editor.getByRole('textbox', { name: 'Workflow name' }).fill('Updated shared workflow')
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(editor.getByRole('status')).toHaveText('Saved')
  await editor.getByRole('button', { name: 'Close workflow editor' }).click()
  expect(await page.evaluate(() => window.buildFixture.tables.flows.find(f => f.id === 'shared-flow').name)).toBe('Updated shared workflow')
  await page.getByRole('button', { name: 'Developer', exact: true }).click()
  await page.getByRole('button', { name: /Workflows.*Connect apps/ }).click()
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('Updated shared workflow')
  expect(errors).toEqual([])
})
