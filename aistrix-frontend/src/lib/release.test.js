import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn(async () => ({ data: [{ ok: true, errors: [], is_published: false }], error: null }))
vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) }, rpc: (...a) => rpc(...a) },
}))
const { publishApp, unpublishApp } = await import('./release')

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('publishing', () => {
  it('publishes by promoting through the backend', async () => {
    const fetch = vi.fn(async () => json(200, { ok: true, promoted_at: '2026-10-11T00:00:00Z', is_published: true }))
    vi.stubGlobal('fetch', fetch)
    expect((await publishApp('app-1')).promoted_at).toBe('2026-10-11T00:00:00Z')
    expect(fetch.mock.calls[0][0]).toMatch(/\/v1\/apps\/app-1\/promote$/)
    expect(fetch.mock.calls[0][1].method).toBe('POST')
  })

  it("says exactly what's missing when the app isn't ready", async () => {
    vi.stubGlobal('fetch', async () => json(409, {
      error: 'Not ready to publish yet', checks: ['Description is required'],
      test_problems: ['Safety and leakage checks: Run a prompt/secret leakage test.'],
    }))
    await expect(publishApp('app-1')).rejects.toMatchObject({
      status: 409,
      message: 'Not ready to publish yet: Description is required; Safety and leakage checks: Run a prompt/secret leakage test.',
    })
  })

  it('unpublishes directly (no gate)', async () => {
    await unpublishApp('app-1')
    expect(rpc).toHaveBeenCalledWith('set_app_published_with_gate', { p_app_id: 'app-1', p_publish: false })
  })
})
