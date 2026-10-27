import { expect, test } from '@playwright/test'

test.beforeEach(({ isMobile }) => test.skip(isMobile, 'Code editing is a desktop capability.'))

async function create(page, enabled = true) {
  await page.goto('/e2e/fixtures/?scenario=inline-creation')
  await page.evaluate(enabled => {
    const original = window.fetch
    const manifest = { version: 1, runtime: 'python', mode: 'job', entrypoint: 'main:run', timeout_seconds: 30, memory_mb: 256, network: 'none' }
    window.codeFixture = { source: null, tasks: [], deployment: null, capabilities: { enabled, build: enabled, run: enabled },
      starter: { files: { 'main.py': 'def run(payload):\n    return payload\n', 'requirements.txt': '' }, manifest }, calls: [] }
    window.fetch = async (input, init = {}) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname
      const data = window.codeFixture
      const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type':'application/json' } })
      if (path === '/v1/code-apps') {
        const app = { id:'code-app', name:JSON.parse(init.body).name, created_by:'fixture-user', app_type:'code_job', visibility:'private', is_published:false, emoji:'</>' }
        window.buildFixture.tables.apps.push(app)
        return json({ app })
      }
      if (!path.startsWith('/v1/apps/code-app/code')) return original(input, init)
      data.calls.push({ path, method:init.method || 'GET', headers:init.headers, ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) } : {}) })
      if (path.endsWith('/source')) {
        data.source = { ...JSON.parse(init.body), id:'source-1', source_hash:'a'.repeat(64) }
        return json({ source:data.source })
      }
      if (path.endsWith('/builds')) {
        const task = { id:'build-1', source_id:'source-1', kind:'build', status:'succeeded', finished_at:'2026-10-26T12:00:00Z', result:{ image:'registry.invalid/code@sha256:'+'a'.repeat(64) }, logs:'Compilation succeeded' }
        data.tasks.unshift(task)
        return json({ task })
      }
      if (path.endsWith('/deploy')) {
        data.deployment = { build_id:JSON.parse(init.body).build_id, image:'registry.invalid/code@sha256:'+'a'.repeat(64) }
        return json({ deployment:data.deployment })
      }
      if (path.endsWith('/runs')) {
        const task = { id:'run-1', kind:'run', status:'succeeded', elapsed_ms:123, result:{ output:{ total:25 } }, logs:'Processed 1 item' }
        data.tasks.unshift(task)
        return json({ task })
      }
      return json(data)
    }
  }, enabled)
  await page.getByRole('button', { name:'+ App', exact:true }).click()
  await page.locator('[aria-label="App families"]').getByRole('button', { name:'Developer', exact:true }).click()
  await page.getByRole('button').filter({ has:page.getByText('Code Application', { exact:true }) }).click()
  await page.getByRole('textbox', { name:'Application name' }).fill('Inventory optimizer')
  await page.getByRole('button', { name:'Create code application', exact:true }).click()
  await expect(page.getByRole('heading', { name:'Inventory optimizer', exact:true })).toBeVisible()
}

test('a code app saves, builds, deploys and runs through its own workspace', async ({ page }) => {
  await create(page)
  await expect(page.getByRole('region', { name:'Build checklist' })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Build saved version' })).toBeDisabled()
  await page.getByRole('button', { name:'Save source version' }).click()
  // A background response about another source version must not change the editor's build target.
  await page.evaluate(() => { window.codeFixture.source = { ...window.codeFixture.source, id:'background-source' } })
  await page.getByRole('button', { name:'Refresh jobs', exact:true }).click()
  await page.getByRole('button', { name:'Build saved version' }).click()
  await page.getByRole('button', { name:'Deploy build', exact:true }).click()
  await expect(page.getByRole('button', { name:'Run job', exact:true })).toBeDisabled()
  await page.getByRole('dialog', { name:'Deploy this build?' }).getByRole('button', { name:'Deploy privately' }).click()
  await page.getByRole('button', { name:'Run job', exact:true }).click()
  await page.getByText(/^Run run-1/).click()
  await expect(page.getByText('Processed 1 item', { exact:true })).toBeVisible()
  await expect(page.getByText(/"total": 25/)).toBeVisible()
  expect(await page.evaluate(() => window.codeFixture.calls.find(call => call.path.endsWith('/deploy')).body)).toEqual({ build_id:'build-1', expected_build_id:null })
  expect(await page.evaluate(() => window.codeFixture.calls.find(call => call.path.endsWith('/builds')).body)).toEqual({ source_id:'source-1' })
  expect(await page.evaluate(() => window.codeFixture.calls.find(call => call.path.endsWith('/runs')).headers['X-Code-Build-ID'])).toBe('build-1')
})

test('unavailable workers disable hosting actions and unsaved source has a navigation guard', async ({ page }) => {
  await create(page, false)
  await expect(page.getByText(/An operator must configure isolated workers/)).toBeVisible()
  await page.getByRole('button', { name:'Save source version' }).click()
  await expect(page.getByRole('button', { name:'Build saved version' })).toBeDisabled()
  await page.getByRole('textbox', { name:'Source main.py', exact:true }).fill('def run(payload):\n    return {"changed": True}\n')
  await page.locator('button[title="Test: Validate"]').click()
  const dialog = page.getByRole('dialog', { name:'Unsaved code changes' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name:'Cancel', exact:true }).click()
  await expect(page.getByRole('textbox', { name:'Source main.py', exact:true })).toHaveValue(/changed/)
  expect(await page.evaluate(() => window.codeFixture.calls.some(call => /\/(builds|runs)$/.test(call.path)))).toBe(false)
})
