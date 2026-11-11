import { test, expect } from '@playwright/test'
import { fixtureSession } from './auth-fixture.mjs'

async function openStudio(page, context) {
  await context.addCookies([{ name: 'sb-127-auth-token', value: `base64-${Buffer.from(JSON.stringify(fixtureSession)).toString('base64url')}`, domain: '127.0.0.1', path: '/', sameSite: 'Lax' }])
  await page.addInitScript(() => {
    localStorage.setItem('aistrix_mode', 'developer')
    localStorage.setItem('aistrix_welcomed', '1')
    localStorage.setItem('aistrix:app_onboarding_done', '1')
    localStorage.setItem('aistrix_cookie_consent', 'declined')
  })
  await page.goto('/developer')
  await page.getByRole('region', { name: 'AI development capabilities' }).getByRole('button', { name: /^Evaluations/ }).click()
  await page.getByRole('button', { name: 'Open Evaluations', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Evaluations', exact: true })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
})

test('evaluation authoring, failed and passing runs, comparison, and immutable suite editing', async ({ page, context }, testInfo) => {
  test.setTimeout(60_000)
  const app = { key: 'Application/team/invoice', kind: 'Application', namespace: 'team', name: 'invoice' }
  const suiteResource = { key: 'EvalSuite/default/invoice-tests', kind: 'EvalSuite', namespace: 'default', name: 'invoice-tests' }
  const release = { id: 'app-release-1', ref: `${app.key}@1.0.0`, version: '1.0.0', content_hash: 'pinned-app-hash', workloads: ['extract'] }
  const suiteRef = `${suiteResource.key}@1.0.0`
  const published = new Map()
  const history = []
  let releaseRequests = 0
  await page.route('**/v1/platform/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    let body
    if (path.endsWith('/resources')) body = { resources: [app, ...(published.size ? [suiteResource] : [])] }
    else if (path.endsWith('/resources/Application/team/invoice')) body = { resource: app, releases: [release] }
    else if (path.endsWith('/resources/EvalSuite/default/invoice-tests')) body = { resource: suiteResource, releases: [...published.values()].map(value => value.release) }
    else if (path.endsWith('/releases/app-release-1/evals')) body = { results: [...history].reverse() }
    else if (path.endsWith('/releases/app-release-1')) body = {
      release, spec: { kind: 'Application', tests: [suiteRef] }, evaluation: { workloads: [{ name: 'extract', external_steps: ['post'] }] },
      gate: { eligible: history.at(-1)?.passed || false, checks: [{ suite: suiteRef, status: history.length ? history.at(-1).passed ? 'passed' : 'failed' : 'missing', pass_rate: history.at(-1)?.pass_rate ?? null, required: 1 }] },
    }
    else if (path.endsWith('/specs/validate')) body = { valid: true, problems: [] }
    else if (path.endsWith('/releases') && method === 'POST') {
      releaseRequests++
      const doc = route.request().postDataJSON().spec
      const version = doc.metadata.version
      if (published.has(version)) return route.fulfill({ status: 409, json: { detail: 'This version is immutable. Raise metadata.version.' } })
      expect(doc.spec.target).toEqual({ ref: release.ref, workload: 'extract' })
      expect(doc.spec.mocks).toEqual({ post: { status: 201 } })
      const item = { release: { id: `suite-${version}`, ref: `${suiteResource.key}@${version}`, version }, spec: doc }
      published.set(version, item); body = { release: item.release }
    }
    else if (path.endsWith('/evals') && method === 'POST') {
      expect(route.request().postDataJSON().suite).toBe(suiteRef)
      const passed = history.length > 0
      const result = { id: `result-${history.length + 1}`, release_id: release.id, suite: suiteRef, passed, pass_rate: passed ? 1 : 0, required: 1, cost_usd: 0.02, created_at: '2026-10-27T12:00:00Z', cases: [{ name: 'Case 1', passed, failures: passed ? [] : ['vendor is WRONG, expected ACME'], run_id: 'case-run-1' }] }
      history.push(result); body = { result }
    }
    else if (path.endsWith('/runs/case-run-1/events')) body = { events: [{ seq: 1, type: 'node.finished' }] }
    else if (path.endsWith('/runs/case-run-1')) body = { run: { status: 'succeeded', output: { vendor: 'WRONG' }, cost_usd: 0.02, steps: { extract: { status: 'succeeded' } } } }
    else if (path.includes('/releases/suite-')) body = published.get(path.split('/suite-')[1])
    else return route.fulfill({ status: 404, json: { detail: `Unknown fixture ${path}` } })
    return route.fulfill({ json: body })
  })
  await openStudio(page, context)
  await page.getByLabel('Application', { exact: true }).selectOption(app.key)
  await page.getByLabel('Application release', { exact: true }).selectOption(release.id)
  await page.getByLabel('Workload', { exact: true }).selectOption('extract')
  await expect(page.getByText('Production blocked by required evaluations')).toBeVisible()
  await page.getByLabel('Suite name', { exact: true }).fill('invoice-tests')
  await page.getByLabel('Case 1 input (JSON object)', { exact: true }).fill('{"invoice_id":"test-1"}')
  await page.getByLabel('Case 1 check 1 type', { exact: true }).selectOption('equals')
  await page.getByLabel('Case 1 check 1 output path', { exact: true }).fill('vendor')
  await page.getByLabel('Case 1 check 1 expected value (JSON)', { exact: true }).fill('"ACME"')
  await page.getByRole('button', { name: 'Validate and release suite', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Evaluation Studio', exact: true }).getByRole('alert')).toContainText('Provide test replacements for external steps: post')
  expect(releaseRequests).toBe(0)
  await page.getByLabel('External step replacements', { exact: false }).fill('{"post":{"status":201}}')
  await page.getByRole('button', { name: 'Validate and release suite', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Evaluation Studio', exact: true }).getByRole('status')).toContainText(`Released ${suiteRef}`)
  await page.getByRole('button', { name: 'Run released suite', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Evaluation failed', exact: true })).toBeVisible()
  await expect(page.getByText('vendor is WRONG, expected ACME')).toBeVisible()
  await page.getByRole('button', { name: 'Inspect case 1 execution', exact: true }).click()
  await page.getByText('Output, errors, and step traces', { exact: true }).click()
  await expect(page.getByText('node.finished', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Use as comparison baseline' }).click()
  await page.getByRole('button', { name: 'Run released suite', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Evaluation passed', exact: true })).toBeVisible()
  await expect(page.getByText('Required evaluations passed', { exact: true })).toBeVisible()
  await expect(page.getByRole('table')).toContainText('100%')
  await page.screenshot({ path: `test-results/evaluations-${testInfo.project.name}.png`, fullPage: true })
  await page.getByLabel('Existing suite', { exact: true }).selectOption(suiteResource.key)
  await page.getByLabel('Suite release', { exact: true }).selectOption('suite-1.0.0')
  await page.getByRole('button', { name: 'Load released suite', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Evaluation Studio', exact: true }).getByRole('status')).toContainText('Loaded immutable suite')
  await expect(page.getByLabel('Case 1 check 1 expected value (JSON)', { exact: true })).toHaveValue('"ACME"')
  await page.getByLabel('Case 1 name', { exact: true }).fill('Edited case')
  await expect(page.getByRole('button', { name: 'Run released suite', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Validate and release suite', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Evaluation Studio', exact: true }).getByRole('alert')).toContainText('immutable')
  await page.getByLabel('Suite version', { exact: true }).fill('1.0.1')
  await page.getByRole('button', { name: 'Validate and release suite', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Evaluation Studio', exact: true }).getByRole('status')).toContainText('@1.0.1')
  await page.getByLabel('Suite name', { exact: true }).fill('Unsaved suite')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Evaluations', exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible()
})

test('evaluation resource failures offer retry and empty projects explain the prerequisite', async ({ page, context }) => {
  let fail = true
  await page.route('**/v1/platform/resources', route => route.fulfill(fail ? { status: 503, json: { detail: 'Evaluation storage unavailable' } } : { json: { resources: [] } }))
  await openStudio(page, context)
  await expect(page.getByRole('region', { name: 'Evaluation Studio', exact: true }).getByRole('alert')).toContainText('Evaluation storage unavailable')
  fail = false
  await page.getByRole('button', { name: 'Refresh results', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Release an application first' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Evaluation Studio', exact: true }).getByRole('alert')).toHaveCount(0)
})
