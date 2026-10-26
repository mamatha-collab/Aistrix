import { describe, expect, it, vi, beforeEach } from 'vitest'
import { workspaceReturnPath, WORKSPACE_ROUTES } from './workspaceRoutes'

const auth = vi.hoisted(() => ({ getUser: vi.fn(), role: vi.fn() }))
const query = { select() { return this }, eq() { return this }, maybeSingle: auth.role }
vi.mock('server-only', () => ({}))
vi.mock('../server/supabase', () => ({ createSessionClient: async () => ({ auth, from: () => query }) }))
vi.mock('next/navigation', () => ({ redirect: location => { throw new Error(`REDIRECT:${location}`) }, notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('../app/workspace-route', () => ({ default: () => null }))
import HomePage from '../app/page'
import { WORKSPACE_ALIASES } from '../../config/route-aliases.mjs'
import { makeWorkspacePage, makeStandalonePage } from '../server/workspacePage'
import { requireWorkspaceSession } from '../server/workspaceSession'

beforeEach(() => {
  vi.clearAllMocks()
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
  auth.role.mockResolvedValue({ data: { role: 'member' }, error: null })
})

describe('private workspace routes', () => {
  it('preserves callback and repeated query values through sign-in', () => {
    expect(workspaceReturnPath(['developer'], { stripe_connect: 'success', filter: ['a', 'b'] }))
      .toBe('/developer?stripe_connect=success&filter=a&filter=b')
    expect(workspaceReturnPath(['invite', 'a/b'], {})).toBe('/invite/a%2Fb')
  })
  it('requires a server-verified user and preserves the destination', async () => {
    await expect(makeWorkspacePage('/flows')({ searchParams: Promise.resolve({ open: '123' }) }))
      .rejects.toThrow('REDIRECT:/login?next=%2Fflows%3Fopen%3D123')
    expect(auth.getUser).toHaveBeenCalledOnce()
  })
  it('rejects a failed verification even if user data is present', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: new Error('revoked') })
    await expect(makeWorkspacePage('/developer')({ searchParams: {} })).rejects.toThrow('REDIRECT:/login')
  })
  it('allows a verified session without exposing user data in page props', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null })
    expect((await makeWorkspacePage('/dashboard')({ searchParams: {} })).props.screen).toBe('overview')
  })
  it('leaves visitor embed authorization to the embed screen', async () => {
    expect((await makeStandalonePage('embed', ['embed', ':id'])({ params: { id: 'app' }, searchParams: {} })).props.screen).toBe('embed')
    expect(auth.getUser).not.toHaveBeenCalled()
  })
})


describe('native route completeness and privileges', () => {
  it('enforces sign-in on every canonical workspace route', async () => {
    for (const path of Object.keys(WORKSPACE_ROUTES)) {
      await expect(makeWorkspacePage(path)({ searchParams: {} })).rejects.toThrow('REDIRECT:/login?next=')
    }
  })
  it('returns the verified user only to server-side callers', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null })
    expect(await requireWorkspaceSession(['settings'], {})).toEqual({ id: 'verified-user' })
  })
  it('denies administrative pages to a normal user, including failed role reads', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'member' } }, error: null })
    for (const path of ['/admin', '/moderator']) await expect(makeWorkspacePage(path)({ searchParams: {} })).rejects.toThrow('NOT_FOUND')
    auth.role.mockResolvedValue({ data: { role: 'admin' }, error: new Error('Permission check failed') })
    await expect(makeWorkspacePage('/admin')({ searchParams: {} })).rejects.toThrow('NOT_FOUND')
  })
  it('limits moderator access while allowing administrators', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'staff' } }, error: null })
    auth.role.mockResolvedValue({ data: { role: 'moderator' }, error: null })
    expect((await makeWorkspacePage('/moderator')({ searchParams: {} })).props.screen).toBe('moderator')
    await expect(makeWorkspacePage('/admin')({ searchParams: {} })).rejects.toThrow('NOT_FOUND')
    auth.role.mockResolvedValue({ data: { role: 'admin' }, error: null })
    expect((await makeWorkspacePage('/admin')({ searchParams: {} })).props.screen).toBe('admin')
  })
  it('maps old bookmarks and redirects the root to the public marketplace', () => {
    expect(WORKSPACE_ALIASES['/workflows']).toBe('/flows')
    expect(workspaceReturnPath(['flows'], { filter: ['a', 'b'] })).toBe('/flows?filter=a&filter=b')
    expect(() => HomePage()).toThrow('REDIRECT:/marketplace')
  })
})
