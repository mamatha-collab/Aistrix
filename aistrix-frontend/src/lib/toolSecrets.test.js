import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}))
const { moveToolKeysToSecrets, secretName } = await import('./toolSecrets')

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('tool keys → encrypted app secrets', () => {
  it('names secrets from the tool and field', () => {
    expect(secretName('Send email', 'api_key')).toBe('SEND_EMAIL_API_KEY')
  })

  it('saves each raw key as a secret and keeps only a reference in the tool', async () => {
    const fetch = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetch)
    const { tools, problems } = await moveToolKeysToSecrets('app-1', [
      { name: 'Send email', type: 'email', config: { from: 'a@b.co', api_key: 'SG.real-secret-key-123456' } },
      { name: 'Lookup', type: 'http', config: { url: 'https://x.test', api_key: '{{secrets.ALREADY_SET}}' } },
    ])
    expect(problems).toEqual([])
    expect(tools[0].config).toEqual({ from: 'a@b.co', api_key: '{{secrets.SEND_EMAIL_API_KEY}}' })
    expect(tools[1].config.api_key).toBe('{{secrets.ALREADY_SET}}')       // references are left alone
    expect(JSON.stringify(tools)).not.toContain('real-secret')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toMatch(/\/apps\/app-1\/secrets$/)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ key: 'SEND_EMAIL_API_KEY', value: 'SG.real-secret-key-123456' })
  })

  it("drops a key whose secret can't be saved instead of storing it raw", async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ detail: 'SECRET_ENCRYPTION_KEY not set' }), { status: 503 }))
    const { tools, problems } = await moveToolKeysToSecrets('app-1', [
      { name: 'Calendar', type: 'calendar', config: { api_key: 'AIza-real-calendar-key-1234567890' } },
    ])
    expect(tools[0].config).toEqual({})
    expect(problems[0]).toMatch(/Calendar: SECRET_ENCRYPTION_KEY not set/)
  })
})
