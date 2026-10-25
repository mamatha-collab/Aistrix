import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ rows: [], writes: [], calls: [], error: null }))
vi.mock('../supabase', () => ({ supabase: { from(table) {
  let id, kind, payload, operation = 'read'
  const result = () => ({ data: operation === 'insert' ? { id: 'new', ...payload } : state.rows.filter(row => (!id || row.id === id) && (!kind || row.kind === kind)), error: state.error })
  const q = {
    select() { return q },
    eq(key, value) { state.calls.push([key, value]); if (key === 'id') id = value; if (key === 'kind') kind = value; return q },
    order() { return Promise.resolve(result()) },
    insert(fields) { operation = 'insert'; payload = fields; state.writes.push(fields); return q },
    update(fields) { state.writes.push(fields); return q },
    single() { return Promise.resolve(result()) },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
  }
  return q
} } }))
vi.mock('../lib/manageApi', () => ({ manageRequest: vi.fn().mockResolvedValue({}) }))
import { manageRequest } from '../lib/manageApi'
import { createWorkflow, createWorkflowRecord, listWorkflows, normalizeWorkflow, setWebhook, startRun, updateWorkflowRecord } from './workflowApi'
import { setActiveWorkspaceId } from '../lib/workspace'

beforeEach(() => { state.rows = []; state.writes = []; state.calls = []; state.error = null; setActiveWorkspaceId(null); vi.clearAllMocks() })
describe('shared workflow records', () => {
  it('Business lists both saved formats in the active workspace', async () => {
    setActiveWorkspaceId('team')
    state.rows = [{ id: 'wired', kind: 'developer', steps: [{ app_id: 'a' }] }, { id: 'legacy', steps: [{ app_id: 'b', input_template: '{{previous_output}}' }] }]
    const rows = await listWorkflows({ id: 'owner' })
    expect(rows.map(row => row.id)).toEqual(['wired', 'legacy'])
    expect(state.calls).toContainEqual(['workspace_id', 'team'])
    expect(state.calls.some(([field]) => field === 'kind')).toBe(false)
    expect(rows[1].steps[0].input_template).toBe('{{previous_output}}')
  })
  it('the wired editor explicitly selects its supported format', async () => {
    state.rows = [{ id: 'a', kind: 'developer' }, { id: 'b', kind: 'business' }]
    expect((await listWorkflows({ id: 'u' }, { kind: 'developer' })).map(row => row.id)).toEqual(['a'])
    expect(state.calls).toContainEqual(['user_id', 'u'])
  })
  it('cloning retains execution format, trigger and description without copying secrets or ownership', async () => {
    const row = await createWorkflow({ id: 'new-owner' }, 'Copy', { kind: 'developer', description: 'Invoice', steps: [], trigger: { fields: [{ field: 'invoice' }] }, webhook_token: 'secret', user_id: 'old-owner' })
    expect(row.user_id).toBe('new-owner')
    expect(row.trigger.fields[0].field).toBe('invoice')
    expect(row.description).toBe('Invoice')
    expect(state.writes[0]).not.toHaveProperty('webhook_token')
    expect((await createWorkflowRecord({ id: 'u' }, { name: 'Legacy' })).kind).toBe('business')
  })
  it('refuses silent saves and webhook changes when the row is gone', async () => {
    await expect(updateWorkflowRecord('missing', { name: 'Lost' })).rejects.toThrow('deleted')
    await expect(setWebhook('missing', false)).rejects.toThrow('deleted')
  })
  it('routes Business and Developer execution through the same API with explicit release semantics', async () => {
    await startRun('flow', 'input', { live: true })
    expect(JSON.parse(manageRequest.mock.calls[0][1].body)).toEqual({ input: 'input', live: true })
    await startRun('flow', 'sample')
    expect(JSON.parse(manageRequest.mock.calls[1][1].body).live).toBe(false)
  })
  it('preserves IDs and custom metadata on wired records', () => {
    const row = normalizeWorkflow({ id: 'a', kind: 'developer', description: 'Keep', steps: [{ id: 'stable', app_id: 'a' }, { app_id: 'b' }] })
    expect(row.description).toBe('Keep')
    expect(row.steps[0].id).toBe('stable')
    expect(row.steps[1].id).toBeTruthy()
  })
})
