import { test, expect } from '@playwright/test'
import { fixtureSession, fixtureUser } from './auth-fixture.mjs'

const appId = '00000000-0000-4000-8000-000000005001'
const manifest = { version: 1, runtime: 'python', mode: 'job', entrypoint: 'main:run', network: 'none', memory_mb: 256, timeout_seconds: 30 }
const initial = { 'main.py': 'def run(payload):\n    return {}\n', 'requirements.txt': '', 'schemas.json': '{"input":{"type":"object"},"output":{}}', 'tests.json': '[{"name":"Example","input":{},"expected":null}]' }
async function setup(page, context, { workers = true } = {}) {
  await context.addCookies([{ name: 'sb-127-auth-token', value: `base64-${Buffer.from(JSON.stringify(fixtureSession)).toString('base64url')}`, domain: '127.0.0.1', path: '/', sameSite: 'Lax' }])
  await page.addInitScript(() => {
    localStorage.setItem('aistrix_mode', 'developer')
    localStorage.setItem('aistrix_welcomed', '1')
    localStorage.setItem('aistrix:app_onboarding_done', '1')
    localStorage.setItem('aistrix_cookie_consent', 'declined')
  })
  const state = { revision: 0, source: { id: null, files: initial, manifest, source_hash: 'initial' }, history: [], tasks: [], deployment: null, requests: [] }
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1') return route.abort()
    const path = url.pathname
    if (path === '/v1/code-apps') return route.fulfill({ json: { app: { id: appId, name: route.request().postDataJSON().name, app_type: 'code_job', created_by: fixtureUser.id, visibility: 'private', is_published: false, emoji: '</>' } } })
    if (!path.startsWith(`/v1/apps/${appId}/code`)) return route.continue()
    const body = route.request().postData() ? route.request().postDataJSON() : null
    state.requests.push({ path, method: route.request().method(), body, headers: route.request().headers() })
    if (path.endsWith('/studio')) return route.fulfill({ json: { draft: { revision: state.revision, source: state.source }, history: state.history } })
    if (path.endsWith('/studio/proposals')) {
      expect(typeof body.files['main.py']).toBe('string')
      expect(body.manifest.network).toBe('none')
      const code = 'def run(payload):\n    amount = payload["amount"]\n    discount = payload.get("discount", 0)\n    subtotal = amount - discount\n    tax = subtotal * payload["rate"] / 100\n    return {"tax": round(tax, 2), "total": round(subtotal + tax, 2)}\n' + (body.files['main.py'].includes('# custom rounding') ? '# custom rounding\n' : '')
      const files = { ...body.files, 'main.py': code, 'schemas.json': JSON.stringify({ input: { type: 'object', required: ['amount', 'rate'], properties: { amount: { type: 'number' }, discount: { type: 'number' }, rate: { type: 'number' } } }, output: { type: 'object' } }), 'tests.json': JSON.stringify([{ name: 'Discount before tax', input: { amount: 100, discount: 10, rate: 7 }, expected: { tax: 6.3, total: 96.3 } }]) }
      return route.fulfill({ json: { proposal: { base_revision: body.revision, base_hash: 'base', files, manifest: body.manifest, summary: 'Calculate tax after an optional discount and preserve custom rounding.', changes: Object.keys(files).filter(name => files[name] !== body.files[name]).map(path => ({ path, before_sha256: 'fixture', content: files[path] })) }, usage: { provider: 'claude', model: 'fixture', cost_usd: 0.001 } } })
    }
    if (path.endsWith('/studio/draft')) {
      if (body.revision !== state.revision) return route.fulfill({ status: 409, json: { detail: 'Draft revision changed' } })
      state.revision++
      state.source = { id: `source-${state.revision}`, source_hash: `hash-${state.revision}`, files: body.files, manifest: body.manifest }
      state.history.unshift({ revision: state.revision, source_id: state.source.id, source: state.source, created_at: '2026-10-27T12:00:00Z' })
      return route.fulfill({ json: { draft: { revision: state.revision, source_id: state.source.id, source: state.source } } })
    }
    if (path.endsWith('/builds')) {
      const task = { id: `build-${state.revision}`, kind: 'build', source_id: body.source_id, status: 'succeeded', finished_at: '2026-10-27T12:00:00Z', result: { image: 'registry.invalid/code@sha256:fixture' } }
      state.tasks.unshift(task)
      return route.fulfill({ json: { task } })
    }
    if (path.endsWith('/preview')) {
      expect(state.deployment).toBeNull()
      const task = { id: `run-${state.requests.length}`, kind: 'run', source_id: state.source.id, status: 'succeeded', result: { output: { tax: 6.3, total: 96.3 } }, logs: 'Validated sales tax input' }
      state.tasks.unshift(task)
      return route.fulfill({ json: { task } })
    }
    if (path.endsWith('/runs')) {
      expect(route.request().headers()['x-code-build-id']).toBe(state.deployment.build_id)
      const active = state.tasks.find(task => task.id === state.deployment.build_id)
      const task = { id: 'deployed-run', kind: 'run', source_id: active.source_id, status: 'succeeded', result: { output: { tax: 6.3, total: 96.3 } } }
      state.tasks.unshift(task)
      return route.fulfill({ json: { task } })
    }
    if (path.endsWith('/deploy')) { state.deployment = { build_id: body.build_id }; return route.fulfill({ json: { deployment: state.deployment } }) }
    return route.fulfill({ json: { source: state.source, tasks: state.tasks, builds: state.tasks.filter(task => task.kind === 'build'), deployment: state.deployment, capabilities: { enabled: workers, build: workers, run: workers } } })
  })
  await page.goto('/developer')
  await page.getByRole('region', { name: 'AI development capabilities' }).getByRole('button', { name: /^Code & Tools/ }).click()
  await page.getByRole('button', { name: 'Create Python resource with AI', exact: true }).click()
  await page.getByRole('textbox', { name: 'Application name', exact: true }).fill('Sales Tax Node')
  await page.getByRole('button', { name: 'Create code application', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sales Tax Node', exact: true })).toBeVisible()
  await expect(page.getByText('Draft revision 0', { exact: true })).toBeVisible()
  return state
}
async function panel(page, testInfo, name) {
  if (testInfo.project.name === 'mobile') await page.getByRole('navigation', { name: 'Studio panels' }).getByRole('button', { name, exact: true }).click()
}
test('prompt-to-code preserves manual changes, previews a saved build, and deploys explicitly', async ({ page, context }, testInfo) => {
  test.setTimeout(60_000)
  const state = await setup(page, context)
  const studio = page.getByRole('region', { name: 'Prompt-to-code Studio', exact: true })
  await page.getByRole('textbox', { name: 'Development instruction', exact: true }).fill('Create a tax calculator with optional discount')
  await page.getByRole('button', { name: 'Propose code changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Accept changes', exact: true })).toBeEnabled()
  expect(state.revision).toBe(0)
  expect(state.tasks).toHaveLength(0)
  await panel(page, testInfo, 'code')
  await page.getByRole('textbox', { name: 'Source main.py', exact: true }).fill(initial['main.py'] + '# custom rounding\n')
  await panel(page, testInfo, 'prompt')
  await expect(page.getByRole('button', { name: 'Accept changes', exact: true })).toBeDisabled()
  await expect(page.getByText('Your files have changed. This proposal cannot overwrite them.')).toBeVisible()
  await page.getByRole('button', { name: 'Discard proposal', exact: true }).click()
  await page.getByRole('textbox', { name: 'Development instruction', exact: true }).fill('Add discount, preserve my custom rounding')
  await page.getByRole('button', { name: 'Propose code changes', exact: true }).click()
  const generation = state.requests.filter(request => request.path.endsWith('/proposals')).at(-1)
  expect(generation.body.files['main.py']).toContain('# custom rounding')
  await page.getByRole('button', { name: 'Accept changes', exact: true }).click()
  await expect(page.getByText('Draft revision 1', { exact: true })).toBeVisible()
  await panel(page, testInfo, 'code')
  await expect(page.getByRole('textbox', { name: 'Source main.py', exact: true })).toHaveValue(/custom rounding/)
  await page.getByRole('button', { name: 'Build saved version', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Build cached for this source', exact: true })).toBeDisabled()
  await panel(page, testInfo, 'preview')
  await page.getByRole('combobox', { name: 'Preview test case', exact: true }).selectOption('0')
  await expect(page.getByRole('spinbutton', { name: 'Preview amount', exact: true })).toHaveValue('100')
  await page.getByRole('button', { name: 'Run sandbox preview', exact: true }).click()
  await expect(studio.getByText('Test passed', { exact: true })).toBeVisible()
  await expect(studio.getByText('Validated sales tax input', { exact: true })).toBeVisible()
  expect(state.deployment).toBeNull()
  await page.screenshot({ path: `test-results/prompt-code-${testInfo.project.name}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Deploy build', exact: true }).click()
  await page.getByRole('dialog', { name: 'Deploy this build?', exact: true }).getByRole('button', { name: 'Deploy privately', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Active', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Run deployed version', exact: true }).click()
  await expect(page.getByText('Deployed version run', { exact: true })).toBeVisible()
  await panel(page, testInfo, 'code')
  await page.getByRole('button', { name: 'Revert last accepted change', exact: true }).click()
  await page.getByRole('dialog', { name: 'Revert last accepted change?', exact: true }).getByRole('button', { name: 'Revert as new revision', exact: true }).click()
  await expect(page.getByText('Draft revision 2', { exact: true })).toBeVisible()
  await page.getByText('Revision history', { exact: true }).click()
  await page.getByRole('button', { name: 'Restore revision 1', exact: true }).click()
  await page.getByRole('dialog', { name: 'Restore revision 1?', exact: true }).getByRole('button', { name: 'Restore as new revision', exact: true }).click()
  await expect(page.getByText('Draft revision 3', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Source main.py', exact: true }).fill(state.source.files['main.py'] + '# unsaved\n')
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Unsaved Studio changes', exact: true })).toBeVisible()
  await page.getByRole('dialog', { name: 'Unsaved Studio changes', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(state.requests.some(request => request.path.endsWith('/source'))).toBe(false)
})
test('unavailable workers and concurrent source changes do not fabricate preview output or overwrite edits', async ({ page, context }, testInfo) => {
  const state = await setup(page, context, { workers: false })
  await expect(page.getByText(/Isolated workers are unavailable/)).toBeVisible()
  await panel(page, testInfo, 'code')
  await page.getByRole('button', { name: 'Save draft revision', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Build saved version', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Source main.py', exact: true }).fill(initial['main.py'] + '# local change\n')
  state.revision++
  await page.getByRole('button', { name: 'Save draft revision', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Prompt-to-code Studio', exact: true }).getByRole('alert')).toContainText('local files have been kept')
  await expect(page.getByRole('textbox', { name: 'Source main.py', exact: true })).toHaveValue(/local change/)
  await panel(page, testInfo, 'preview')
  await expect(page.getByRole('button', { name: 'Run sandbox preview', exact: true })).toBeDisabled()
  await expect(page.getByRole('region', { name: 'Preview result' })).toHaveCount(0)
})
