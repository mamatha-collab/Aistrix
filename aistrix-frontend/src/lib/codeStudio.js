export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export const sourceSignature = (files, manifest) => canonical({ files, manifest: typeof manifest === 'string' ? JSON.parse(manifest) : manifest })
export function fixtureFiles(files) {
  try {
    const schemas = JSON.parse(files['schemas.json'] || '{}')
    const tests = JSON.parse(files['tests.json'] || '[]')
    return { schemas: schemas && typeof schemas === 'object' && !Array.isArray(schemas) ? schemas : {}, tests: Array.isArray(tests) ? tests.filter(test => test && typeof test === 'object' && !Array.isArray(test) && typeof test.name === 'string' && test.input && typeof test.input === 'object') : [] }
  }
  catch { return { schemas: {}, tests: [] } }
}
export function proposalMatches(proposal, revision, files, manifest) {
  try { return proposal.base_revision === revision && proposal.localSignature === sourceSignature(files, manifest) } catch { return false }
}
export function outputMatches(actual, expected) { return canonical(actual) === canonical(expected) }
