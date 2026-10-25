import { test, expect } from '@playwright/test'
import { fixtureSession, fixtureUser } from './auth-fixture.mjs'
import { WORKSPACE_ROUTES } from '../../src/lib/workspaceRoutes.js'

async function signInFixture(context, page) {
  await context.addCookies([{
    name: 'sb-127-auth-token', value: `base64-${Buffer.from(JSON.stringify(fixtureSession)).toString('base64url')}`,
    domain: '127.0.0.1', path: '/', sameSite: 'Lax',
  }])
  await page.addInitScript(() => {
    localStorage.setItem('aistrix_mode', 'business')
    localStorage.setItem('aistrix_welcomed', '1')
    localStorage.setItem('aistrix:app_onboarding_done', '1')
    localStorage.setItem('aistrix_cookie_consent', 'declined')
  })
}

test.beforeEach(async ({ page }) => {
  // These are build/runtime checks, never hosted-service acceptance tests.
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname
    return host === '127.0.0.1' ? route.continue() : route.abort()
  })
})

test('existing deep links load the authentication gate without browser errors', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  for (const path of ['/developer', '/flows', '/app/test-app', '/login?next=/developer']) {
    const response = await page.goto(path)
    expect(response.status()).toBe(200)
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible()
    await expect(page).toHaveURL(/\/login\?next=/)
  }
  expect(errors).toEqual([])
})

test('native sign-in destination overrides an old stored return path', async ({ page, context }) => {
  await signInFixture(context, page)
  await page.addInitScript(() => sessionStorage.setItem('aistrix:postLoginPath', '/reports'))
  await page.goto('/login?next=/settings')
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.locator('[data-workspace-route="settings"]')).toBeVisible()
})

test('root and old bookmarks use native redirects and unknown/private staff pages stay unavailable', async ({ request, context, page }) => {
  const root = await request.get('/', { maxRedirects: 0 })
  expect(root.status()).toBe(307)
  expect(root.headers().location).toBe('/marketplace')
  await signInFixture(context, page)
  const alias = await context.request.get('/workflows?filter=a&filter=b', { maxRedirects: 0 })
  expect(alias.status()).toBe(307)
  expect(alias.headers().location).toBe('/flows?filter=a&filter=b')
  for (const path of ['/not-a-real-page', '/admin', '/moderator']) {
    expect((await context.request.get(path)).status()).toBe(404)
  }
})

