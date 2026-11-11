export const newCheck = () => ({ type: 'not_empty', path: '', value: '"expected"', tolerance: '0.01', schema: '{}' })
export const newCase = number => ({ name: `Case ${number}`, input: '{}', checks: [newCheck()] })
export const newSuite = () => ({ namespace: 'default', name: '', version: '1.0.0', requiredPassRate: '100', approvals: 'approve', dataset: '', mocks: '{}', sharedChecks: '[]', cases: [newCase(1)] })

function json(text, label, shape) {
  let value
  try { value = JSON.parse(text) } catch { throw new Error(`${label}: enter valid JSON.`) }
  if (shape === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error(`${label}: enter a JSON object.`)
  if (shape === 'array' && !Array.isArray(value)) throw new Error(`${label}: enter a JSON array.`)
  return value
}
export function buildSuite(draft, target, workload, externalSteps = []) {
  if (!target || !workload) throw new Error('Choose an application release and workload first.')
  const threshold = Number(draft.requiredPassRate)
  if (!draft.requiredPassRate.trim() || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('Required pass rate must be between 0 and 100.')
  const mocks = json(draft.mocks, 'External step replacements', 'object')
  const missing = externalSteps.filter(id => !Object.hasOwn(mocks, id))
  if (missing.length) throw new Error(`Provide test replacements for external steps: ${missing.join(', ')}.`)
  if (!draft.cases.length && !draft.dataset.trim()) throw new Error('Add at least one test case or a pinned dataset.')
  const cases = draft.cases.map((entry, index) => ({
    name: entry.name,
    input: json(entry.input, `Case ${index + 1} input`, 'object'),
    expect: entry.checks.map((rule, ruleIndex) => {
      const label = `Case ${index + 1}, check ${ruleIndex + 1}`
      const out = { type: rule.type, ...(rule.path ? { path: rule.path } : {}) }
      if (['equals', 'contains', 'number_close'].includes(rule.type)) out.value = json(rule.value, `${label} expected value`)
      if (rule.type === 'number_close') {
        out.tolerance = Number(rule.tolerance)
        if (typeof out.value !== 'number' || !rule.tolerance.trim() || !Number.isFinite(out.tolerance) || out.tolerance < 0) throw new Error(`${label}: expected value and tolerance must be numbers; tolerance cannot be negative.`)
      }
      if (rule.type === 'json_schema') out.schema = json(rule.schema, `${label} schema`, 'object')
      return out
    }),
  }))
  const shared = json(draft.sharedChecks, 'Shared checks', 'array')
  if (!shared.length && cases.some(entry => !entry.expect.length)) throw new Error('Each case needs a check, or add shared checks.')
  return {
    ...draft.source,
    apiVersion: 'aistrix.ai/v1alpha1', kind: 'EvalSuite',
    metadata: { ...draft.source?.metadata, namespace: draft.namespace.trim(), name: draft.name.trim(), version: draft.version.trim() },
    spec: { ...draft.source?.spec, target: { ref: target, workload }, requiredPassRate: threshold / 100, approvals: draft.approvals, mocks,
      checks: shared, dataset: draft.dataset.trim() || undefined, cases },
  }
}
export function editSuite(doc) {
  const data = doc.spec
  return { ...newSuite(), source: doc, ...doc.metadata, requiredPassRate: String((data.requiredPassRate ?? 1) * 100), approvals: data.approvals || 'approve', dataset: data.dataset || '', mocks: JSON.stringify(data.mocks || {}, null, 2), sharedChecks: JSON.stringify(data.checks || [], null, 2), cases: (data.cases || []).map(entry => ({ name: entry.name, input: JSON.stringify(entry.input, null, 2), checks: (entry.expect || []).map(rule => ({ ...newCheck(), ...rule, value: JSON.stringify(Object.hasOwn(rule, 'value') ? rule.value : 'expected'), tolerance: String(rule.tolerance ?? 0.01), schema: JSON.stringify(rule.schema || {}, null, 2) })) })) }
}
