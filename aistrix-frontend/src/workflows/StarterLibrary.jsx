import { useState } from 'react'
import { manageRequest } from '../lib/manageApi'
import ConfirmDialog from '../components/ConfirmDialog'

export default function StarterLibrary({ onInstalled, onBeforeInstall }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [deliveries, setDeliveries] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [clear, setClear] = useState(false)
  async function load() {
    setOpen(true); setBusy(true); setError('')
    try {
      const [catalog, destinations, captured] = await Promise.all([
        manageRequest('/v1/reference-workflows'), manageRequest('/v1/test-destinations'), manageRequest('/v1/test-deliveries'),
      ])
      if (!Array.isArray(catalog.workflows) || !Array.isArray(destinations.destinations) || !Array.isArray(destinations.datasets) || !Array.isArray(captured.deliveries)) throw new Error('The starter library response could not be verified.')
      setData({ ...catalog, ...destinations }); setDeliveries(captured.deliveries)
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  async function install(key) {
    setBusy(true); setError(''); setNotice('')
    try {
      if (onBeforeInstall && !await onBeforeInstall()) return
      const result = await manageRequest(`/v1/reference-workflows/${encodeURIComponent(key)}/install`, { method: 'POST' })
      if (!result.flow_id) throw new Error('The installation response could not be verified. Refresh your workflows before trying again.')
      await onInstalled(result)
      setNotice(`Installed ${result.name} as drafts. Tests use real AI keys; sample deliveries go to your test destinations.`)
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); setNotice('Test URL copied.') }
    catch { setNotice('Select the URL and copy it from the field.') }
  }
  return <section aria-label="Starter library" className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-3 text-left">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white">Starter workflows & test destinations</h3><button disabled={busy} onClick={() => open ? setOpen(false) : load()} className="text-xs text-[#A29BFE]">{open ? 'Hide library' : 'Open library'}</button></div>
    <p className="text-xs text-slate-400">Start with a working example and sample data. Test destinations capture deliveries instead of contacting real customer systems. AI tests still use your keys.</p>
    {open && <>
      <button onClick={load} disabled={busy} className="text-xs text-[#A29BFE]">{busy ? 'Working…' : 'Refresh library and deliveries'}</button>
      {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
      {notice && <p role="status" className="text-xs text-green-300">{notice}</p>}
      {data && <>
        <div className="grid gap-3 lg:grid-cols-3">{data.workflows.map(workflow => <article key={workflow.key} className="space-y-2 rounded-xl border border-white/10 p-3">
          <h4 className="text-sm font-semibold text-white">{workflow.emoji} {workflow.name}</h4><p className="text-xs text-slate-400">{workflow.description}</p>
          <details className="text-xs text-slate-300"><summary className="cursor-pointer">Steps and sample input</summary><ol className="my-2 list-decimal pl-4">{workflow.steps?.map((step, index) => <li key={index}>{step}</li>)}</ol><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{workflow.sample_input}</pre></details>
          <button disabled={busy || !!error} onClick={() => install(workflow.key)} className="rounded-lg bg-[#6C5CE7] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Install draft workflow</button>
        </article>)}</div>
        <details className="text-xs text-slate-300"><summary className="cursor-pointer">Your test destinations and sample datasets</summary><div className="mt-2 space-y-3">{[...data.destinations, ...data.datasets].map(destination => <div key={destination.name}>
          <p className="font-semibold">{destination.name}</p><p className="text-slate-400">{destination.description}</p><div className="mt-1 flex gap-2"><input aria-label={`${destination.name} URL`} readOnly value={destination.url} className="min-w-0 flex-1 rounded-lg bg-[#0E1424] px-2 py-1 font-mono" /><button onClick={() => copy(destination.url)} className="text-[#A29BFE]">Copy URL</button></div>
        </div>)}</div></details>
        <details className="text-xs text-slate-300"><summary className="cursor-pointer">Captured test deliveries ({deliveries.length})</summary><p className="mt-2 text-slate-400">Use sample data. Captured request bodies are visible here to you.</p>
          {deliveries.length ? <><ul className="my-2 max-h-80 space-y-2 overflow-auto">{deliveries.map(delivery => <li key={delivery.id} className="rounded-lg border border-white/10 p-2"><p>{delivery.method} · {delivery.destination} · {new Date(delivery.created_at).toLocaleString()}</p><pre className="mt-1 whitespace-pre-wrap break-words">{delivery.body}</pre></li>)}</ul><button disabled={busy} onClick={() => setClear(true)} className="text-red-300">Clear captured deliveries</button></> : <p className="mt-2 text-slate-400">No deliveries yet. Run a starter workflow with its sample input, then refresh.</p>}
        </details>
      </>}
    </>}
    {clear && <ConfirmDialog title="Clear captured test deliveries?" confirmLabel="Clear deliveries" danger onCancel={() => setClear(false)} onConfirm={async () => {
      try { await manageRequest('/v1/test-deliveries', { method: 'DELETE' }); setDeliveries([]); setClear(false) }
      catch (error) { setError(error.message); setClear(false) }
    }}>Your captured request bodies will be deleted. Workflows and test URLs stay available.</ConfirmDialog>}
  </section>
}
