// Run one Dev Studio test on the server (POST /v1/apps/{id}/tests/run): the
// real app path, graded server-side, recorded for the current draft.
import { supabase } from '../supabase'
import { errorFromResponse } from './runStream'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const TEST_TIMEOUT_MS = 45000

function timeoutSignal(parentSignal) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('Test timed out', 'TimeoutError')), TEST_TIMEOUT_MS)
  const cleanup = () => clearTimeout(timer)
  if (parentSignal) {
    if (parentSignal.aborted) ctrl.abort(parentSignal.reason)
    else parentSignal.addEventListener('abort', () => ctrl.abort(parentSignal.reason), { once: true })
  }
  ctrl.signal.addEventListener('abort', cleanup, { once: true })
  return ctrl.signal
}

// testCase: { source, case_ref, label, input, checks, persona? }
// → { passed, errors, output, latency_ms, input_tokens, output_tokens, cost_usd, ... }
export async function runAppTest(appId, testCase, { signal } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  let res
  try {
    res = await fetch(`${API_URL}/v1/apps/${appId}/tests/run`, {
      method: 'POST', signal: timeoutSignal(signal),
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(testCase),
    })
  } catch (e) {
    if (e.name === 'AbortError' && signal?.aborted) throw e
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error('The test did not finish in time. Check the AI key/provider and try again.')
    }
    throw e
  }
  if (!res.ok) throw await errorFromResponse(res, 'Could not run the test')
  const body = await res.json()
  if (body.storage_error) {
    const msg = body.storage_error === 'missing_app_test_runs'
      ? 'Test ran, but Aistrix could not save the result because app_test_runs is missing. Run the staging migrations and reload the schema cache.'
      : 'Test ran, but Aistrix could not save the result. Check the staging app_test_runs schema/migration.'
    throw new Error(msg)
  }
  return body
}

// Test Suite rules ({type, value}) are graded server-side as checks as-is.
export const rulesToChecks = rules => (rules || []).map(r => ({ type: r.type, value: r.value ?? '' }))
