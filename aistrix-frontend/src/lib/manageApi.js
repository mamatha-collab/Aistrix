import { supabase } from '../supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export async function manageRequest(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sign in again to view or manage this information.')
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { Authorization: `Bearer ${session.access_token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } })
  const text = await response.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} }
  catch { throw new Error('The server returned an invalid response. Please retry.') }
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.error || 'This information could not be loaded.')
  if (!options.method || options.method === 'GET') {
    if (path.endsWith('/secrets') && !Array.isArray(data.secrets)) throw new Error('Secret metadata could not be verified. Please retry before making changes.')
    if (path === '/stripe/earnings' && (!['total_gross', 'total_dev_share', 'total_pending'].every(key => typeof data[key] === 'number' && Number.isFinite(data[key])) || !Array.isArray(data.by_app) || !Array.isArray(data.recent))) {
      throw new Error('The revenue response is incomplete. Please retry.')
    }
  }
  return data
}

