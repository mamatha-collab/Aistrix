import { useEffect, useState } from 'react'
import { getAppMonitor, pct } from '../../lib/monitor'
import { getAppFeedback } from '../../lib/feedback'
import { manageRequest } from '../../lib/manageApi'
import { StatTile } from './shared'

const card = 'bg-[#171B33] border border-white/5 rounded-2xl p-5'

// Evaluate: is the app good enough? Customer ratings and failures (last 30
// days, from the server), open feedback, and the current draft's test checklist.
export default function QualityPanel({ app, onNavigate }) {
  const [state, setState] = useState({ loading: true, monitor: null, feedback: null, tests: null, errors: [] })
  const [reload, setReload] = useState(0)
  const appId = app?.id

  useEffect(() => {
    if (!appId) return undefined
    let active = true
    setState(s => ({ ...s, loading: true, errors: [] }))
    const errors = []
    const settle = (promise, label) => promise.catch(e => { errors.push(`${label}: ${e.message}`); return null })
    Promise.all([
      settle(getAppMonitor(appId, 30), 'Ratings and failures'),
      settle(getAppFeedback(appId, 'open'), 'Feedback'),
      settle(manageRequest(`/v1/apps/${encodeURIComponent(appId)}/tests/status`), 'Test results'),
    ]).then(([monitor, feedback, tests]) => { if (active) setState({ loading: false, monitor, feedback, tests, errors }) })
    return () => { active = false }
  }, [appId, reload])

  if (!app) return null
  const { loading, monitor, feedback, tests, errors } = state
  const t = monitor?.totals
  const open = feedback ? (feedback.counts?.new || 0) + (feedback.counts?.investigating || 0) : null
  const trend = monitor?.daily?.filter(d => d.rated) || []
  return <section aria-label="Quality" className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm text-white font-semibold">Quality of {app.name} <span className="text-slate-500 font-normal">· last 30 days</span></h2>
      <button onClick={() => setReload(n => n + 1)} disabled={loading} className="text-xs text-[#A29BFE] hover:underline disabled:opacity-40">{loading ? 'Loading…' : 'Refresh'}</button>
    </div>
    {errors.length > 0 && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
      Some quality data couldn't load ({errors.join('; ')}). <button onClick={() => setReload(n => n + 1)} className="underline">Try again</button>
    </div>}
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      <StatTile label="Useful answers" value={t ? pct(t.satisfaction) : '—'} color="#A29BFE" sub={t ? (t.rated ? `${t.rated} customer ratings` : 'no ratings yet') : undefined} />
      <StatTile label="Failed runs" value={t ? pct(t.error_rate) : '—'} color="#E17055" sub={t ? `${t.errors} of ${t.runs} runs` : undefined} />
      <StatTile label="Open feedback" value={open ?? '—'} color="#FDCB6E" sub={open != null ? 'new or investigating' : undefined} />
      <StatTile label="Draft test checklist" value={tests ? (tests.setup_required ? '—' : `${tests.required_passed}/${tests.required_total}`) : '—'} color="#00B894"
        sub={tests ? (tests.all_passed ? 'ready to publish' : 'not passed yet') : undefined} />
    </div>
    <div className={card}>
      <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">Useful answers by day</p>
      {trend.length ? <div className="flex items-end gap-1 h-24" role="img" aria-label="Share of useful answers per day">
        {monitor.daily.map(d => <div key={d.date} title={d.rated ? `${d.date}: ${pct(d.satisfaction)} useful of ${d.rated}` : `${d.date}: no ratings`}
          className="flex-1 min-w-0 flex flex-col justify-end h-full">
          {d.rated ? <div className={d.satisfaction < 0.7 ? 'bg-amber-400 rounded-t-sm' : 'bg-[#A29BFE] rounded-t-sm'} style={{ height: `${Math.max(4, d.satisfaction * 100)}%` }} /> : <div className="h-px bg-white/10" />}
        </div>)}
      </div> : <p className="text-sm text-slate-400">No customer ratings yet. Customers rate answers with 👍 / 👎 in the app.</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <button onClick={() => onNavigate?.('monitor', app.id)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">Open Monitor</button>
      <button onClick={() => onNavigate?.('test', app.id)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">Run the tests</button>
    </div>
  </section>
}
