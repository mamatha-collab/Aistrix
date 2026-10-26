import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn(), role: vi.fn(), exchangeCodeForSession: vi.fn(), cookies: null }))
vi.mock('@supabase/ssr', () => ({ createServerClient: (_url, _key, options) => {
  auth.cookies = options.cookies
  const query = { select() { return this }, eq() { return this }, maybeSingle: auth.role }
  return { auth, from: () => query }
} }))
import { proxy } from '../proxy'
import { GET } from '../app/auth/callback/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture-public-key')
  auth.getClaims.mockResolvedValue({ data: null, error: null })
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
  auth.exchangeCodeForSession.mockResolvedValue({ data: null, error: null })
  auth.role.mockResolvedValue({ data: { role: 'member' }, error: null })
})

describe('Next.js cookie refresh boundary', () => {
  it('checks staff permissions before the shell and denies role-check failures', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'staff' } }, error: null })
    const request = path => new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: 'sb-fixture-auth-token=valid' } })
    expect((await proxy(request('/admin'))).status).toBe(404)
    auth.role.mockResolvedValue({ data: { role: 'moderator' }, error: null })
    expect((await proxy(request('/moderator'))).status).toBe(200)
    expect((await proxy(request('/admin'))).status).toBe(404)
    auth.role.mockResolvedValue({ data: { role: 'admin' }, error: new Error('Role lookup failed') })
    expect((await proxy(request('/admin'))).status).toBe(404)
    auth.role.mockResolvedValue({ data: { role: 'admin' }, error: null })
    expect((await proxy(request('/admin'))).status).toBe(200)
  })
  it('does not contact Auth for an anonymous public request', async () => {
    const response = await proxy(new NextRequest('http://localhost:3000/privacy'))
    expect(response.status).toBe(200)
    expect(auth.getClaims).not.toHaveBeenCalled()
  })
  it('leaves code exchange as the sole session owner on the callback route', async () => {
    await proxy(new NextRequest('http://localhost:3000/auth/callback?code=fixture', { headers: { cookie: 'sb-fixture-auth-token=old' } }))
    expect(auth.getClaims).not.toHaveBeenCalled()
  })
  it('verifies presented cookies instead of trusting embedded session data', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('Invalid signature') })
    const response = await proxy(new NextRequest('http://localhost:3000/developer', { headers: { cookie: 'sb-fixture-auth-token=forged' } }))
    expect(auth.getUser).toHaveBeenCalledOnce()
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/login?next=%2Fdeveloper')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('forwards renewed cookies into both the request and response and preserves no-cache headers', async () => {
    auth.getClaims.mockImplementation(async () => {
      auth.cookies.setAll([{ name: 'sb-fixture-auth-token', value: 'renewed', options: { path: '/', sameSite: 'lax' } }], { Pragma: 'no-cache' })
      return { data: { claims: { sub: 'fixture-user' } }, error: null }
    })
    const request = new NextRequest('http://localhost:3000/privacy', { headers: { cookie: 'sb-fixture-auth-token=old' } })
    const response = await proxy(request)
    expect(request.cookies.get('sb-fixture-auth-token').value).toBe('renewed')
    expect(response.cookies.get('sb-fixture-auth-token').value).toBe('renewed')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
  })
  it('redirects anonymous private requests without calling Auth', async () => {
    const response = await proxy(new NextRequest('http://localhost:3000/settings?tab=keys'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/login?next=%2Fsettings%3Ftab%3Dkeys')
    expect(auth.getUser).not.toHaveBeenCalled()
  })
  it('preserves a loopback IP origin for sign-in cookies', async () => {
    const response = await proxy(new NextRequest('http://127.0.0.1:4175/settings', { headers: { host: '127.0.0.1:4175' } }))
    expect(new URL(response.headers.get('location')).origin).toBe('http://127.0.0.1:4175')
  })
  it('forwards session clearing when Auth rejects a private session', async () => {
    auth.getUser.mockImplementation(async () => {
      auth.cookies.setAll([{ name: 'sb-fixture-auth-token', value: '', options: { path: '/', maxAge: 0 } }], { Pragma: 'no-cache' })
      return { data: { user: { id: 'untrusted' } }, error: new Error('Revoked') }
    })
    const response = await proxy(new NextRequest('http://localhost:3000/profiles', { headers: { cookie: 'sb-fixture-auth-token=old' } }))
    expect(response.status).toBe(307)
    expect(response.cookies.get('sb-fixture-auth-token').value).toBe('')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('passes a private request only after Auth verifies its user', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'verified' } }, error: null })
    const response = await proxy(new NextRequest('http://localhost:3000/history', { headers: { cookie: 'sb-fixture-auth-token=valid' } }))
    expect(response.status).toBe(200)
    expect(auth.getUser).toHaveBeenCalledOnce()
    expect(auth.getClaims).not.toHaveBeenCalled()
  })
})

describe('PKCE callback', () => {
  it('exchanges a one-time code and carries its session cookies to a safe return URL', async () => {
    auth.exchangeCodeForSession.mockImplementation(async code => {
      expect(code).toBe('one-time-code')
      auth.cookies.setAll([{ name: 'sb-fixture-auth-token', value: 'session', options: { path: '/' } }], { 'Cache-Control': 'private, no-store' })
      return { error: null }
    })
    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=one-time-code&next=%2Fdeveloper'))
    expect(response.headers.get('location')).toBe('/developer')
    expect(response.cookies.get('sb-fixture-auth-token').value).toBe('session')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('keeps cookie deletion and cache headers when an exchange fails without leaking its code or raw error', async () => {
    auth.exchangeCodeForSession.mockImplementation(async () => {
      auth.cookies.setAll([{ name: 'sb-fixture-auth-token-code-verifier', value: '', options: { path: '/', maxAge: 0 } }], { Pragma: 'no-cache', Expires: '0' })
      return { error: new Error('sensitive provider details') }
    })
    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=private-code&next=https://evil.example'))
    const location = response.headers.get('location')
    expect(location).toMatch(/^\/login\?/)
    expect(location).not.toMatch(/evil|private-code|sensitive/)
    expect(response.cookies.get('sb-fixture-auth-token-code-verifier').value).toBe('')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(response.headers.get('expires')).toBe('0')
  })
})