test('every business screen and Dev Studio render from their native route', async ({ page, context }) => {
  test.setTimeout(90_000)
  await signInFixture(context, page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  for (const [path, definition] of Object.entries(WORKSPACE_ROUTES)) {
    if (path === '/admin' || path === '/moderator') continue
    const response = await page.goto(path)
    expect(response.status(), path).toBe(200)
    await expect(page.locator(`[data-workspace-route="${definition.screen}"]`), path).toBeVisible()
    await expect(page).toHaveTitle(`${definition.title} | Aistrix`)
    await expect(page.getByText("This page couldn't load", { exact: true })).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('native app parameters, checkout returns, docs and visitor embeds remain connected', async ({ page, context }) => {
  await signInFixture(context, page)
  const id = '00000000-0000-4000-8000-000000000101'
  await page.goto(`/app/${id}?checkout=cancelled`)
  await expect(page.locator('[data-workspace-route="app"]')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/app/${id}$`))
  await expect(page.getByText('Public Invoice Helper', { exact: true }).first()).toBeVisible()
  await page.goto(`/app/${id}/docs`)
  await expect(page.locator('[data-workspace-route="docs"]')).toBeVisible()
  await expect(page.getByText('Public Invoice Helper', { exact: true }).first()).toBeVisible()
  await context.clearCookies()
  const response = await page.goto(`/embed/${id}?theme=light`)
  expect(response.status()).toBe(200)
  await expect(page.locator('[data-workspace-route="embed"]')).toBeVisible()
  await expect(page.getByText('Public Invoice Helper', { exact: true }).first()).toBeVisible()
})

test('native gallery and invite parameters use the authenticated user context', async ({ page, context }) => {
  await signInFixture(context, page)
  await page.goto('/gallery')
  await expect(page.locator('[data-workspace-route="gallery"]')).toBeVisible()
  let payload
  await page.route('**/rest/v1/rpc/accept_workspace_invite', async route => {
    payload = route.request().postDataJSON()
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'This invite is for a different email.' }) })
  })
  await page.goto('/invite/synthetic-invite-token')
  await expect(page.getByText("This invite can't be used", { exact: true })).toBeVisible()
  await expect(page.getByText(/You're signed in as fixture@example.invalid/)).toBeVisible()
  expect(payload.p_token).toBe('synthetic-invite-token')
})

test('private deep links enforce sign-in before JavaScript and preserve callback queries', async ({ request }) => {
  for (const cookie of ['', 'sb-127-auth-token=forged-cookie']) {
    for (const path of ['/developer', '/settings', '/profiles', '/history']) {
    const response = await request.get(`${path}?stripe_connect=success&filter=a&filter=b`, {
      maxRedirects: 0, headers: cookie ? { Cookie: cookie } : {},
    })
    expect(response.status()).toBe(307)
    const location = new URL(response.headers().location, response.url())
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe(`${path}?stripe_connect=success&filter=a&filter=b`)
    }
  }
})

test('verified workspace navigation uses Next transitions and preserves the shared shell', async ({ page, context }) => {
  await signInFixture(context, page)
  const response = await page.goto('/settings')
  expect(response.status()).toBe(200)
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.locator('[data-workspace-route="settings"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page).toHaveTitle('Settings | Aistrix')
  await page.locator('.app-shell').evaluate(node => { node.dataset.testPersistentShell = 'yes' })
  // Route via an existing in-app event, exercising the same guard and handler
  // as sidebar buttons on desktop and mobile.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aistrix:nav', { detail: 'history' })))
  await expect(page).toHaveURL(/\/history$/)
  await expect(page.locator('[data-workspace-route="history"]')).toBeVisible()
  await expect(page).toHaveTitle('Run History | Aistrix')
  await expect(page.locator('.app-shell')).toHaveAttribute('data-test-persistent-shell', 'yes')
  await page.goBack()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.locator('[data-workspace-route="settings"]')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-test-persistent-shell', 'yes')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aistrix:nav', { detail: 'marketplace' })))
  await expect(page.getByRole('heading', { name: 'Aistrix marketplace', exact: true })).toBeVisible()
  // Reaching the native public route proves navigation no longer bypasses Next.
  await expect(page.locator('.app-shell')).toHaveCount(0)
})

test('native profiles retain authenticated form saves and history follows workspace switches', async ({ page, context }) => {
  await signInFixture(context, page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let saved
  await page.route('**/rest/v1/user_career_profiles*', async route => {
    if (route.request().method() === 'POST') saved = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().method() === 'POST' ? null : []) })
  })
  await page.goto('/profiles')
  await expect(page.locator('[data-workspace-route="profiles"]')).toBeVisible()
  await expect(page).toHaveTitle('Shared Profiles | Aistrix')
  await page.getByPlaceholder('Jane Smith').fill('Fixture Name')
  await page.getByRole('button', { name: /Save Career Profile/i }).click()
  await expect(page.getByText('Career profile saved', { exact: true })).toBeVisible()
  expect(saved.user_id).toBe(fixtureUser.id)
  expect(saved.full_name).toBe('Fixture Name')

  const personalId = '00000000-0000-4000-8000-000000000401'
  const teamId = '00000000-0000-4000-8000-000000000402'
  const personalRequest = page.waitForRequest(request => request.url().includes('/rest/v1/run_history') && new URL(request.url()).searchParams.get('workspace_id') === `eq.${personalId}`)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aistrix:nav', { detail: 'history' })))
  expect((await personalRequest).headers()['x-workspace-id']).toBe(personalId)
  await expect(page.locator('[data-workspace-route="history"]')).toBeVisible()
  const teamRequest = page.waitForRequest(request => request.url().includes('/rest/v1/run_history') && new URL(request.url()).searchParams.get('workspace_id') === `eq.${teamId}`)
  if (!await page.getByRole('button', { name: 'Workspace: Fixture workspace', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Workspace: Fixture workspace', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /Fixture team/ }).click()
  const request = await teamRequest
  expect(request.headers()['x-workspace-id']).toBe(teamId)
  expect(new URL(request.url()).searchParams.get('user_id')).toBe(`eq.${fixtureUser.id}`)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aistrix_active_workspace'))).toBe(teamId)
  expect(errors).toEqual([])
})

test('public catalog, app and developer content render without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  const page = await context.newPage()
  for (const [path, heading] of [
    ['/marketplace', 'Aistrix marketplace'],
    ['/marketplace/00000000-0000-4000-8000-000000000101', 'Public Invoice Helper'],
    ['/dev/00000000-0000-4000-8000-000000000201', 'Fixture Developer'],
    ['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Service'],
  ]) {
    const response = await page.goto(`http://127.0.0.1:4175${path}`)
    expect(response.status()).toBe(200)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toHaveCount(1)
    expect(await response.text()).not.toContain('PRIVATE')
  }
  await context.close()
})

test('native catalog keeps discovery and app launch connected', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/marketplace')
  await page.getByRole('button', { name: 'Public Invoice Helper', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Public Invoice Helper', exact: true })).toBeVisible()
  await page.getByRole('link', { name: /Open app/ }).click()
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  expect(errors).toEqual([])
})

test('private, unpublished and invalid public pages return real 404 responses', async ({ request }) => {
  for (const path of ['/marketplace/00000000-0000-4000-8000-000000000102', '/marketplace/00000000-0000-4000-8000-000000000103', '/dev/not-an-id']) {
    const response = await request.get(path)
    expect(response.status()).toBe(404)
    expect(await response.text()).not.toContain('PRIVATE')
  }
})

test('callback failure stays on-site and password reset requires a verified session', async ({ request }) => {
  const callback = await request.get('/auth/callback?next=https://evil.example', { maxRedirects: 0 })
  expect(callback.status()).toBe(307)
  const location = new URL(callback.headers().location, callback.url())
  expect(location.origin).toBe('http://127.0.0.1:4175')
  expect(location.pathname).toBe('/login')
  expect(location.searchParams.get('next')).toBe('/dashboard')
  const reset = await request.get('/reset-password', { maxRedirects: 0 })
  expect(reset.status()).toBe(307)
  expect(reset.headers().location).toContain('/login?error=recovery_required')
})

test('responses presented with session cookies cannot enter a public shared cache', async ({ request }) => {
  const response = await request.get('/privacy', { headers: { Cookie: 'sb-127-auth-token=invalid-cookie' } })
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toContain('no-store')
})

test('legal pages stay public and preserve global styling', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
  await expect(page.locator('body')).toHaveCSS('margin', '0px')
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: /terms/i }).first()).toBeVisible()
})

test('discovery metadata exposes public tools and keeps private routes out', async ({ request }) => {
  const robots = await request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  expect(await robots.text()).toContain('Disallow: /developer')
  const response = await request.get('/sitemap.xml')
  expect(response.status()).toBe(200)
  const xml = await response.text()
  expect(xml).toContain('/marketplace/00000000-0000-4000-8000-000000000101')
  expect(xml).toContain('/dev/00000000-0000-4000-8000-000000000201')
  expect(xml).not.toMatch(/000000000102|000000000103|\/settings|\/admin/)
})
