import { describe, expect, it } from 'vitest'
import { feedbackSummary, regressionId, saveRunRegression } from './operationsLoop'

function database({ readError, insertError } = {}) {
  const rows = new Map()
  let writes = 0
  return { rows, get writes() { return writes }, from: () => {
    const filters = {}
    let pending
    const query = {
      select: () => query, eq: (key, value) => { filters[key] = value; return query },
      maybeSingle: async () => ({ data: [...rows.values()].find(row => Object.entries(filters).every(([k, v]) => row[k] === v)) || null, error: readError }),
      insert: value => { pending = value; return query },
      single: async () => {
        writes++
        if (insertError) return { data: null, error: insertError }
        if (rows.has(pending.id)) return { data: null, error: { code: '23505', message: 'Duplicate id' } }
        rows.set(pending.id, pending)
        return { data: pending, error: null }
      },
    }
    return query
  } }
}
const request = { appId: 'app-a', userId: 'developer-a', run: { id: 'run-a', app_id: 'app-a', output: 'Incorrect answer' }, input: 'Check this invoice', type: 'must-contain', expectation: 'Missing invoice number' }

describe('feedback to regression loop', () => {
  it('does not treat unrated or unknown ratings as useful feedback', () => {
    expect(feedbackSummary([{ rating_value: 1 }, { rating_value: -1 }, { rating_value: null }, { rating_value: 0 }, { rating_value: 4 }])).toEqual({ total: 5, rated: 2, negative: 1, satisfaction: 50 })
    expect(feedbackSummary([]).satisfaction).toBeNull()
  })
  it('scopes deterministic case ids to app, run, and developer', async () => {
    const id = await regressionId('a', 'r', 'u')
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await regressionId('a', 'r', 'u')).toBe(id)
    expect(new Set(await Promise.all([regressionId('b', 'r', 'u'), regressionId('a', 's', 'u'), regressionId('a', 'r', 'v')]))).not.toContain(id)
  })
  it('saves a reviewed input and an explicit corrected behavior, never the bad answer', async () => {
    const db = database()
    const result = await saveRunRegression(db, request)
    expect(result.testCase).toMatchObject({ app_id: 'app-a', user_id: 'developer-a', category: 'functional', input: request.input, rules: [{ type: 'must-contain', value: request.expectation }] })
    expect(result.testCase).not.toHaveProperty('output')
  })
  it('keeps existing test edits on retry', async () => {
    const db = database()
    const first = await saveRunRegression(db, request)
    first.testCase.rules = [{ type: 'must-not-contain', value: 'fabricated invoice' }]
    const second = await saveRunRegression(db, { ...request, expectation: 'Another phrase' })
    expect(second.existing).toBe(true)
    expect(second.testCase.rules).toEqual(first.testCase.rules)
    expect(db.writes).toBe(1)
  })
  it('deduplicates concurrent browser saves with the primary key', async () => {
    const db = database()
    const results = await Promise.all([saveRunRegression(db, request), saveRunRegression(db, request)])
    expect(db.rows.size).toBe(1)
    expect(results.map(r => r.existing).sort()).toEqual([false, true])
  })
  it.each([{ appId: 'other-app' }, { input: '' }, { expectation: '' }, { type: 'unknown' }])('rejects invalid regression requests: %j', async patch => {
    const db = database()
    await expect(saveRunRegression(db, { ...request, ...patch })).rejects.toThrow()
    expect(db.writes).toBe(0)
  })
  it('does not overwrite coverage when the read fails', async () => {
    const db = database({ readError: { message: 'Read unavailable' } })
    await expect(saveRunRegression(db, request)).rejects.toThrow('Read unavailable')
    expect(db.writes).toBe(0)
  })
  it('reports persistence and access failures', async () => {
    await expect(saveRunRegression(database({ insertError: { message: 'Access denied' } }), request)).rejects.toThrow('Access denied')
  })
})
