import { useState } from 'react'
import { useManageRecord } from '../hooks/useManageRecord'
import { manageRequest } from '../lib/manageApi'
import ConfirmDialog from './ConfirmDialog'

const card = 'rounded-2xl border border-white/8 bg-[#171B33] p-4'
const button = 'min-h-11 rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40'
const field = 'w-full min-h-11 rounded-xl border border-white/10 bg-[#0E1424] px-3 text-sm text-white'
export default function AppSecretsPanel({ appId, user }) {
  const path = appId ? `/apps/${encodeURIComponent(appId)}/secrets` : null
  const { data, loading, error, refresh } = useManageRecord(path, user.id)
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  const [success, setSuccess] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [formOpen, setFormOpen] = useState(false)

  async function save() {
    setSaving(true); setProblem(''); setSuccess('')
    try {
      await manageRequest(path, { method: 'PUT', body: JSON.stringify({ key: key.trim(), value }) })
      setSuccess(`${key.trim()} saved`); setKey(''); setValue(''); refresh()
    } catch (e) { setProblem(e.message) }
    finally { setSaving(false); setConfirming(false) }
  }
  async function remove() {
    setSaving(true); setProblem(''); setSuccess('')
    try {
      await manageRequest(`${path}/${encodeURIComponent(removing)}`, { method: 'DELETE' })
      setSuccess(`${removing} removed`); refresh()
    } catch (e) { setProblem(e.message) }
    finally { setSaving(false); setRemoving(null) }
  }
  if (!appId) return <p className="text-sm text-slate-400">Choose an app to manage secrets.</p>
  return <section aria-label="App secrets" className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-white font-semibold">Secrets</h2><button className={button} onClick={refresh} disabled={loading || saving}>Refresh secrets</button></div>
    <p className="text-xs text-slate-400">Values stay hidden after saving. Only secret names and update dates are shown here.</p>
    {loading && <p role="status" className="text-sm text-slate-400">Loading secrets…</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {data?.warning && <p role="alert" className="text-sm text-amber-200">{data.warning}</p>}
    {problem && <p role="alert" className="text-sm text-amber-200">{problem}</p>}
    {!!data?.missing?.length && <div role="alert" className={`${card} border-amber-500/30 space-y-2`}>
      <p className="text-sm text-amber-200 font-semibold">Missing secrets: this app can't be published until they're added</p>
      {data.missing.map(m => <div key={m.key} className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-mono text-amber-100 break-all">{m.key}</span>
        <span className="flex-1 min-w-32 text-xs text-slate-400">used by {m.used_by.join(', ')}</span>
        <button className={button} onClick={() => { setKey(m.key); setValue(''); setSuccess(''); setFormOpen(true) }}>Add</button>
      </div>)}
    </div>}
    {data && !data.warning && <div className="space-y-2">{data.secrets?.length ? data.secrets.map(secret => <div key={secret.key} className={`${card} flex items-center gap-3`}><div className="min-w-0 flex-1"><p className="font-mono text-sm text-[#A29BFE] break-all">{secret.key}</p><p className="text-xs text-slate-400 mt-2">Value hidden · {secret.updated_at ? `Updated ${new Date(secret.updated_at).toLocaleDateString()}` : 'Update date not recorded'}</p><p className="text-xs text-slate-500 mt-1">{secret.used_by?.length ? `Used by ${secret.used_by.join(', ')}` : 'Not used by any tool yet'}</p></div><button className={`${button} !text-red-300 shrink-0`} aria-label={`Remove ${secret.key}`} disabled={saving || loading} onClick={() => setRemoving(secret.key)}>Remove</button></div>) : <p className="text-sm text-slate-400">No secrets configured for this app.</p>}</div>}
    {success && <p role="status" className="text-sm text-emerald-300">{success}</p>}
    <details className={card} open={formOpen} onToggle={e => setFormOpen(e.currentTarget.open)}><summary className="min-h-7 cursor-pointer font-semibold text-sm text-white">Add or replace a secret</summary><div className="mt-4 space-y-3">
      <label className="block text-xs text-slate-400">Secret name<input aria-label="Secret name" className={`${field} mt-1`} autoCapitalize="characters" value={key} onChange={e => { setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')); setSuccess('') }} /></label>
      <label className="block text-xs text-slate-400">New value<input aria-label="Secret value" type="password" autoComplete="new-password" className={`${field} mt-1`} value={value} onChange={e => setValue(e.target.value)} /></label>
      <button className={`${button} !bg-[#6C5CE7] w-full`} disabled={saving || loading || !!error || !!data?.warning || !key.trim() || !value.trim()} onClick={() => data?.secrets?.some(s => s.key === key.trim()) ? setConfirming(true) : save()}>{saving ? 'Saving…' : 'Save secret'}</button>
    </div></details>
    {confirming && <ConfirmDialog title={`Replace ${key.trim()}?`} confirmLabel="Replace secret" busyLabel="Replacing…" onCancel={() => setConfirming(false)} onConfirm={save}>Tools using this secret will use the new value. The current value cannot be recovered here.</ConfirmDialog>}
    {removing && <ConfirmDialog title={`Remove ${removing}?`} confirmLabel="Remove secret" busyLabel="Removing…" danger onCancel={() => setRemoving(null)} onConfirm={remove}>Tools that depend on this secret may stop working. Its value cannot be recovered after removal.</ConfirmDialog>}
  </section>
}

