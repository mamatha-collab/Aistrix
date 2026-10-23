import { supabase } from '../supabase'
import { scopeToWorkspace } from '../lib/workspace'
import { manageRequest } from '../lib/manageApi'
import { DEFAULT_TRIGGER, withStepIds } from './workflowModel'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const COLUMNS = 'id, name, emoji, steps, trigger, kind, webhook_token, user_id, workspace_id, created_at'

const MIGRATION_HINT = 'Workflows need the latest database update (migration 20261022010000_developer_workflows).'
const friendly = error => (/kind|trigger/.test(error?.message || '') && /column/.test(error?.message || '') ? MIGRATION_HINT : error?.message || 'Something went wrong')

const normalize = row => ({ ...row, trigger: row.trigger || DEFAULT_TRIGGER, steps: withStepIds(row.steps || []) })

export async function listWorkflows(user) {
  const { data, error } = await scopeToWorkspace(supabase.from('flows').select(COLUMNS), user)
    .eq('kind', 'developer').order('created_at', { ascending: false })
  if (error) throw new Error(friendly(error))
  return (data || []).map(normalize)
}

export async function createWorkflow(user, name, from = null) {
  const { data, error } = await supabase.from('flows')
    .insert({ user_id: user.id, name, kind: 'developer', emoji: '🔀', steps: from?.steps || [], trigger: from?.trigger || DEFAULT_TRIGGER })
    .select(COLUMNS).single()
  if (error) throw new Error(/flows_user_name_unique|duplicate/.test(error.message) ? 'You already have a workflow with that name.' : friendly(error))
  return normalize(data)
}

export async function saveWorkflow(flow) {
  const { data, error } = await supabase.from('flows')
    .update({ name: flow.name.trim(), steps: flow.steps, trigger: flow.trigger })
    .eq('id', flow.id).select(COLUMNS)
  if (error) throw new Error(/flows_user_name_unique|duplicate/.test(error.message) ? 'You already have a workflow with that name.' : friendly(error))
  if (!data?.length) throw new Error('This workflow was deleted or you no longer have access to it. Reload to see your workflows.')
  return normalize(data[0])
}

export async function deleteWorkflow(id) {
  const { error } = await supabase.from('flows').delete().eq('id', id)
  if (error) throw new Error(friendly(error))
}

export async function setWebhook(id, on) {
  const token = on ? crypto.randomUUID() : null
  const { error } = await supabase.from('flows').update({ webhook_token: token }).eq('id', id)
  if (error) throw new Error(friendly(error))
  return token
}

export const webhookUrl = token => `${API_URL}/webhooks/${token}`

// Schemas per app version, cached for the session (releases don't change).
const schemaCache = new Map()
export async function fetchSchema(appId, version) {
  const key = `${appId}@${version}`
  if (version !== 'draft' && schemaCache.has(key)) return schemaCache.get(key)
  const data = await manageRequest(`/v1/apps/${appId}/schema?version=${encodeURIComponent(version)}`)
  if (version !== 'draft') schemaCache.set(key, data)
  return data
}

export const fetchVersions = appId => manageRequest(`/v1/apps/${appId}/versions`)

export const startRun = (flowId, input) =>
  manageRequest(`/v1/flows/${flowId}/runs`, { method: 'POST', body: JSON.stringify({ input }) })

export const getRun = (flowId, runId) => manageRequest(`/v1/flows/${flowId}/runs/${runId}`)

export const listRuns = flowId => manageRequest(`/v1/flows/${flowId}/runs?limit=30`).then(r => r.runs || [])

export const cancelRun = (flowId, runId) => manageRequest(`/v1/flows/${flowId}/runs/${runId}/cancel`, { method: 'POST' })

export const getSchedule = flowId => manageRequest(`/v1/flows/${flowId}/schedule`).then(r => r.schedule || null)
export const putSchedule = (flowId, schedule) =>
  manageRequest(`/v1/flows/${flowId}/schedule`, { method: 'PUT', body: JSON.stringify(schedule) }).then(r => r.schedule)
export const deleteSchedule = flowId => manageRequest(`/v1/flows/${flowId}/schedule`, { method: 'DELETE' })

export const resumeRun = (flowId, runId, decision) =>
  manageRequest(`/v1/flows/${flowId}/runs/${runId}/resume`, { method: 'POST', body: JSON.stringify(decision) })
