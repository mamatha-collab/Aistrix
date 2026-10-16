import { describe, expect, it } from 'vitest'
import { parseSSELine } from './sse'

describe('parseSSELine', () => {
  it('parses data lines', () => expect(parseSSELine('data: {"token":"hi"}')).toEqual({ token: 'hi' }))
  it('ignores other lines', () => {
    expect(parseSSELine('')).toBeNull()
    expect(parseSSELine(': keep-alive')).toBeNull()
    expect(parseSSELine('event: ping')).toBeNull()
  })
  it('returns null for a partial JSON chunk instead of throwing', () => expect(parseSSELine('data: {"tok')).toBeNull())
})
