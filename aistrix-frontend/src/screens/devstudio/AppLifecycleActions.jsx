import { useEffect, useState } from 'react'
import { manageRequest } from '../../lib/manageApi'
import { workflowsUsingApp } from '../../workflows/workflowApi'
import ConfirmDialog from '../../components/ConfirmDialog'

export default function AppLifecycleActions({ app, user, onDeleted, disabled }) {
  const [open, setOpen] = useState(false)
  const [dependencies, setDependencies] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    setDependencies(null); setError(''); setName('')
    workflowsUsingApp(user, app.id).then(rows => { if (active) setDependencies(rows) }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [open, app.id, user])
  if (app.created_by !== user.id) return null
  return <div className="space-y-2 text-xs">
    <button disabled={disabled || app.is_published || app.status === 'pending'} onClick={() => setOpen(true)} className="text-red-300 disabled:text-slate-500">Delete app</button>
    {(app.is_published || app.status === 'pending') && <p className="text-slate-400">Take the app offline in Deploy before deleting it.</p>}
    {open && <ConfirmDialog title={`Delete ${app.name}?`} confirmLabel="Delete app permanently" busyLabel="Deleting…" danger confirmDisabled={name !== app.name || !dependencies || dependencies.length > 0 || !!error} onCancel={() => setOpen(false)} onConfirm={async () => {
      try { await manageRequest(`/v1/apps/${app.id}`, { method: 'DELETE', body: JSON.stringify({ confirm_name: name }) }); setOpen(false); onDeleted?.(app.id) }
      catch (error) { setError(error.message) }
    }}>
      <p>The app, tools, saved tests and versions will be deleted. This cannot be undone here. The server also verifies that no workflows or active customer access depend on it.</p>
      {dependencies === null && !error && <p className="mt-2">Checking workflows…</p>}
      {dependencies?.length > 0 && <p className="mt-2">Remove this app from these workflows first: {dependencies.map(flow => flow.name).join(', ')}.</p>}
      {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
      <label className="mt-3 block">Type {app.name} to confirm<input aria-label="App name to confirm deletion" value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0E1424] p-2 text-white" /></label>
    </ConfirmDialog>}
  </div>
}
