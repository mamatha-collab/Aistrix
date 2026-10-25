import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, Copy, Play, Plus, Trash2 } from 'lucide-react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { WorkflowCanvas, StepSettings } from '../../workflows/WorkflowDesigner'
import { WorkflowDeploy, WorkflowRuns, WorkflowTest } from '../../workflows/WorkflowRunPanels'
import { createWorkflow, deleteWorkflow, fetchSchema, saveWorkflow } from '../../workflows/workflowApi'
import { releaseProblems, schemaKey, schemaVersion, workflowIssues } from '../../workflows/workflowModel'

const card = 'rounded-2xl border border-white/8 bg-[#171B33] p-4 sm:p-5'
const primary = 'inline-flex items-center gap-1.5 rounded-xl bg-[#6C5CE7] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#7C6CFF] disabled:opacity-50'
const secondary = 'inline-flex items-center gap-1.5 rounded-xl border border-[#6C5CE7]/50 bg-transparent px-3.5 py-2 text-xs font-semibold text-[#C9C2FF] hover:bg-[#6C5CE7]/10 disabled:opacity-50'
const VIEWS = [['design', 'Design'], ['test', 'Test'], ['runs', 'Runs'], ['deploy', 'Deploy']]

// Workflow building lives in Developer (Business only runs workflows).
// A step uses an app's published release (fixed) or, for authorized
// testing only, its draft.
// Design: docs/flow-connections-design-2026-10-20.md
// The list lives in Dev Studio (the left panel shows it too): `workflows`
// is null while loading. `activeId` is the one to show; opening another
// here reports it through onActiveChange. `createSignal` changes when the
// left panel's + asks for a new workflow.
export function WorkflowsTab({ apps = [], user, workflows: list, setWorkflows: setList, loadError = '', activeId, onActiveChange, createSignal = 0, navigationGuardRef }) {
  const [flow, setFlow] = useState(null)
  const [saved, setSaved] = useState('')
  const [selected, setSelected] = useState('trigger')
  const [view, setView] = useState('design')
  const [schemas, setSchemas] = useState({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const snapshot = f => JSON.stringify({ name: f?.name, steps: f?.steps, trigger: f?.trigger })
  const dirty = !!flow && snapshot(flow) !== saved
  const open = f => { setFlow(f); setSaved(snapshot(f)); setSelected('trigger'); setMessage(''); onActiveChange?.(f?.id || null) }

  // Show the workflow picked in the left panel (or the first one).
  useEffect(() => {
    if (!list) return
    if (flow && flow.id === activeId) return
    const target = list.find(f => f.id === activeId) || (!flow ? list[0] : null)
    if (!target) return
    if (flow && dirty && !window.confirm('Switch workflows without saving? Your changes will be lost.')) { onActiveChange?.(flow.id); return }
    open(target)
  }, [activeId, list])   // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the Workflows tab (or Dev Studio) with unsaved changes asks first.
  useEffect(() => {
    if (!navigationGuardRef) return undefined
    const guard = () => !dirty || window.confirm('Leave without saving? Your workflow changes will be lost.')
    navigationGuardRef.current = guard
    const beforeUnload = event => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      if (navigationGuardRef.current === guard) navigationGuardRef.current = null
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [dirty, navigationGuardRef])

  const lastSignal = useRef(createSignal)
  useEffect(() => {
    if (createSignal === lastSignal.current || !list) return
    lastSignal.current = createSignal
    create()
  }, [createSignal, list])   // eslint-disable-line react-hooks/exhaustive-deps

  // Each step's fields come from the app version it runs.
  const neededKeys = useMemo(() => (flow?.steps || []).map(schemaKey).filter(Boolean), [flow?.steps])
  useEffect(() => {
    for (const step of flow?.steps || []) {
      const key = schemaKey(step)
      if (!key || key in schemas) continue
      setSchemas(prev => ({ ...prev, [key]: prev[key] }))
      fetchSchema(step.app_id, schemaVersion(step))
        .then(data => setSchemas(prev => ({ ...prev, [key]: data })))
        .catch(e => setSchemas(prev => ({ ...prev, [key]: { error: `Couldn't load this app's fields: ${e.message}` } })))
    }
  }, [neededKeys.join('|')])   // eslint-disable-line react-hooks/exhaustive-deps
  const loadedSchemas = useMemo(() => Object.fromEntries(Object.entries(schemas).filter(([, v]) => v)), [schemas])

  const switchTo = id => {
    if (dirty && !window.confirm('Switch workflows without saving? Your changes will be lost.')) return
    const next = list.find(f => f.id === id)
    if (next) open(next)
  }
  const save = async () => {
    setBusy(true); setMessage('')
    try {
      if (!flow.name.trim()) throw new Error('Give the workflow a name.')
      const row = await saveWorkflow(flow)
      setList(l => l.map(f => (f.id === row.id ? row : f)))
      setFlow(row); setSaved(snapshot(row))
      setMessage('Saved')
      return row
    } catch (e) { setMessage(e.message); throw e }
    finally { setBusy(false) }
  }
  const create = async () => {
    if (dirty && !window.confirm('Start a new workflow without saving? Your changes will be lost.')) return
    setBusy(true); setMessage('')
    try {
      const taken = new Set((list || []).map(f => f.name))
      let n = (list || []).length + 1
      while (taken.has(`Untitled workflow ${n}`)) n += 1
      const row = await createWorkflow(user, `Untitled workflow ${n}`)
      setList(l => [row, ...(l || [])]); open(row); setView('design')
    } catch (e) { setMessage(e.message) }
    finally { setBusy(false) }
  }
  const duplicate = async () => {
    if (dirty && !window.confirm('Duplicate the last saved version? Your unsaved changes stay here only.')) return
    setBusy(true); setMessage('')
    try {
      const source = list.find(f => f.id === flow.id) || flow
      const taken = new Set(list.map(f => f.name))
      let name = `${source.name} (copy)`
      for (let n = 2; taken.has(name); n += 1) name = `${source.name} (copy ${n})`
      const row = await createWorkflow(user, name, source)
      setList(l => [row, ...(l || [])]); open(row); setView('design')
    } catch (e) { setMessage(e.message) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    await deleteWorkflow(flow.id)
    const rest = list.filter(f => f.id !== flow.id)
    setList(rest); setConfirmDelete(false)
    if (rest[0]) open(rest[0]); else { setFlow(null); onActiveChange?.(null) }
  }

  if (list === null) return <p role="status" className="py-16 text-center text-sm text-slate-500">Loading workflows…</p>

  if (!flow) return (
    <section aria-label="Workflows" className={`${card} mx-auto max-w-xl space-y-3 text-center`}>
      <h2 className="text-base font-semibold text-white">Workflows</h2>
      <p className="text-sm text-slate-300">Connect your apps into one workflow: wire each app's fields to the next, test it with sample input, then turn on a webhook link.</p>
      {loadError && <p role="alert" className="text-xs text-amber-300">{loadError}</p>}
      <button className={primary} disabled={busy || !!loadError} onClick={create}><Plus size={14} /> New workflow</button>
      {message && <p role="alert" className="text-xs text-red-300">{message}</p>}
    </section>
  )

  const issues = workflowIssues(flow, loadedSchemas)
  const blocking = releaseProblems(flow, loadedSchemas)
  const live = !!flow.webhook_token

  return (
    <section aria-label="Workflows" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Workflow" value={flow.id} onChange={e => switchTo(e.target.value)}
          className="min-w-0 max-w-xs rounded-lg border border-white/10 bg-[#0E1424] px-2.5 py-1.5 text-xs text-white">
          {list.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10" disabled={busy} onClick={create}><Plus size={13} /> New</button>
        <button aria-label="Duplicate workflow" title="Duplicate workflow" disabled={busy} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-white" onClick={duplicate}><Copy size={14} /></button>
        <button aria-label="Delete workflow" title="Delete workflow" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-red-400" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /></button>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[14rem] flex-1">
            <div className="flex items-center gap-2">
              <input aria-label="Workflow name" value={flow.name} onChange={e => setFlow({ ...flow, name: e.target.value })}
                className="min-w-0 max-w-md flex-1 rounded-lg border border-transparent bg-transparent px-1 text-xl font-bold text-white hover:border-white/10 focus:border-[#6C5CE7] focus:outline-none" />
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${live ? 'border-green-500/25 bg-green-500/15 text-green-300' : 'border-amber-500/25 bg-amber-500/15 text-amber-300'}`}>
                {live ? 'Live' : 'Draft'}</span>
              {dirty && <span className="shrink-0 text-[11px] text-slate-400">Unsaved changes</span>}
            </div>
            <p className="mt-0.5 px-1 text-xs text-slate-400">Connect apps. Review results. Publish with confidence.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className={secondary} onClick={() => setView('test')}><Play size={13} /> Test workflow</button>
            <button className={primary} disabled={busy || !dirty} onClick={() => save().catch(() => {})}>{busy ? 'Saving…' : 'Save draft'}</button>
          </div>
        </div>

        {message && <p role="status" className={`mt-2 px-1 text-[11px] ${message === 'Saved' ? 'text-green-300' : 'text-red-300'}`}>{message}</p>}
        <nav aria-label="Workflow sections" className="mt-3 flex gap-1 border-b border-white/8">
          {VIEWS.map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold ${view === id ? 'border-[#6C5CE7] text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>{label}</button>
          ))}
        </nav>

        <div className="mt-4">
          {view === 'design' && (
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
              <div className="min-w-0 flex-1 space-y-3">
                <WorkflowCanvas flow={flow} apps={apps} schemas={loadedSchemas} selected={selected} onSelect={setSelected} onChange={setFlow} />
                {issues.length > 0 && (
                  <ul aria-label="Workflow problems" className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                    {issues.slice(0, 5).map((p, i) => (
                      <li key={i} className={`flex gap-1.5 text-[11px] ${p.level === 'error' ? 'text-red-200' : 'text-amber-200'}`}>
                        <CircleAlert size={13} className="mt-px shrink-0" aria-hidden="true" />
                        <button className="text-left hover:underline" onClick={() => p.step != null && setSelected(p.step)}>
                          {p.step != null ? `Step ${p.step + 2}: ` : ''}{p.text}</button>
                      </li>
                    ))}
                    {issues.length > 5 && <li className="pl-5 text-[11px] text-amber-200/80">and {issues.length - 5} more</li>}
                  </ul>
                )}
                {issues.length === 0 && blocking.length === 0 && flow.steps.length > 0 && (
                  <p className="text-[11px] text-green-300">Every step is connected and uses a published release.</p>
                )}
              </div>
              <StepSettings flow={flow} selected={selected === 'trigger' || flow.steps[selected] ? selected : 'trigger'}
                apps={apps} schemas={loadedSchemas} onChange={setFlow} onSelect={setSelected} />
            </div>
          )}
          {view === 'test' && <WorkflowTest flow={flow} dirty={dirty} onSave={save} />}
          {view === 'runs' && <WorkflowRuns key={flow.id} flow={flow} />}
          {view === 'deploy' && <WorkflowDeploy flow={flow} schemas={loadedSchemas} dirty={dirty}
            onTokenChange={token => { const row = { ...flow, webhook_token: token }; setFlow(row); setList(l => l.map(f => (f.id === row.id ? { ...f, webhook_token: token } : f))) }} />}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog title={`Delete "${flow.name}"?`} confirmLabel="Delete" busyLabel="Deleting…" danger
          onCancel={() => setConfirmDelete(false)} onConfirm={remove}>
          Its webhook link stops working. The apps it uses aren't changed.
        </ConfirmDialog>
      )}
    </section>
  )
}
