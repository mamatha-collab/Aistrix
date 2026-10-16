// Regression cases use a deterministic UUID, so retries and two browser tabs
// cannot create duplicate cases in the developer's test suite.
export async function regressionId(appId, runId, userId) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['aistrix:regression', appId, runId, userId])))).slice(0, 16)
  bytes[6] = (bytes[6] & 15) | 128
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function feedbackSummary(runs) {
  const rated = runs.filter(r => r.rating_value === 1 || r.rating_value === -1)
  const negative = rated.filter(r => r.rating_value === -1)
  return { total: runs.length, rated: rated.length, negative: negative.length,
    satisfaction: rated.length ? Math.round(100 * (rated.length - negative.length) / rated.length) : null }
}

export async function saveRunRegression(client, { appId, userId, run, input, type, expectation }) {
  if (!run?.id || run.app_id !== appId) throw new Error('Select a run belonging to this app.')
  if (!input?.trim()) throw new Error('Add a reproducible test input first.')
  if (!['must-contain', 'must-not-contain'].includes(type) || !expectation?.trim()) throw new Error('Define what the corrected answer must include or avoid.')
  const id = await regressionId(appId, run.id, userId)
  const read = () => client.from('app_test_cases').select('*').eq('id', id).eq('app_id', appId).eq('user_id', userId).maybeSingle()
  const existing = await read()
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data) return { testCase: existing.data, existing: true }
  const result = await client.from('app_test_cases').insert({ id, app_id: appId, user_id: userId,
    name: `Run regression · ${run.id}`, input: input.trim(), category: 'functional',
    rules: [{ type, value: expectation.trim() }], context: [] }).select().single()
  if (result.error?.code === '23505') {
    const concurrent = await read()
    if (concurrent.data && !concurrent.error) return { testCase: concurrent.data, existing: true }
  }
  if (result.error) throw new Error(result.error.message)
  return { testCase: result.data, existing: false }
}
