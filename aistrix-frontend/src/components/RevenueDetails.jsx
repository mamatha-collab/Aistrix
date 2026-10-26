import { useState } from 'react'
import { useManageRecord } from '../hooks/useManageRecord'
import { downloadManageFile, manageRequest } from '../lib/manageApi'
import { useToast } from '../hooks/useToast'

import { BRAND } from '../lib/brand'
const card = 'rounded-2xl border border-white/8 bg-[#171B33] p-4'
const button = 'min-h-11 rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40'
const money = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value))
const PERIODS = [['', 'All time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']]
const PAYOUT_STATUS = {
  pending: 'Payout pending', transferred: 'Paid out', no_connect_account: 'Owed: set up payouts to receive it',
  transfer_failed: 'Payout failed: send again below', transferring: 'Payout being sent', refunded: 'Refunded', reversal_failed: 'Refunded: payout reversal needs attention',
}

export default function RevenueDetails({ apps, user }) {
  const toast = useToast()
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState('')
  const { data, error, loading, refresh } = useManageRecord(`/stripe/earnings${days ? `?days=${days}` : ''}`, user.id)
  const appName = id => apps.find(a => a.id === id)?.name || 'Other app'

  async function sendOwed() {
    setBusy('payouts')
    try {
      const result = await manageRequest('/stripe/payouts/retry', { method: 'POST' })
      const parts = [
        result.sent ? `Sent ${result.sent} payout${result.sent === 1 ? '' : 's'}` : '',
        result.failed ? `${result.failed} failed` : '',
        result.in_progress ? `${result.in_progress} already being sent` : '',
        result.remaining ? `${result.remaining} still to send: select Send owed payouts again` : '',
      ].filter(Boolean)
      toast(parts.length ? parts.join('; ') : 'Nothing owed right now', result.failed ? 'error' : 'success', result.remaining ? 8000 : 4000)
      refresh()
    } catch (e) { toast(e.message, 'error', 6000) }
    finally { setBusy('') }
  }

  async function downloadCsv() {
    setBusy('csv')
    try { await downloadManageFile(`/stripe/earnings.csv${days ? `?days=${days}` : ''}`, 'aistrix-revenue.csv') }
    catch (e) { toast(e.message, 'error') }
    finally { setBusy('') }
  }

  return <section aria-label="Revenue details" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-white font-semibold">Revenue</h2>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Revenue period" value={days} onChange={e => setDays(e.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#0E1424] px-3 text-sm text-white">
          {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className={button} disabled={loading || busy === 'csv'} onClick={downloadCsv}>{busy === 'csv' ? 'Preparing…' : 'Download CSV'}</button>
        <button className={button} disabled={loading} onClick={refresh}>Refresh revenue</button>
      </div>
    </div>
    <p className="text-xs text-slate-400 leading-relaxed">Recorded purchases for your developer account, across workspaces, after refunds. Amounts are in USD; these are not price × run estimates.</p>
    {loading && <p role="status" className="text-sm text-slate-400">Loading revenue…</p>}
    {error && <div role="alert" className={`${card} text-sm text-amber-200`}>Revenue is unavailable: {error}<button className={`${button} block mt-3`} onClick={refresh}>Retry revenue</button></div>}
    {data && <>
      {data.truncated && <p role="alert" className="text-sm text-amber-200">These totals cover the newest {data.purchase_count?.toLocaleString()} purchases only. Choose a shorter period for complete figures.</p>}
      <div className="grid grid-cols-2 gap-3">
        {[["Your earnings", data.total_dev_share, 'after platform fees and refunds'], ['Pending payout', data.total_pending, data.owed_count ? `${data.owed_count} purchase${data.owed_count === 1 ? '' : 's'}` : 'nothing owed']].map(([label, value, sub]) => <div key={label} className={card}><p className="text-xs text-slate-400">{label}</p><p className="text-xl text-white font-bold mt-2 break-words">{money(value)}</p><p className="text-[11px] text-slate-500 mt-1">{sub}</p></div>)}
      </div>
      {data.owed_count > 0 && <div className={`${card} flex flex-wrap items-center gap-3 text-sm`}>
        <p className="flex-1 min-w-48 text-slate-300">Some earnings haven't been paid out yet (sold before your payout account was ready, or a payout failed). Send them now; nothing is paid twice.</p>
        <button className={`${button} !bg-[#6C5CE7] !text-white !border-transparent`} disabled={busy === 'payouts'} onClick={sendOwed}>{busy === 'payouts' ? 'Sending…' : 'Send owed payouts'}</button>
      </div>}
      <div className={`${card} space-y-3 text-sm`}>
        <div className="flex justify-between gap-3"><span className="text-slate-400">Recorded sales (after refunds)</span><span className="text-white">{money(data.total_gross)}</span></div>
        {data.total_refunded > 0 && <div className="flex justify-between gap-3"><span className="text-slate-400">Refunded to buyers</span><span className="text-white">{money(data.total_refunded)}</span></div>}
        {data.disputed_count > 0 && <div className="flex justify-between gap-3"><span className="text-amber-300">Chargebacks opened</span><span className="text-amber-300">{data.disputed_count}</span></div>}
        <div className="flex justify-between gap-3"><span className="text-slate-400">Platform fee rate</span><span className="text-white">{data.platform_fee_pct == null ? '—' : `${data.platform_fee_pct}%`}</span></div>
      </div>
      <section className="space-y-3"><h3 className="text-sm text-white font-semibold">By app</h3>
        {data.by_app?.length ? data.by_app.map(row => <div key={row.app_id} className={`${card} space-y-2`}><p className="text-white font-semibold text-sm break-words">{appName(row.app_id)}</p><div className="flex justify-between gap-3 text-sm"><span className="text-slate-400">{row.sale_count} recorded purchase(s)</span><span className="text-emerald-300">{money(row.total_dev_share)}</span></div><p className="text-xs text-slate-400">Sales {money(row.total_gross)}{row.refunded > 0 ? ` · refunded ${money(row.refunded)}` : ''} · earnings shown after platform fees</p></div>) : <p className="text-sm text-slate-400">No recorded purchases {days ? 'in this period' : 'yet'}.</p>}
      </section>
      {!!data.recent?.length && <details className={card}><summary className="cursor-pointer text-sm text-white font-semibold min-h-7">Recent purchases</summary><div className="mt-3 divide-y divide-white/8">{data.recent.map((row, index) => <div key={`${row.app_id}:${row.created_at}:${index}`} className="py-3 space-y-1 text-sm"><p className="text-white break-words">{appName(row.app_id)}</p><p className="text-slate-300">Your share {money(row.dev_share)}{row.refunded_amount > 0 ? ` · ${money(row.refunded_amount)} refunded` : ''}</p><p className="text-xs text-slate-400">{new Date(row.created_at).toLocaleDateString()} · {row.plan === 'subscription' ? 'Subscription' : row.plan === 'pay_per_run' ? 'One run' : row.plan || 'Purchase'} · {PAYOUT_STATUS[row.payout_status] || row.payout_status || 'Status not available'}{row.disputed ? ' · chargeback opened' : ''}</p></div>)}</div></details>}
      <p className="text-xs text-slate-500 leading-relaxed">Pending amounts are recorded in {BRAND}; they do not confirm a bank deposit or a payout date.</p>
    </>}
  </section>
}
