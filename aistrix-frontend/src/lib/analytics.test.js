import { beforeEach, describe, expect, it, vi } from 'vitest'

// Analytics never load or send anything before the visitor accepts cookies.
const posthog = { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn() }
vi.mock('posthog-js', () => ({ default: posthog }))

function fakeBrowser() {
  const store = new Map()
  vi.stubGlobal('localStorage', { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  vi.stubGlobal('Event', class { constructor(type) { this.type = type } })
}

async function load() {
  vi.resetModules()
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
  return import('./analytics')
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('cookie consent gates analytics', () => {
  beforeEach(() => { vi.clearAllMocks(); fakeBrowser() })

  it('loads nothing and sends nothing before a choice', async () => {
    const a = await load()
    a.track('app_run_started')
    await settle()
    expect(a.analyticsConfigured).toBe(true)
    expect(a.consentChoice()).toBeNull()
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('declining keeps analytics off', async () => {
    const a = await load()
    a.setConsent('declined')
    a.track('app_run_started')
    await settle()
    expect(posthog.init).not.toHaveBeenCalled()
    expect(a.consentChoice()).toBe('declined')
  })

  it('accepting starts analytics, and is remembered on the next visit', async () => {
    const a = await load()
    a.setConsent('accepted')
    await settle()
    expect(posthog.init).toHaveBeenCalledTimes(1)
    expect(posthog.init.mock.calls[0][1]).toMatchObject({ autocapture: false })
    vi.clearAllMocks()
    await load()                     // a later page load: starts straight away
    await settle()
    expect(posthog.init).toHaveBeenCalledTimes(1)
  })

  it('withdrawing consent stops sending and forgets the visitor', async () => {
    const a = await load()
    a.setConsent('accepted')
    await settle()
    a.setConsent('declined')
    expect(posthog.opt_out_capturing).toHaveBeenCalled()
    expect(posthog.reset).toHaveBeenCalled()
  })

  it('the Privacy Policy can reopen the choice', async () => {
    const a = await load()
    a.setConsent('declined')
    a.reopenConsent()
    expect(a.consentChoice()).toBeNull()
    expect(window.dispatchEvent).toHaveBeenCalled()
  })
})

describe('the cookie notice', () => {
  beforeEach(() => { vi.clearAllMocks(); fakeBrowser() })

  it('asks with Accept and Decline and links the Privacy Policy, until a choice is made', async () => {
    await load()
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { MemoryRouter } = await import('react-router-dom')
    const { default: CookieConsent } = await import('../components/CookieConsent.jsx')
    const html = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CookieConsent)))
    expect(html()).toContain('aria-label="Cookie choice"')
    expect(html()).toContain('>Accept</button>')
    expect(html()).toContain('>Decline</button>')
    expect(html()).toContain('href="/privacy"')
    localStorage.setItem('aistrix_cookie_consent', 'declined')
    expect(html()).toBe('')
  })
})
