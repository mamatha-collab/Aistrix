import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) } },
}))
const { DEFAULT_PROVIDERS, builderProvider, defaultAppProvider, loadProviders, modelOptions, providerById, removeProviderKey, saveProviderKey } = await import('./providers')

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('provider lists', () => {
  it('offers Claude, OpenAI and Gemini by default', () => {
    expect(DEFAULT_PROVIDERS.map(p => p.id)).toEqual(['claude', 'openai', 'gemini'])
  })
  it('falls back to Claude for an unknown provider', () => {
    expect(providerById(DEFAULT_PROVIDERS, 'nope').id).toBe('claude')
  })
  it("keeps an app's current model listed even if it isn't offered", () => {
    const ids = modelOptions(DEFAULT_PROVIDERS, 'openai', 'gpt-6-astra').map(m => m.id)
    expect(ids).toEqual(['gpt-4o-mini', 'gpt-4o', 'gpt-6-astra'])
    expect(modelOptions(DEFAULT_PROVIDERS, 'openai', 'gpt-4o').map(m => m.id)).toEqual(['gpt-4o-mini', 'gpt-4o'])
  })
})

describe('keys', () => {
  it('saves through the backend (never the database directly) and refreshes the list', async () => {
    const fetch = vi.fn(async (url, init) => init?.method === 'PUT'
      ? json(200, { provider: 'gemini', connected: true, last4: '9xyz' })
      : json(200, { providers: [{ ...DEFAULT_PROVIDERS[2], connected: true, last4: '9xyz' }] }))
    vi.stubGlobal('fetch', fetch)
    const saved = await saveProviderKey('gemini', 'AIza-secret-9xyz')
    expect(saved.last4).toBe('9xyz')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toMatch(/\/v1\/provider-keys\/gemini$/)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ key: 'AIza-secret-9xyz' })
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect((await loadProviders())[0].connected).toBe(true)
  })
  it("shows the provider's reason when a key is rejected", async () => {
    vi.stubGlobal('fetch', async () => json(422, { detail: 'Gemini rejected that key. Check it and try again.' }))
    await expect(saveProviderKey('gemini', 'AIza-bad-key')).rejects.toMatchObject({ message: 'Gemini rejected that key. Check it and try again.' })
  })
  it('removes through the backend', async () => {
    const fetch = vi.fn(async () => json(200, { providers: DEFAULT_PROVIDERS }))
    vi.stubGlobal('fetch', fetch)
    await removeProviderKey('claude')
    expect(fetch.mock.calls[0][0]).toMatch(/\/v1\/provider-keys\/claude$/)
    expect(fetch.mock.calls[0][1].method).toBe('DELETE')
  })
})

const list = (...connected) => [
  { id: 'claude', connected: connected.includes('claude'), default_model: 'claude-sonnet-5-5' },
  { id: 'openai', connected: connected.includes('openai'), default_model: 'gpt-4o-mini' },
  { id: 'gemini', connected: connected.includes('gemini'), default_model: 'gemini-3.8-flash' },
]

describe('which provider builds and runs new apps', () => {
  it("uses the developer's only key", () => {
    expect(builderProvider(list('openai'))).toEqual({ provider: 'openai', model: 'gpt-4o' })
    expect(defaultAppProvider(list('openai'))).toEqual({ provider: 'openai', model: 'gpt-4o-mini' })
    expect(defaultAppProvider(list('gemini'))).toEqual({ provider: 'gemini', model: 'gemini-3.8-flash' })
  })
  it('prefers Claude when there are several keys', () => {
    expect(builderProvider(list('openai', 'claude'))).toEqual({ provider: 'claude', model: 'claude-sonnet-5-5' })
  })
  it('falls back to Claude (free allowance) without any key', () => {
    expect(builderProvider(list())).toEqual({ provider: 'claude', model: 'claude-sonnet-5-5' })
    expect(defaultAppProvider(undefined)).toEqual({ provider: 'claude', model: 'claude-sonnet-5-5' })
  })
})
