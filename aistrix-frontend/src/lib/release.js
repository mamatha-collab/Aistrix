// Draft → production. Publishing (and promoting a new draft) goes through
// the backend: it runs the publish checks and requires passing tests for
// the current draft, then saves the live version end users run.
import { supabase } from '../supabase'
import { RunError, errorFromResponse } from './runStream'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function headers() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

// → { ok, promoted_at, ... }. Throws a RunError whose message lists what's
// missing (publish checks and tests) when the app isn't ready.
export async function publishApp(appId) {
  const res = await fetch(`${API_URL}/v1/apps/${appId}/promote`, { method: 'POST', headers: await headers() })
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}))
    const problems = [...(body.checks || []), ...(body.test_problems || [])]
    throw new RunError(problems.length ? `${body.error || 'Not ready to publish yet'}: ${problems.join('; ')}` : (body.error || 'Not ready to publish yet'),
      { status: 409, errors: problems, kind: 'validation' })
  }
  if (!res.ok) throw await errorFromResponse(res, 'Could not publish')
  return res.json()
}

// Unpublishing stays a direct, gate-free action.
export async function unpublishApp(appId) {
  const { data, error } = await supabase.rpc('set_app_published_with_gate', { p_app_id: appId, p_publish: false })
  if (error) throw new Error(error.message)
  const result = Array.isArray(data) ? data[0] : data
  if (!result?.ok) throw new Error((result?.errors || ['Could not unpublish']).join('; '))
}

// { is_published, promoted_at, has_live_version, has_changes, checks, tests, test_problems, ready }
export async function getRelease(appId) {
  const res = await fetch(`${API_URL}/v1/apps/${appId}/release`, { headers: await headers() })
  if (!res.ok) throw await errorFromResponse(res, 'Could not load release status')
  return res.json()
}

// Published versions, newest first: { versions: [{ version_num, created_at,
// changelog, tests: { passed, total }, is_live }], live_version, is_published }
export async function listVersions(appId) {
  const res = await fetch(`${API_URL}/v1/apps/${appId}/versions`, { headers: await headers() })
  if (!res.ok) throw await errorFromResponse(res, 'Could not load versions')
  return res.json()
}

// Make an earlier published version live again (the draft isn't changed).
export async function rollbackVersion(appId, versionNum) {
  const res = await fetch(`${API_URL}/v1/apps/${appId}/versions/${versionNum}/rollback`, { method: 'POST', headers: await headers() })
  if (!res.ok) throw await errorFromResponse(res, 'Could not roll back')
  return res.json()
}
