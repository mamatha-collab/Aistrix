import { useEffect, useState } from 'react'
import { getAppMonitor, pct } from '../../lib/monitor'
import { manageRequest } from '../../lib/manageApi'
import { StatTile } from './shared'
import TelemetryHealth from './TelemetryHealth'

// Summary only: test execution and editing stay in Build → Test.
export default function QualityPanel({ app, onNavigate, refreshKey }) {
  const [state, setState] = useState({ loading: true, monitor: null, tests: null, errors: [] })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ loading: true, monitor: null, tests: null, errors: [] })
    const errors = []
    const settle = (promise, name) => promise.catch(e => { if (e.name !== 'AbortError') errors.push(`${name}: ${e.message}`); return null })
    Promise.all([
      settle(getAppMonitor(app.id, 30, controller.signal), 'Customer ratings'),
      settle(manageRequest(`/v1/apps/${encodeURIComponent(app.id)}/tests/status`, { signal: controller.signal }), 'Draft tests'),
    ]).then(([monitor, tests]) => { if (active) setState({ loading: false, monitor, tests, errors }) })
    return () => { active = false; controller.abort() }
  }, [app.id, refreshKey, retry])
  const { loading, monitor, tests, errors } = state
  const t = monitor?.totals
  const requirements = tests?.requirements || []
  const valid = tests && !tests.setup_required
  return <section aria-label="Quality" className="space-y-3">
    <TelemetryHealth health={monitor?.telemetry_health} />
    {errors.length > 0 && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">Some quality data couldn't load ({errors.join('; ')}). <button className="underline min-h-10" onClick={() => setRetry(n => n + 1)}>Retry quality summary</button></div>}
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <StatTile label="Useful answers" value={t?.rated ? pct(t.satisfaction) : '—'} sub={loading ? 'Loading…' : t ? `${t.rated} customer ratings · last 30 days` : 'Ratings unavailable'} />
      <StatTile label="Draft test checklist" value={valid ? `${tests.required_passed}/${tests.required_total}` : '—'} sub={loading ? 'Loading…' : tests?.setup_required ? 'Test storage needs setup' : valid ? (tests.all_passed ? 'Required checks passed on this draft' : 'Validation needed on this draft') : 'Test results unavailable'} />
      <StatTile label="Test results" value={valid ? `${tests.passed ?? 0}/${tests.total ?? 0}` : '—'} sub={loading ? 'Loading…' : valid ? 'Latest results for the current draft' : 'Run and review in Build → Test'} />
    </div>
    {monitor?.truncated && <p role="status" className="text-xs text-amber-300">Ratings cover a limited sample. Select a shorter period in Monitor for further investigation.</p>}
    <details className="rounded-xl border border-white/8 bg-[#171B33] px-4 py-3 text-xs text-slate-400">
      <summary className="cursor-pointer min-h-6 font-semibold">Current draft validation details</summary>
      <div className="mt-3 space-y-3">{requirements.length ? requirements.map(r => <div key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2"><span className="text-slate-200">{r.label}{r.required ? '' : ' (optional)'}</span><span className={r.passed ? 'text-emerald-300' : 'text-amber-300'}>{r.passed ? 'Passed' : r.status === 'failed' ? 'Failed' : 'Not validated'}</span>{!r.passed && r.fix && <p className="basis-full">{r.fix}</p>}</div>) : <p>{loading ? 'Loading test requirements…' : 'No verified checklist available. Review test setup in Build → Test.'}</p>}<p>Results apply to the current saved draft and test definitions. Passing tests alone does not approve publication or prove a customer report is resolved.</p><button className="min-h-10 text-[#A29BFE] font-semibold" onClick={() => onNavigate('test', app.id)}>Run the tests →</button></div>
    </details>
    <details className="rounded-xl border border-white/8 bg-[#171B33] px-4 py-3 text-xs text-slate-400">
      <summary className="cursor-pointer min-h-6 font-semibold">Customer rating trend · last 30 days</summary>
      <div className="mt-3">
        {t?.rated ? <>
          <div className="flex items-end gap-1 h-24" role="img" aria-label="Share of useful answers per day">{monitor.daily.map(d => <div key={d.date} className="flex-1 min-w-0 flex flex-col justify-end h-full" title={`${d.date}: ${d.rated ? `${pct(d.satisfaction)} useful of ${d.rated}` : 'no ratings'}`}>{d.rated ? <div className="bg-[#A29BFE] rounded-t-sm" style={{ height: `${d.satisfaction * 100}%` }} /> : <div className="h-px bg-white/10" />}</div>)}</div>
          <div className="max-h-48 overflow-auto mt-3">{monitor.daily.filter(d => d.rated).map(d => <p key={d.date} className="py-1">{d.date}: {pct(d.satisfaction)} useful · {d.rated} ratings</p>)}</div>
          <p className="mt-2">UTC dates; boundary days may be partial. A small sample can change sharply.</p>
        </> : <p>{loading ? 'Loading customer ratings…' : t ? 'No customer ratings in this period.' : 'Rating history is unavailable. Retry the quality summary.'}</p>}
      </div>
    </details>
  </section>
}
