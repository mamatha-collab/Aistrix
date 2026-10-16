import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { auth } }))
import { manageRequest } from './manageApi'

beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: { session: { access_token: 'fixture-token' } } })
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('Manage API safeguards', () => {
  it('requires an authenticated session before any request', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    await expect(manageRequest('/stripe/earnings')).rejects.toThrow('Sign in again')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('authenticates reads and retains valid zero earnings', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ total_gross: 0, total_dev_share: 0, total_pending: 0, by_app: [], recent: [] })))
    expect((await manageRequest('/stripe/earnings')).total_dev_share).toBe(0)
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-token')
  })
  it.each([{}, { total_gross: 0, total_dev_share: null, total_pending: 0, by_app: [], recent: [] }])('rejects incomplete ledgers instead of inventing figures: %j', async body => {
    fetch.mockResolvedValue(new Response(JSON.stringify(body)))
    await expect(manageRequest('/stripe/earnings')).rejects.toThrow('incomplete')
  })
  it('cannot treat an invalid metadata response as an empty secret list', async () => {
    fetch.mockResolvedValue(new Response('{}'))
    await expect(manageRequest('/apps/a/secrets')).rejects.toThrow('could not be verified')
  })
  it('reports unsuccessful deletion, not a success message', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Permission revoked' }), { status: 403 }))
    await expect(manageRequest('/apps/a/secrets/TOKEN', { method: 'DELETE' })).rejects.toThrow('Permission revoked')
  })
  it('accepts successful no-content deletion', async () => {
    fetch.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(manageRequest('/apps/a/secrets/TOKEN', { method: 'DELETE' })).resolves.toEqual({})
  })
  it('rejects HTML or truncated responses without exposing their contents', async () => {
    fetch.mockResolvedValue(new Response('<html>unexpected gateway output</html>'))
    await expect(manageRequest('/apps/a/secrets')).rejects.toThrow('invalid response')
  })
})
