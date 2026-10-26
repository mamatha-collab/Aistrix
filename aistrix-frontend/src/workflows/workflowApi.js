import { supabase } from '../supabase'
import { scopeToWorkspace } from '../lib/workspace'
import { manageRequest } from '../lib/manageApi'
import { DEFAULT_TRIGGER, withStepIds } from './workflowModel'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const COLUMNS = '*'
const MIGRATION_HINT = 'Workflows need the latest database update (migration 20261022010000_developer_workflows).'
const friendly = error => (/kind|trigger/.test(error?.message || '') && /column/.test(error?.message || '') ? MIGRATION_HINT : error?.message || 'Something went wrong')
export const isWiredWorkflow = flow => flow?.kind === 'developer'
export const normalizeWorkflow = row => ({ ...row, trigger: row.trigger || DEFAULT_TRIGGER, steps: isWiredWorkflow(row) ? withStepIds(row.steps || []) : (row.steps || []) })

// Both modes operate on the same records. kind describes a saved execution
// format, not ownership by a UI mode; legacy memory flows remain compatible.
export async function listWorkflows(user, { kind } = {}) {
  let query = scopeToWorkspace(supabase.from('flows').select(COLUMNS), user)
  if (kind) query = query.eq('kind', kind)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw new Error(friendly(error))
  return (data || []).map(normalizeWorkflow)
}

// Workflows (of this person's workspace) that have a step running this app.
// A string is what PostgREST needs to match inside a JSON array of objects.
export async function workflowsUsingApp(user, appId) {
  const { data, error } = await scopeToWorkspace(supabase.from('flows').select('id, name, kind, webhook_token'), user)
    .contains('steps', JSON.stringify([{ app_id: appId }]))
  if (error) throw new Error(friendly(error))
  return data || []
}

function check(error) {
  if (error) throw new Error(/flows_user_name_unique|duplicate/.test(error.message) ? 'You already have a workflow with that name.' : friendly(error))
}

export async function createWorkflowRecord(user, fields) {
  const { data, error } = await supabase.from('flows')
    .insert({ kind: 'business', ...fields, user_id: user.id })
    .select(COLUMNS).single()
  check(error)
  return normalizeWorkflow(data)
}

export const createWorkflow = (user, name, from = null) => createWorkflowRecord(user, {
  name, kind: from?.kind || 'developer', emoji: from?.emoji || '🔀', description: from?.description || '',
  steps: from?.steps || [], trigger: from?.trigger || DEFAULT_TRIGGER,
})

export async function updateWorkflowRecord(id, fields) {
  const { data, error } = await supabase.from('flows').update(fields).eq('id', id).select(COLUMNS)
  check(error)
  if (!data?.length) throw new Error('This workflow was deleted or you no longer have access to it. Reload to see your workflows.')
  return normalizeWorkflow(data[0])
}

// Thrown when someone else saved the workflow after it was opened. `current`
// is their version, so the editor can show it instead of overwriting it.
export class WorkflowConflict extends Error {
  constructor(current) {
    super('Someone saved this workflow before you. Their version is shown now; your latest edits were not saved.')
    this.name = 'WorkflowConflict'
    this.current = current
  }
}

// Saves what the editor edits. Rows that carry a revision (database update
// 20261025040000) only save if nobody changed them since they were opened.
export async function saveWorkflow(flow) {
  let query = supabase.from('flows').update({ name: flow.name.trim(), steps: flow.steps, trigger: flow.trigger }).eq('id', flow.id)
  if (typeof flow.revision === 'number') query = query.eq('revision', flow.revision)
  const { data, error } = await query.select(COLUMNS)
  check(error)
  if (data?.length) return normalizeWorkflow(data[0])
  if (typeof flow.revision === 'number') {
    const { data: current } = await supabase.from('flows').select(COLUMNS).eq('id', flow.id).maybeSingle()
    if (current) throw new WorkflowConflict(normalizeWorkflow(current))
  }
  throw new Error('This workflow was deleted or you no longer have access to it. Reload to see your workflows.')
}

export async function deleteWorkflow(id) {
  const { error } = await supabase.from('flows').delete().eq('id', id)
  check(error)
}

export async function setWebhook(id, on) {
  const token = on ? crypto.randomUUID() : null
  await updateWorkflowRecord(id, { webhook_token: token })
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

export const startRun = (flowId, input, { live = false } = {}) =>
  manageRequest(`/v1/flows/${flowId}/runs`, { method: 'POST', body: JSON.stringify({ input, live }) })

export const getRun = (flowId, runId) => manageRequest(`/v1/flows/${flowId}/runs/${runId}`)

export const listRuns = flowId => manageRequest(`/v1/flows/${flowId}/runs?limit=30`).then(r => r.runs || [])

export const cancelRun = (flowId, runId) => manageRequest(`/v1/flows/${flowId}/runs/${runId}/cancel`, { method: 'POST' })

export const getSchedule = flowId => manageRequest(`/v1/flows/${flowId}/schedule`).then(r => r.schedule || null)
export const putSchedule = (flowId, schedule) =>
  manageRequest(`/v1/flows/${flowId}/schedule`, { method: 'PUT', body: JSON.stringify(schedule) }).then(r => r.schedule)
export const deleteSchedule = flowId => manageRequest(`/v1/flows/${flowId}/schedule`, { method: 'DELETE' })

export const resumeRun = (flowId, runId, decision) =>
  manageRequest(`/v1/flows/${flowId}/runs/${runId}/resume`, { method: 'POST', body: JSON.stringify(decision) })
