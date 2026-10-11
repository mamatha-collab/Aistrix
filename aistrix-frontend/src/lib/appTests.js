// Run one Dev Studio test on the server (POST /v1/apps/{id}/tests/run): the
// real app path, graded server-side, recorded for the current draft.
import { supabase } from '../supabase'
import { errorFromResponse } from './runStream'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// testCase: { source, case_ref, label, input, checks, persona? }
// → { passed, errors, output, latency_ms, input_tokens, output_tokens, cost_usd, ... }
export async function runAppTest(appId, testCase, { signal } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${API_URL}/v1/apps/${appId}/tests/run`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify(testCase),
  })
  if (!res.ok) throw await errorFromResponse(res, 'Could not run the test')
  return res.json()
}

// Test Suite rules ({type, value}) are graded server-side as checks as-is.
export const rulesToChecks = rules => (rules || []).map(r => ({ type: r.type, value: r.value ?? '' }))
