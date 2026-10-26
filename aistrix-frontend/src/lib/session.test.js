import { beforeEach, describe, expect, it, vi } from 'vitest'

function memoryStorage() {
  const data = new Map()
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear(),
    key: i => [...data.keys()][i] ?? null,
    get length() { return data.size },
    _keys: () => [...data.keys()],
  }
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage()
  globalThis.sessionStorage = memoryStorage()
  // Object.keys(localStorage) must list stored keys, as in browsers.
  globalThis.localStorage = new Proxy(globalThis.localStorage, {
    ownKeys: t => t._keys(), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  })
  vi.resetModules()
})

describe('local drafts', () => {
  it('keeps unsaved edits per editor and app, and clears them', async () => {
    const d = await import('./localDraft')
    d.saveLocalDraft('design', 'a1', { audience: 'ops' }, 'T1')
    d.saveLocalDraft('prompt', 'a1', 'Hello')
    expect(d.readLocalDraft('design', 'a1')).toMatchObject({ value: { audience: 'ops' }, base: 'T1' })
    expect(d.readLocalDraft('prompt', 'a1').value).toBe('Hello')
    d.clearLocalDraft('design', 'a1')
    expect(d.readLocalDraft('design', 'a1')).toBeNull()
    expect(d.readLocalDraft('prompt', 'a1')).not.toBeNull()
  })

  it('forgets drafts older than a week', async () => {
    const d = await import('./localDraft')
    localStorage.setItem('aistrix_draft:design:a1', JSON.stringify({ value: {}, savedAt: Date.now() - 8 * 86400000 }))
    expect(d.readLocalDraft('design', 'a1')).toBeNull()
  })
})

describe('session expiry vs signing out', () => {
  it('signing out on purpose clears drafts and is not reported as expired', async () => {
    const d = await import('./localDraft')
    const s = await import('./session')
    d.saveLocalDraft('design', 'a1', { x: 1 })
    localStorage.setItem('unrelated', 'keep')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co')
    localStorage.setItem('sb-fixture-auth-token', 'old session')
    await s.signOutOnPurpose({ auth: { signOut: async () => s.noteAuthEvent('SIGNED_OUT') } })
    expect(d.readLocalDraft('design', 'a1')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
    expect(localStorage.getItem('sb-fixture-auth-token')).toBeNull()
    expect(s.sessionExpired()).toBe(false)
  })

  it('an unexpected sign-out is an expired session until the next sign-in', async () => {
    const s = await import('./session')
    s.noteAuthEvent('SIGNED_OUT')
    expect(s.sessionExpired()).toBe(true)
    s.noteAuthEvent('SIGNED_IN')
    expect(s.sessionExpired()).toBe(false)
  })
})
