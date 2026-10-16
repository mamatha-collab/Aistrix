import { useManageRecord } from '../hooks/useManageRecord'

const card = 'rounded-2xl border border-white/8 bg-[#171B33] p-4'
const button = 'min-h-11 rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40'
const money = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value))

export default function RevenueDetails({ apps, user }) {
  const { data, error, loading, refresh } = useManageRecord('/stripe/earnings', user.id)
  const appName = id => apps.find(a => a.id === id)?.name || 'Other app'
  return <section aria-label="Revenue details" className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-white font-semibold">Revenue</h2><button className={button} disabled={loading} onClick={refresh}>Refresh revenue</button></div>
    <p className="text-xs text-slate-400 leading-relaxed">Recorded purchases for your developer account, across workspaces. Amounts are in USD; these are not price × run estimates.</p>
    {loading && <p role="status" className="text-sm text-slate-400">Loading revenue…</p>}
    {error && <div role="alert" className={`${card} text-sm text-amber-200`}>Revenue is unavailable: {error}<button className={`${button} block mt-3`} onClick={refresh}>Retry revenue</button></div>}
    {data && <>
      <div className="grid grid-cols-2 gap-3">
        {[["Your earnings", data.total_dev_share], ['Pending payout', data.total_pending]].map(([label, value]) => <div key={label} className={card}><p className="text-xs text-slate-400">{label}</p><p className="text-xl text-white font-bold mt-2 break-words">{money(value)}</p></div>)}
      </div>
      <div className={`${card} space-y-3 text-sm`}><div className="flex justify-between gap-3"><span className="text-slate-400">Recorded sales</span><span className="text-white">{money(data.total_gross)}</span></div><div className="flex justify-between gap-3"><span className="text-slate-400">Platform fee rate</span><span className="text-white">{data.platform_fee_pct == null ? '—' : `${data.platform_fee_pct}%`}</span></div></div>
      <section className="space-y-3"><h3 className="text-sm text-white font-semibold">By app</h3>
        {data.by_app?.length ? data.by_app.map(row => <div key={row.app_id} className={`${card} space-y-2`}><p className="text-white font-semibold text-sm break-words">{appName(row.app_id)}</p><div className="flex justify-between gap-3 text-sm"><span className="text-slate-400">{row.sale_count} recorded purchase(s)</span><span className="text-emerald-300">{money(row.total_dev_share)}</span></div><p className="text-xs text-slate-400">Sales {money(row.total_gross)} · earnings shown after platform fees</p></div>) : <p className="text-sm text-slate-400">No recorded purchases yet.</p>}
      </section>
      {!!data.recent?.length && <details className={card}><summary className="cursor-pointer text-sm text-white font-semibold min-h-7">Recent purchases</summary><div className="mt-3 divide-y divide-white/8">{data.recent.map((row, index) => <div key={`${row.app_id}:${row.created_at}:${index}`} className="py-3 space-y-1 text-sm"><p className="text-white break-words">{appName(row.app_id)}</p><p className="text-slate-300">Your share {money(row.dev_share)}</p><p className="text-xs text-slate-400">{new Date(row.created_at).toLocaleDateString()} · {row.plan || 'Purchase'} · {row.payout_status || 'Status not available'}</p></div>)}</div></details>}
      <p className="text-xs text-slate-500 leading-relaxed">Pending amounts are recorded in Aistrix; they do not confirm a bank deposit or a payout date.</p>
    </>}
  </section>
}

