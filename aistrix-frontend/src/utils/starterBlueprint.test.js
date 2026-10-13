import { describe, expect, it } from 'vitest'
import { mergeStarter, sectionsFromPrompt, starterBlueprint } from './starterBlueprint'

describe('sections the prompt asks for', () => {
  it('reads ## headings', () => {
    expect(sectionsFromPrompt('Report:\n## Totals by region (a small table)\n## Top product\n## Anything unusual'))
      .toEqual(['Totals by region', 'Top product', 'Anything unusual'])
  })
  it('reads a "sections:" list without splitting "Salary and location"', () => {
    expect(sectionsFromPrompt("Write the posting with these sections: About the role, What you'll do (4-6 bullets), What you bring, Salary and location. Use plain language."))
      .toEqual(['About the role', "What you'll do", 'What you bring', 'Salary and location'])
  })
  it('finds nothing in a prompt without sections', () => {
    expect(sectionsFromPrompt('You draft replies to customer emails. Keep it under 180 words.')).toEqual([])
  })
})

describe('starter blueprint from a wizard', () => {
  const app = (over = {}) => ({ app_type: 'prompt', output_type: 'markdown', description: 'Drafts support replies.', system_prompt: 'You help.', ...over })

  it('fills business problem, input, format and what the builder knew', () => {
    const bp = starterBlueprint(app({ app_type: 'native', system_prompt: 'Score the lead.' }), {
      formSchema: [{ label: 'Company', type: 'text', required: true }],
      known: { business_problem: 'SDRs waste time', audience: 'SDRs', fallback: 'Score anyway and flag gaps', sections: ['Lead Score', 'Next Step'] },
    })
    expect(bp.business_problem).toBe('SDRs waste time')
    expect(bp.audience).toBe('SDRs')
    expect(bp.input_schema.fields[0]).toMatchObject({ field: 'company', required: true })
    expect(bp.output_contract).toMatchObject({ format: 'markdown', format_rules: { sections: 'Lead Score, Next Step' } })
    expect(bp.ai_behavior.fallback_behavior).toBe('Score anyway and flag gaps')
  })

  it("doesn't invent an audience the wizard never asked about", () => {
    const bp = starterBlueprint(app())
    expect(bp.audience).toBe('')
    expect(bp.business_problem).toBe('Drafts support replies.')
    expect(bp.input_schema.fields).toEqual([{ field: 'input', type: 'string', required: true, description: 'Input' }])
  })

  it('matches the prompt so Design never says "Prompt expects email"', () => {
    expect(starterBlueprint(app({ system_prompt: 'Write a draft reply email to the customer.' })).output_contract.format).toBe('email')
  })

  it('structured apps get a JSON contract from their output fields', () => {
    const fields = [{ field: 'total', type: 'number' }]
    const bp = starterBlueprint(app({ app_type: 'structured', output_type: 'json' }), { outputFields: fields })
    expect(bp.output_contract).toMatchObject({ format: 'json', fields })
    expect(bp.output_schema.fields).toEqual(fields)
  })

  it('chatbots get a message input and no section rules', () => {
    const bp = starterBlueprint(app({ app_type: 'chatbot', system_prompt: '## Greeting\n## Answer' }))
    expect(bp.input_schema.fields[0].field).toBe('message')
    expect(bp.output_contract.format_rules).toEqual({})
  })
})

describe('merging into an existing blueprint', () => {
  it('only fills what is empty', () => {
    const merged = mergeStarter(
      { audience: 'Recruiters', business_problem: '', ai_behavior: { tone_preset: 'x', fallback_behavior: '' } },
      { audience: 'SDRs', business_problem: 'Slow triage', ai_behavior: { fallback_behavior: 'Ask' } },
    )
    expect(merged).toEqual({ audience: 'Recruiters', business_problem: 'Slow triage', ai_behavior: { tone_preset: 'x', fallback_behavior: 'Ask' } })
  })
})
