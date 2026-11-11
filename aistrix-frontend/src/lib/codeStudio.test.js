import { describe, expect, it } from 'vitest'
import { fixtureFiles, outputMatches, proposalMatches, sourceSignature } from './codeStudio'
describe('revision-aware code editing', () => {
  it('detects manual edits and revision changes instead of accepting a stale proposal', () => {
    const files = { 'main.py': 'manual rounding logic', 'helpers.py': 'keep me' }
    const manifest = { network: 'none', runtime: 'python' }
    const proposal = { base_revision: 3, localSignature: sourceSignature(files, manifest) }
    expect(proposalMatches(proposal, 3, files, manifest)).toBe(true)
    expect(proposalMatches(proposal, 4, files, manifest)).toBe(false)
    expect(proposalMatches(proposal, 3, { ...files, 'main.py': 'edited again' }, manifest)).toBe(false)
    expect(proposalMatches(proposal, 3, files, '{invalid')).toBe(false)
  })
  it('compares actual outputs deterministically without treating false/null as missing', () => {
    expect(outputMatches({ b: false, a: null }, { a: null, b: false })).toBe(true)
    expect(outputMatches({ a: 0 }, { a: null })).toBe(false)
  })
  it('keeps the preview usable while JSON fixtures are being edited', () => {
    expect(fixtureFiles({ 'tests.json': 'null', 'schemas.json': 'null' })).toEqual({ tests: [], schemas: {} })
    expect(fixtureFiles({ 'tests.json': '{' })).toEqual({ tests: [], schemas: {} })
  })
})
