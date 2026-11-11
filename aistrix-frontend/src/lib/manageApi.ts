import { isRecord } from '../types/domain'
import { supabase } from '../supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
// The server no longer accepts this sign-in (expired, or signed out elsewhere).
const SIGNED_OUT = 'Your sign-in has ended. Sign out and sign in again to continue.'

export function manageRequest(path: string, options?: RequestInit): Promise<Record<string, unknown>>
export function manageRequest<T>(path: string, options: RequestInit, decode: (data: Record<string, unknown>) => T): Promise<T>
export async function manageRequest<T>(path: string, options: RequestInit = {}, decode?: (data: Record<string, unknown>) => T): Promise<T | Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sign in again to view or manage this information.')
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers, Authorization: `Bearer ${session.access_token}` } })
  const text = await response.text()
  let parsed: unknown
  try { parsed = text ? JSON.parse(text) : {} }
  catch { throw new Error('The server returned an invalid response. Please retry.') }
  if (!isRecord(parsed)) throw new Error('The server returned an invalid response. Please retry.')
  const data = parsed
  if (response.status === 401) throw new Error(typeof data.detail === 'string' && /different environment/.test(data.detail) ? data.detail : SIGNED_OUT)
  if (!response.ok) throw Object.assign(new Error(typeof data.detail === 'string' ? data.detail : typeof data.error === 'string' ? data.error : 'This information could not be loaded.'), {
    status: response.status, code: data.code, problems: Array.isArray(data.problems) ? data.problems : undefined, step: data.step,
  })
  if (!options.method || options.method === 'GET') {
    if (path.endsWith('/secrets') && !Array.isArray(data.secrets)) throw new Error('Secret metadata could not be verified. Please retry before making changes.')
    if (path.split('?')[0] === '/stripe/earnings' && (!['total_gross', 'total_dev_share', 'total_pending'].every(key => typeof data[key] === 'number' && Number.isFinite(data[key])) || !Array.isArray(data.by_app) || !Array.isArray(data.recent))) {
      throw new Error('The revenue response is incomplete. Please retry.')
    }
  }
  return decode ? decode(data) : data
}

// Downloads a file the server generates for the signed-in developer (e.g. the revenue CSV).
export async function downloadManageFile(path: string, fallbackName: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sign in again to download this file.')
  const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
  if (response.status === 401) throw new Error(SIGNED_OUT)
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(typeof data.detail === 'string' ? data.detail : 'The file could not be downloaded.')
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || fallbackName
  const url = URL.createObjectURL(await response.blob())
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
