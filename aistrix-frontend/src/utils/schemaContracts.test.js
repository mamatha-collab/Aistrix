import { describe, expect, it } from 'vitest'
import {
  fieldKeyFromLabel, formSchemaToInputFields, outputFieldsErrors, parseSchemaValue, validateJsonOutput,
} from './schemaContracts'

describe('fieldKeyFromLabel (must match the backend and API docs)', () => {
  it.each([
    ['Company Name', 'company_name'],
    ['  Budget ($) ', 'budget'],
    ['E-mail / Phone', 'e_mail_phone'],
  ])('%s → %s', (label, key) => expect(fieldKeyFromLabel(label)).toBe(key))
})

describe('formSchemaToInputFields (Form apps)', () => {
  it('maps form fields to the input contract', () => {
    const fields = formSchemaToInputFields([
      { label: 'Company Name', type: 'text', required: true },
      { label: 'Seats', type: 'number' },
      { label: 'Plan', type: 'select', options: 'Free, Pro ,Team' },
      { label: '  ', type: 'text' },
    ])
    expect(fields).toEqual([
      { field: 'company_name', type: 'string', required: true, description: 'Company Name' },
      { field: 'seats', type: 'number', required: false, description: 'Seats' },
      { field: 'plan', type: 'enum', enum_values: ['Free', 'Pro', 'Team'], required: false, description: 'Plan' },
    ])
  })
})

describe('validateJsonOutput (Structured apps)', () => {
  const fields = [
    { field: 'company', type: 'string' },
    { field: 'score', type: 'number' },
    { field: 'tier', type: 'enum', enum_values: ['hot', 'cold'], required: false },
  ]
  it('accepts a matching answer, even in code fences', () => {
    expect(validateJsonOutput('```json\n{"company":"Acme","score":7}\n```', fields)).toMatchObject({ ok: true, errors: [] })
  })
  it('lists every problem', () => {
    const r = validateJsonOutput('{"score":"high","tier":"warm"}', fields)
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual(['"company" is required', '"score" must be a number', '"tier" must be one of: hot, cold'])
  })
  it('reports invalid JSON', () => {
    expect(validateJsonOutput('not json', fields).errors[0]).toMatch(/not valid JSON/)
  })
})

describe('outputFieldsErrors (Structured app builder)', () => {
  it('accepts valid fields', () => expect(outputFieldsErrors([{ field: 'score', type: 'number' }])).toBe(''))
  it.each([
    [[{ field: '' }], /needs a name/],
    [[{ field: 'Score' }], /lowercase/],
    [[{ field: 'a' }, { field: 'a' }], /listed twice/],
    [[{ field: 'tier', type: 'enum', enum_values: [] }], /allowed value/],
  ])('rejects %j', (fields, msg) => expect(outputFieldsErrors(fields)).toMatch(msg))
})

describe('parseSchemaValue', () => {
  it('converts form input to the field type', () => {
    expect(parseSchemaValue('42', { type: 'number' })).toBe(42)
    expect(parseSchemaValue('a, b,', { type: 'string_array' })).toEqual(['a', 'b'])
    expect(parseSchemaValue('true', { type: 'boolean' })).toBe(true)
    expect(parseSchemaValue('{"x":1}', { type: 'object' })).toEqual({ x: 1 })
  })
})
