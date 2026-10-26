import { test, expect } from '@playwright/test'

test('Operate & Grow releases diff editors safely across repeated Strict Mode navigation', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The comparison editor is a desktop capability.')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    // Exercise React lifecycle/real section navigation without loading a CDN.
    // Like Monaco, this mock rejects disposal of a still-attached text model.
    const models = new Set()
    const editors = new Set()
    const stats = window.diffLifecycle = { created: 0, disposed: 0, liveModels: 0 }
    window.monaco = {
      editor: {
        createModel(value) {
          const model = {
            value, disposed: false,
            getValue() { return this.value },
            setValue(next) { this.value = next },
            isDisposed() { return this.disposed },
            dispose() {
              for (const editor of editors) {
                if (editor.models?.original === this || editor.models?.modified === this) {
                  throw new Error('TextModel got disposed before DiffEditorWidget model got reset')
                }
              }
              if (this.disposed) throw new Error('Model disposed twice')
              this.disposed = true
              models.delete(this)
              stats.liveModels = models.size
            },
          }
          models.add(model)
          stats.liveModels = models.size
          return model
        },
        createDiffEditor() {
          const editor = {
            models: null,
            setModel(next) { this.models = next },
            getModel() { return this.models },
            updateOptions() {},
            dispose() {
              if (this.models) throw new Error('Diff editor must detach its models first')
              editors.delete(this)
              stats.disposed++
            },
          }
          stats.created++
          editors.add(editor)
          return editor
        },
        setTheme() {},
        setModelLanguage() {},
      },
    }
  })
  await page.goto('/e2e/fixtures/?scenario=operations&strict=1')
  for (let i = 0; i < 5; i++) {
    await page.locator('button[title="Improve: Iterate"]').filter({ visible: true }).click()
    await expect(page.getByRole('region', { name: 'Prompt comparison' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.diffLifecycle.liveModels)).toBe(2)
    // A prop update must preserve the active models rather than replacing them.
    const created = await page.evaluate(() => window.diffLifecycle.created)
    await page.getByLabel('Candidate system prompt').fill(`Comparison candidate ${i}`)
    expect(await page.evaluate(() => window.diffLifecycle.created)).toBe(created)
    page.once('dialog', dialog => dialog.accept())
    await page.locator('button[title="Monitor: Usage"]').filter({ visible: true }).click()
    await expect(page.getByRole('region', { name: 'Prompt comparison' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.diffLifecycle.liveModels)).toBe(0)
    const stats = await page.evaluate(() => window.diffLifecycle)
    expect(stats.disposed).toBe(stats.created)
  }
  expect(errors).toEqual([])
})
