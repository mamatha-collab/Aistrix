import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))
const { friendlyErrorMessage } = await import('./appActions')

const CANT_CONNECT = /Could not connect to the backend/

describe('friendlyErrorMessage', () => {
  it.each([
    'Failed to fetch',                                   // Chrome
    'NetworkError when attempting to fetch resource.',   // Firefox
    'Load failed',                                       // Safari
  ])('turns the browser\'s "%s" into a connection message', msg => {
    expect(friendlyErrorMessage(new TypeError(msg))).toMatch(CANT_CONNECT)
  })

  it('passes server reasons that mention "fetch" through unchanged', () => {
    const msg = 'Could not fetch that URL. Check it is public and try again.'
    expect(friendlyErrorMessage(new Error(msg))).toBe(msg)
    expect(friendlyErrorMessage(new Error('Could not fetch the sheet.'))).toBe('Could not fetch the sheet.')
  })

  it('keeps our own readable network message', () => {
    const msg = 'Could not reach the Aistrix server. Check your connection and try again.'
    expect(friendlyErrorMessage(Object.assign(new Error(msg), { kind: 'network' }))).toBe(msg)
  })

  it('explains timeouts and rate limits', () => {
    expect(friendlyErrorMessage(Object.assign(new Error('x'), { name: 'AbortError' }))).toMatch(/timed out/)
    expect(friendlyErrorMessage(new Error('429'))).toMatch(/Rate limit reached/)
    expect(friendlyErrorMessage(new Error('Rate limit: 30/30 runs this hour.'))).toBe('Rate limit: 30/30 runs this hour.')
  })

  it('never returns an empty message', () => {
    expect(friendlyErrorMessage(new Error(''))).toMatch(/Something went wrong/)
    expect(friendlyErrorMessage(undefined)).toMatch(/Something went wrong/)
  })
})
