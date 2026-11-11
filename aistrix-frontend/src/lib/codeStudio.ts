import { isRecord, type SourceFiles } from '../types/domain'
export function canonical(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export const sourceSignature = (files: SourceFiles, manifest: unknown) => canonical({ files, manifest: typeof manifest === 'string' ? JSON.parse(manifest) : manifest })
export function fixtureFiles(files: SourceFiles) {
  try {
    const schemas = JSON.parse(files['schemas.json'] || '{}')
    const tests = JSON.parse(files['tests.json'] || '[]')
    return { schemas: schemas && typeof schemas === 'object' && !Array.isArray(schemas) ? schemas : {}, tests: Array.isArray(tests) ? tests.filter((test: unknown) => isRecord(test) && typeof test.name === 'string' && test.input && typeof test.input === 'object') : [] }
  }
  catch { return { schemas: {}, tests: [] } }
}
export function proposalMatches(proposal: { base_revision: number; localSignature: string }, revision: number, files: SourceFiles, manifest: unknown) {
  try { return proposal.base_revision === revision && proposal.localSignature === sourceSignature(files, manifest) } catch { return false }
}
export function outputMatches(actual: unknown, expected: unknown) { return canonical(actual) === canonical(expected) }
