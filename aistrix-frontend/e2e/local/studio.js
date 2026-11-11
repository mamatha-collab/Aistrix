import { expect } from '@playwright/test'

// Dev Studio opens on the capability chooser. Tests of the app lifecycle
// enter it the way a developer does: Open AI Apps → Manage AI apps, which
// lands on Design (the start view before the chooser existed). Phones keep
// their own monitoring workspace, so phone-sized pages are left as loaded.
export async function enterStudio(page) {
  if ((page.viewportSize()?.width ?? 1440) < 768) return
  // Links that name a step or setting (?phase2=, ?github_connected=, ...)
  // open it directly; only the chooser needs entering.
  const chooser = page.getByRole('button', { name: /^Open AI Apps/ })
  const direct = page.locator('button[title="Design: Blueprint"]').or(page.getByTestId('developer-settings'))
  await expect(chooser.or(direct).first()).toBeVisible()
  if (!await chooser.isVisible()) return
  await chooser.click()
  await page.getByRole('button', { name: /^Manage AI apps/ }).click()
  await expect(page.getByRole('button', { name: /^\W*Design(\s+Blueprint)?$/ }).first()).toBeVisible()
}

export async function gotoStudio(page, url) {
  await page.goto(url)
  await enterStudio(page)
}

// Workflows moved off the app stage row into the Workflows capability.
export async function openWorkflows(page) {
  const back = page.getByRole('button', { name: /Back to workspace/ })
  if (await back.count()) await back.click()
  await page.getByRole('button', { name: /^Workflows/ }).first().click()
  await page.getByRole('button', { name: /^Open workflow designer/ }).click()
}

// "Create" in the Developer header opens the capability chooser; AI Apps
// lists the application types and creation methods, each opening its builder.
export async function openCreate(page, type) {
  await page.getByRole('button', { name: 'Create a resource', exact: true }).click()
  await page.getByRole('button', { name: /^Open AI Apps/ }).click()
  await expect(page.getByRole('region', { name: 'AI app types' })).toBeVisible()
  if (type) await page.getByRole('button').filter({ has: page.getByText(type, { exact: true }) }).first().click()
}
