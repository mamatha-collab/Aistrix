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
  it('rejects malformed stream event fields', () => {
    for (const payload of [null, [], { token: 12 }, { done: 'yes' }, { usage: { input_tokens: '12' } }, { contract_error: 'bad' }, { tool_call: { name: 'search', input: null } }, { tool_result: { name: 'search', result: {} } }]) {
      expect(parseSSELine(`data: ${JSON.stringify(payload)}`)).toBeNull()
    }
  })
  it('preserves valid tool and usage events', () => {
    const event = { done: true, provider: 'openai', model: 'model', usage: { input_tokens: 10, output_tokens: 2 }, tool_call: { name: 'search', input: { query: 'example' } }, tool_result: { name: 'search', result: 'found' } }
    expect(parseSSELine(`data: ${JSON.stringify(event)}`)).toEqual(event)
  })
})
