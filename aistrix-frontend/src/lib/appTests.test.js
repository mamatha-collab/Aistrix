import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}))
const { runAppTest, rulesToChecks } = await import('./appTests')

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('runAppTest', () => {
  it('runs the test on the server for the app', async () => {
    const fetch = vi.fn(async () => json(200, { passed: true, errors: [], output: 'ok', cost_usd: 0.007 }))
    vi.stubGlobal('fetch', fetch)
    const tc = { source: 'suite', case_ref: 'tc-1', label: 'Hot lead', input: 'Acme', checks: rulesToChecks([{ type: 'must-contain', value: 'hot' }]) }
    expect((await runAppTest('app-1', tc)).passed).toBe(true)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toMatch(/\/v1\/apps\/app-1\/tests\/run$/)
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body).checks).toEqual([{ type: 'must-contain', value: 'hot' }])
  })
  it("shows the server's reason when a test can't run", async () => {
    vi.stubGlobal('fetch', async () => json(404, { detail: 'App not found' }))
    await expect(runAppTest('app-x', { case_ref: 'x', input: 'y' })).rejects.toMatchObject({ message: 'App not found' })
  })
})
