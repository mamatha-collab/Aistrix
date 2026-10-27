import { useEffect, useState } from 'react'
import { fetchSchema } from '../../workflows/workflowApi'

const field = 'mt-1 w-full rounded-lg border border-white/10 bg-[#0E1424] px-3 py-2 text-xs text-white'

export default function ExecutionContract({ app, bp, onChange }) {
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    fetchSchema(app.id, 'draft').then(result => { if (active) { setSaved(result.contract); setError('') } }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [app.id, refresh])
  const contract = bp.contract || {}
  const set = (key, value) => {
    const next = { ...contract }
    if (value === '') delete next[key]; else next[key] = value
    onChange({ ...bp, contract: next })
  }
  return <section aria-label="Execution permissions" className="space-y-3 rounded-2xl border border-white/10 bg-[#171B33] p-5">
    <h3 className="text-sm font-semibold text-white">Execution permissions</h3>
    <p className="text-xs text-slate-400">Declare what this app handles and may change. The server checks its actual tools and refuses a declaration that understates their access. Confidential is a data label; use a private-only workflow to restrict outbound execution.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs text-slate-300">Data classification<select aria-label="Data classification" value={contract.data_class || ''} onChange={event => set('data_class', event.target.value)} className={field}><option value="">Default (standard)</option><option value="standard">Standard</option><option value="confidential">Confidential</option></select></label>
      <label className="text-xs text-slate-300">External actions<select aria-label="External actions" value={contract.side_effects || ''} onChange={event => set('side_effects', event.target.value)} className={field}><option value="">Derive from tools</option><option value="none">No external access</option><option value="external_read">Read external services</option><option value="external_write">Change external services</option></select></label>
      <label className="text-xs text-slate-300">Timeout (seconds)<input aria-label="Execution timeout (seconds)" type="number" min="5" step="1" placeholder="Server default" value={contract.timeout_seconds ?? ''} onChange={event => set('timeout_seconds', event.target.value === '' ? '' : Number(event.target.value))} className={field} /></label>
    </div>
    <p className="text-[11px] text-slate-400">Save the blueprint to apply these declarations. The server's configured timeout is the upper limit.</p>
    {['cli', 'container', 'webui'].includes(bp.deployment?.runtime_type) && <p className="text-xs text-amber-200">These runtime settings are a deployment plan. Uploading code does not deploy it; custom-code hosting is not available from this Build screen yet.</p>}
    <button className="text-xs text-[#A29BFE] hover:underline" onClick={() => setRefresh(value => value + 1)}>Refresh saved permissions</button>
    {error && <p role="alert" className="text-xs text-amber-200">Saved permissions could not be verified: {error}</p>}
    {saved && !error && <div className="space-y-1 text-xs text-slate-300">
      <p>Saved model route: {saved.privacy?.model_route === 'private' ? 'Approved private model' : 'External provider'} · Tool access: {saved.side_effects || 'Unverified'}</p>
      <p>Required secret names: {saved.auth?.secrets?.join(', ') || 'None declared'}</p>
      <p className="break-words">External tool destinations: {saved.privacy?.external_destinations?.join(', ') || 'None declared'}</p>
    </div>}
  </section>
}
