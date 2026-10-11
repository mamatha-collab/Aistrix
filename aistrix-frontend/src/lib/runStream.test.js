import { afterEach, describe, expect, it, vi } from 'vitest'

// runStream reads the session token from Supabase; no real client in tests.
const signedIn = { data: { session: { access_token: 'tok' } } }
vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => signedIn) } },
}))

const { supabase } = await import('../supabase')
const { RunError, errorFromResponse, normaliseUrl, parseModelJSON, readUrl, streamRun } = await import('./runStream')

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const sse = (...events) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200 })

afterEach(() => vi.unstubAllGlobals())

describe('parseModelJSON', () => {
  it('parses plain JSON', () => expect(parseModelJSON('{"a":1}')).toEqual({ a: 1 }))
  it('strips ```json fences', () => expect(parseModelJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 }))
  it('finds JSON inside a sentence', () => expect(parseModelJSON('Sure! Here it is: {"a":[1,2]} Hope that helps')).toEqual({ a: [1, 2] }))
  it('throws a readable RunError otherwise', () => {
    expect(() => parseModelJSON('no json here')).toThrow(RunError)
    expect(() => parseModelJSON('')).toThrow(/unexpected format/)
  })
})

describe('normaliseUrl', () => {
  it('adds https:// when missing', () => expect(normaliseUrl(' acme.com/about ')).toBe('https://acme.com/about'))
  it('keeps an existing scheme', () => expect(normaliseUrl('http://acme.com')).toBe('http://acme.com'))
  it('returns "" for empty input', () => expect(normaliseUrl('  ')).toBe(''))
})

describe('errorFromResponse', () => {
  it('prefers the readable "error" sentence', async () => {
    const e = await errorFromResponse(json(422, { error: 'Input too long', detail: [{ msg: 'x' }] }))
    expect(e).toMatchObject({ message: 'Input too long', status: 422, kind: 'validation' })
  })
  it('uses a string detail', async () => {
    expect((await errorFromResponse(json(402, { detail: 'Purchase access' }))).kind).toBe('payment')
  })
  it('turns a pydantic detail list into its first message', async () => {
    const e = await errorFromResponse(json(422, { detail: [{ msg: 'Value error, Pick a file' }] }))
    expect(e.message).toBe('Pick a file')
  })
  it('appends contract errors', async () => {
    const e = await errorFromResponse(json(422, { error: 'Bad fields', errors: ['company is required', 'x'] }))
    expect(e.message).toBe('Bad fields: company is required; x')
    expect(e.errors).toHaveLength(2)
  })
  it('explains an expired session on a bare 401', async () => {
    const e = await errorFromResponse(new Response('', { status: 401 }))
    expect(e).toMatchObject({ kind: 'auth', message: expect.stringMatching(/sign in again/) })
  })
  it('falls back to the status code', async () => {
    expect((await errorFromResponse(new Response('oops', { status: 500 }), 'Run failed')).message).toBe('Run failed (500)')
  })
  it('classifies rate limits', async () => {
    expect((await errorFromResponse(json(429, { error: 'Rate limit' }))).kind).toBe('rate_limit')
  })
})

describe('streamRun', () => {
  it('collects tokens and returns usage', async () => {
    const fetch = vi.fn(async () => sse({ token: 'Hel' }, { token: 'lo' }, { done: true, provider: 'claude', model: 'm', usage: { input_tokens: 3, output_tokens: 2 } }))
    vi.stubGlobal('fetch', fetch)
    const seen = []
    const out = await streamRun({ input: 'hi' }, { onToken: t => seen.push(t) })
    expect(out).toEqual({ text: 'Hello', provider: 'claude', model: 'm', usage: { input_tokens: 3, output_tokens: 2 } })
    expect(seen).toEqual(['Hel', 'Hello'])
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })
  it('throws the server error event', async () => {
    vi.stubGlobal('fetch', async () => sse({ token: 'x' }, { error: 'Rate limit: 30/30 runs this hour.' }))
    await expect(streamRun({ input: 'hi' })).rejects.toMatchObject({ kind: 'rate_limit' })
  })
  it('throws a contract error with the problems', async () => {
    vi.stubGlobal('fetch', async () => sse({ contract_error: ['"score" must be a number'] }))
    await expect(streamRun({ input: 'hi' })).rejects.toMatchObject({ kind: 'contract', errors: ['"score" must be a number'] })
  })
  it('treats a stream that ends without "done" as cut off', async () => {
    vi.stubGlobal('fetch', async () => sse({ token: 'partial' }))
    await expect(streamRun({ input: 'hi' })).rejects.toMatchObject({ kind: 'network' })
  })
  it('turns an HTTP error into a RunError', async () => {
    vi.stubGlobal('fetch', async () => json(402, { error: 'Purchase access to run this app' }))
    await expect(streamRun({ input: 'hi' })).rejects.toMatchObject({ kind: 'payment', message: 'Purchase access to run this app' })
  })
  it('reports an unreachable server clearly', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
    await expect(streamRun({ input: 'hi' })).rejects.toMatchObject({ kind: 'network', message: expect.stringMatching(/Could not reach/) })
  })
})

describe('readUrl', () => {
  it('posts to /scrape and returns the page', async () => {
    const fetch = vi.fn(async () => json(200, { text: 'About us', url: 'https://acme.com/', kind: 'text', truncated: false, chars: 8 }))
    vi.stubGlobal('fetch', fetch)
    expect((await readUrl('https://acme.com', { maxChars: 500 })).text).toBe('About us')
    expect(fetch.mock.calls[0][0]).toMatch(/\/scrape$/)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ url: 'https://acme.com', max_chars: 500 })
  })
  it('embed visitors: no sign-in header, app id sent', async () => {
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } })
    const fetch = vi.fn(async () => json(200, { text: 'region,amount', url: 'https://acme.com/d.csv', kind: 'csv', truncated: false, chars: 13 }))
    vi.stubGlobal('fetch', fetch)
    await readUrl('https://acme.com/d.csv', { appId: 'app-1' })
    const [, init] = fetch.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ url: 'https://acme.com/d.csv', max_chars: 8000, app_id: 'app-1' })
  })
  it("passes on the server's reason when a page can't be read", async () => {
    vi.stubGlobal('fetch', async () => json(422, { detail: 'This page is built with JavaScript' }))
    await expect(readUrl('https://app.acme.com')).rejects.toMatchObject({ message: 'This page is built with JavaScript' })
  })
})
