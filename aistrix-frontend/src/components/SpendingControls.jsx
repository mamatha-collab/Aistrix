import { useEffect, useState } from 'react'
import { manageRequest } from '../lib/manageApi'

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value)
const field = 'w-full rounded-lg border border-white/10 bg-[#0E1424] px-3 py-2 text-sm text-white'

function verifiedScope(scope) {
  if (!scope || !['day', 'month'].includes(scope.period) || !Number.isFinite(scope.used_usd) || scope.used_usd < 0
    || (scope.limit_usd !== null && (!Number.isFinite(scope.limit_usd) || scope.limit_usd < 0))) {
    throw new Error('Spending totals could not be verified. Refresh before changing limits.')
  }
  return scope
}

function CapForm({ title, description, scope, onSave, disabled }) {
  const [limit, setLimit] = useState(scope.limit_usd === null ? '' : String(scope.limit_usd))
  const [period, setPeriod] = useState(scope.period)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { setLimit(scope.limit_usd === null ? '' : String(scope.limit_usd)); setPeriod(scope.period) }, [scope])
  async function save(event) {
    event.preventDefault()
    const amount = limit.trim() === '' ? null : Number(limit)
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000)) {
      setMessage('Enter a limit between $0 and $1,000,000, or leave it blank for no cap.'); return
    }
    setSaving(true); setMessage('')
    try { await onSave({ limit_usd: amount, period }); setMessage('Spending limit saved.') }
    catch (error) { setMessage(error.message) }
    finally { setSaving(false) }
  }
  return <form onSubmit={save} aria-label={title} className="space-y-3 rounded-xl border border-white/10 p-4">
    <div><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-1 text-xs text-slate-400">{description}</p></div>
    <dl className="grid grid-cols-2 gap-3 text-xs">
      <div><dt className="text-slate-400">Used and reserved ({scope.period === 'day' ? 'today' : 'this month'}, UTC)</dt><dd className="mt-1 font-semibold text-white">{money(scope.used_usd)}</dd></div>
      <div><dt className="text-slate-400">Remaining budget</dt><dd className="mt-1 font-semibold text-white">{scope.limit_usd === null ? 'No cap set' : money(Math.max(0, scope.limit_usd - scope.used_usd))}</dd></div>
    </dl>
    <fieldset disabled={disabled || saving} className="space-y-3 disabled:opacity-60">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 block text-xs text-slate-300">Limit (USD)<input aria-label={`${title} limit (USD)`} type="number" min="0" max="1000000" step="0.0001" value={limit} onChange={event => setLimit(event.target.value)} placeholder="No cap" className={field} /></label>
        <label className="space-y-1 block text-xs text-slate-300">Period<select aria-label={`${title} period`} value={period} onChange={event => setPeriod(event.target.value)} className={field}><option value="day">Daily (UTC)</option><option value="month">Monthly (UTC)</option></select></label>
      </div>
      <p className="text-[11px] text-slate-400">Leave blank to remove the cap. A $0 cap prevents new spending. Changing the period recalculates usage; it does not reset it.</p>
      <button className="rounded-lg bg-[#6C5CE7] px-3 py-2 text-xs font-semibold text-white" type="submit">{saving ? 'Saving…' : 'Save limit'}</button>
    </fieldset>
    {message && <p role="status" className="text-xs text-slate-300">{message}</p>}
  </form>
}

export default function SpendingControls() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    manageRequest('/v1/spend').then(result => {
      verifiedScope(result.key)
      if (result.workspace) { verifiedScope(result.workspace); if (!result.workspace.id) throw new Error('Workspace spending could not be verified.') }
      if (active) setData(result)
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])
  async function save(scope, body) {
    setSaving(true)
    try {
      const path = scope === 'key' ? '/v1/spend/caps/key' : `/v1/workspaces/${data.workspace.id}/spend-cap`
      const result = await manageRequest(path, { method: 'PUT', body: JSON.stringify(body) })
      verifiedScope(result[scope])
      if (scope === 'workspace' && result.workspace.id !== data.workspace.id) throw new Error('Workspace spending could not be verified. Refresh before changing limits.')
      setData(previous => ({ ...previous, [scope]: result[scope] }))
    } finally { setSaving(false) }
  }
  return <div className="space-y-4">
    <p className="text-xs leading-relaxed text-slate-400">Usage includes active reservations and uncertain runs, so the budget stays protected while results settle. These are platform cost estimates, not your provider's invoice. Runs without a known price cannot start under a cap.</p>
    <button onClick={() => setRefresh(value => value + 1)} disabled={loading || saving} className="text-xs text-[#A29BFE] hover:underline">{loading ? 'Loading spending…' : 'Refresh spending'}</button>
    {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
    {data && <>
      <CapForm title="Your AI keys" description="All Aistrix runs paid by your keys, including other people using your apps, across workspaces." scope={data.key} onSave={body => save('key', body)} disabled={loading || saving || !!error} />
      {data.workspace ? <CapForm title="Active workspace" description="Runs in this workspace, whichever key pays. Only workspace billing managers can change this cap." scope={data.workspace} onSave={body => save('workspace', body)} disabled={loading || saving || !!error} />
        : <p className="text-xs text-slate-400">Workspace limits are available when an active workspace is selected and you have permission to manage its billing.</p>}
    </>}
  </div>
}
