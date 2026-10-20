// Monitor: production health from the server's run log (every real run —
// customers, API, triggers, website visitors; failures included). Only
// aggregates come back, never inputs or answers.
import { supabase } from '../supabase'
import { errorFromResponse } from './runStream'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
export const MONITOR_PERIODS = [[1, '24 hours'], [7, '7 days'], [30, '30 days'], [90, '90 days']]

async function get(path, fallback) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${API_URL}${path}`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  })
  if (!res.ok) throw await errorFromResponse(res, fallback)
  return res.json()
}

// { totals, daily, by_version, by_source, error_kinds, alerts, truncated }
export const getAppMonitor = (appId, days) => get(`/v1/apps/${appId}/monitor?days=${days}`, 'Could not load monitoring data')
// { apps: [{ app_id, totals, alerts }] } — only apps the caller can edit
export const getMonitorOverview = (appIds, days) =>
  get(`/v1/monitor?days=${days}&app_ids=${appIds.map(encodeURIComponent).join(',')}`, 'Could not load monitoring data')

export const pct = rate => rate == null ? '—' : `${Math.round(rate * 1000) / 10}%`
export const duration = ms => ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
export const usd = value => value == null ? '—' : value < 0.01 && value > 0 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`

const SEVERITY = { critical: 0, warning: 1, info: 2 }
export const sortAlerts = alerts => [...(alerts || [])].sort((a, b) => (SEVERITY[a.level] ?? 3) - (SEVERITY[b.level] ?? 3))

export const SOURCE_LABELS = { app: 'Signed-in users', embed: 'Website visitors', api: 'API', trigger: 'Triggers' }
export const ERROR_LABELS = {
  timeout: 'Timed out', provider_error: 'AI provider error', rate_limit: 'Provider rate limit or credit',
  auth: 'Invalid AI key', permission: 'Key lacks model access', bad_request: 'Prompt or settings rejected',
  refusal: 'Model declined', contract: 'Output format not met', unexpected: 'Unexpected server error', unknown: 'Unknown',
}
