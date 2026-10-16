import { describe, expect, it } from 'vitest'
import { HISTORY_CHAR_BUDGET, buildConversationInput } from './conversation'

const turn = (role, content) => ({ role, content })

describe('buildConversationInput', () => {
  it('sends just the message when there is no history or greeting', () => {
    expect(buildConversationInput('', [], 'Hi')).toBe('Hi')
  })

  it('includes the greeting so the model knows what it already said', () => {
    expect(buildConversationInput('Hello! How can I help?', [], 'My name is Sam'))
      .toBe('Conversation history:\nAssistant: Hello! How can I help?\n\nUser: My name is Sam')
  })

  it('keeps earlier turns in order before the new message', () => {
    const history = [turn('user', 'My name is Sam'), turn('assistant', 'Nice to meet you, Sam')]
    expect(buildConversationInput('', history, 'What is my name?')).toBe(
      'Conversation history:\nUser: My name is Sam\n\nAssistant: Nice to meet you, Sam\n\nUser: What is my name?',
    )
  })

  it('drops the oldest turns (and the greeting) when over budget', () => {
    const big = 'x'.repeat(5000)
    const history = [turn('user', `old ${big}`), turn('assistant', `mid ${big}`), turn('user', `new ${big}`)]
    const input = buildConversationInput('Greeting', history, 'latest?')
    expect(input).not.toContain('old ')
    expect(input).not.toContain('Greeting')
    expect(input).toContain('mid ')
    expect(input).toContain('new ')
    expect(input.endsWith('User: latest?')).toBe(true)
    expect(input.length).toBeLessThan(HISTORY_CHAR_BUDGET + 200)
  })
})
