import { describe, expect, it, vi } from 'vitest'
import { hasSessionCookies, migrateBrowserSession, safeReturnPath, sessionStorageKey } from './authPaths'

describe('authentication return paths', () => {
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/login', '/auth/callback?next=/auth/callback', '/ok\nLocation: https://evil.example'])('rejects unsafe or looping return path %s', value => {
    expect(safeReturnPath(value)).toBe('/dashboard')
  })
  it('preserves internal routes, query strings and fragments', () => {
    expect(safeReturnPath('/app/123?checkout=success#result')).toBe('/app/123?checkout=success#result')
    expect(safeReturnPath('/reset-password')).toBe('/reset-password')
  })
  it('recognizes only this project’s session and chunk cookies', () => {
    const url = 'https://fixture.supabase.co'
    expect(sessionStorageKey(url)).toBe('sb-fixture-auth-token')
    expect(hasSessionCookies([{ name: 'sb-fixture-auth-token.0' }], url)).toBe(true)
    expect(hasSessionCookies([{ name: 'sb-fixture-auth-token-code-verifier' }], url)).toBe(false)
    expect(hasSessionCookies([{ name: 'sb-other-auth-token' }], url)).toBe(false)
  })
})

describe('legacy session migration', () => {
  function setup({ existing = null, error = null } = {}) {
    const storage = { getItem: vi.fn(() => JSON.stringify({ access_token: 'access', refresh_token: 'refresh' })), removeItem: vi.fn() }
    const client = { auth: {
      getSession: vi.fn(async () => ({ data: { session: existing } })),
      setSession: vi.fn(async () => ({ data: { session: error ? null : { user: { id: 'fixture' } } }, error })),
    } }
    return { client, storage }
  }
  it('transfers a verified session before removing only its legacy key', async () => {
    const { client, storage } = setup()
    await migrateBrowserSession(client, storage, 'https://fixture.supabase.co')
    expect(client.auth.setSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' })
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith('sb-fixture-auth-token')
  })
  it('keeps legacy state when the exchange fails', async () => {
    const { client, storage } = setup({ error: new Error('Unavailable') })
    await migrateBrowserSession(client, storage, 'https://fixture.supabase.co')
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
  it('keeps the current cookie session and removes a stale legacy copy so it cannot resurrect after sign-out', async () => {
    const { client, storage } = setup({ existing: { user: { id: 'already-signed-in' } } })
    await migrateBrowserSession(client, storage, 'https://fixture.supabase.co')
    expect(client.auth.setSession).not.toHaveBeenCalled()
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith('sb-fixture-auth-token')
  })
  it('ignores malformed storage and does not erase drafts', async () => {
    const { client, storage } = setup()
    storage.getItem.mockReturnValue('{malformed')
    await migrateBrowserSession(client, storage, 'https://fixture.supabase.co')
    expect(client.auth.setSession).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
})
