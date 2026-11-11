import { describe, expect, it } from 'vitest'
import { buildSuite, editSuite, newSuite } from './evaluationEditor'
const target = 'Application/team/invoice@1.0.0'
describe('evaluation authoring contract', () => {
  it('pins the target and preserves JSON values including null on edit', () => {
    const draft = newSuite()
    draft.name = 'invoice-tests'
    draft.cases[0].checks = [{ type: 'equals', path: 'value', value: 'null' }]
    const doc = buildSuite(draft, target, 'extract')
    expect(doc.spec.target).toEqual({ ref: target, workload: 'extract' })
    expect(buildSuite(editSuite(doc), target, 'extract')).toEqual(doc)
    expect(doc.spec.cases[0].expect[0].value).toBeNull()
  })
  it('rejects invalid input, missing external replacements, and vacuous checks before release', () => {
    const draft = newSuite()
    expect(() => buildSuite(draft, target, 'extract', ['post'])).toThrow('post')
    draft.cases[0].input = '[]'
    expect(() => buildSuite(draft, target, 'extract')).toThrow('JSON object')
    draft.cases[0].input = '{}'; draft.cases[0].checks = []
    expect(() => buildSuite(draft, target, 'extract')).toThrow('Each case needs a check')
  })
  it('validates numeric tolerances and converts a percentage to a ratio', () => {
    const draft = newSuite()
    draft.requiredPassRate = '80'
    draft.cases[0].checks = [{ type: 'number_close', path: 'total', value: '120', tolerance: '-1' }]
    expect(() => buildSuite(draft, target, 'extract')).toThrow('negative')
    draft.cases[0].checks[0].tolerance = '0.1'
    expect(buildSuite(draft, target, 'extract').spec.requiredPassRate).toBe(0.8)
  })
  it('keeps source envelope fields while allowing dataset removal', () => {
    const draft = newSuite()
    const doc = buildSuite(draft, target, 'extract')
    doc.dependencies = ['Dataset/team/old@1']; doc.spec.dataset = 'Dataset/team/old@1'
    const editing = editSuite(doc); editing.dataset = ''
    const result = buildSuite(editing, target, 'extract')
    expect(result.dependencies).toEqual(doc.dependencies)
    expect(JSON.parse(JSON.stringify(result)).spec).not.toHaveProperty('dataset')
  })
})
