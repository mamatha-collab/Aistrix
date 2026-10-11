import { describe, expect, it } from 'vitest'
import { buildTemplateCases, isRealCheck } from './testTemplates'

const TYPES = ['prompt', 'native', 'structured', 'data', 'website', 'chatbot', 'api', 'agent']
const CATEGORIES = ['functional', 'edge', 'safety', 'contract', 'app_specific']
const app = type => ({ id: 'a1', name: 'Lead scorer', app_type: type, output_type: type === 'structured' ? 'json' : 'markdown',
  form_schema: [{ label: 'Company', type: 'text' }] })

describe('app templates', () => {
  it.each(TYPES)('%s: every template has a category and at least one real check', type => {
    const cases = buildTemplateCases(app(type), {})
    expect(cases.length).toBeGreaterThanOrEqual(3)
    for (const tc of cases) {
      expect(CATEGORIES).toContain(tc.category)
      expect(tc.rules.some(isRealCheck)).toBe(true)
    }
  })

  it.each(TYPES)('%s: includes a safety test that checks for leaked instructions', type => {
    const safety = buildTemplateCases(app(type), {}).filter(tc => tc.category === 'safety')
    expect(safety.some(tc => tc.rules.some(r => r.type === 'no_prompt_leak'))).toBe(true)
  })

  it('chatbots get a multi-turn memory test', () => {
    const memory = buildTemplateCases(app('chatbot'), {}).find(tc => tc.history?.length)
    expect(memory.category).toBe('app_specific')
    expect(memory.history.map(t => t.role)).toEqual(['user', 'assistant'])
    expect(memory.rules.some(r => r.type === 'judge')).toBe(true)
  })

  it("adds the Design blueprint's output checks and safety cases", () => {
    const bp = {
      output_schema: { fields: [{ field: 'score', type: 'number' }] },
      ai_behavior: { refusal_rules: 'Never give legal advice' },
      inputs: [{ key: 'email', label: 'Email', pii: true }],
    }
    const cases = buildTemplateCases(app('prompt'), bp)
    expect(cases[0].rules.some(r => r.type === 'json_schema')).toBe(true)
    expect(cases.some(tc => tc.rules.some(r => r.type === 'no_refusal_bypass'))).toBe(true)
    expect(cases.some(tc => tc.name.includes('redacted personal data'))).toBe(true)
  })

  it('length limits alone are not real checks', () => {
    expect(isRealCheck({ type: 'min-length', value: '40' })).toBe(false)
    expect(isRealCheck({ type: 'must-contain', value: '' })).toBeFalsy()
    expect(isRealCheck({ type: 'no_prompt_leak' })).toBe(true)
  })
})
