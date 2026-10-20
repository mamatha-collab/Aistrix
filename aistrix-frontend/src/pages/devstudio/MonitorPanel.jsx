import { useEffect, useState } from 'react'
import { ERROR_LABELS, MONITOR_PERIODS, SOURCE_LABELS, duration, getAppMonitor, getMonitorOverview, pct, sortAlerts, usd } from '../../lib/monitor'
import { StatTile } from './shared'

const card = 'bg-[#171B33] border border-white/5 rounded-2xl p-5'
const label = 'text-xs text-slate-400 font-semibold uppercase tracking-wide'
const select = 'bg-[#0E1424] border border-white/10 rounded-lg px-3 h-9 text-sm text-white'
const ALERT_STYLE = {
  critical: 'border-red-500/30 bg-red-500/10 text-red-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  info: 'border-white/10 bg-white/5 text-slate-300',
}

// Production health: every real run of the developer's apps (customers, API,
// triggers, website visitors) from the server's run log — not draft or test runs.
export default function MonitorPanel({ apps, selectedAppId, onSelectApp, entitlements = [] }) {
  const [scope, setScope] = useState(selectedAppId && apps.some(a => a.id === selectedAppId) ? selectedAppId : 'all')
  const [days, setDays] = useState(7)
  // Data is kept with the scope it was loaded for: the overview and one app's
  // health have different shapes, so a switch never renders stale data.
  const [state, setState] = useState({ loading: true, error: '', data: null, scope: null })
  const [reload, setReload] = useState(0)
  const appIds = apps.map(a => a.id).join(',')

  useEffect(() => {
    let active = true
    setState(s => ({ ...s, loading: true, error: '', data: s.scope === scope ? s.data : null }))
    const request = scope === 'all' ? getMonitorOverview(appIds.split(',').filter(Boolean), days) : getAppMonitor(scope, days)
    request.then(data => { if (active) setState({ loading: false, error: '', data, scope }) })
      .catch(e => { if (active) setState({ loading: false, error: e.message || 'Could not load monitoring data', data: null, scope }) })
    return () => { active = false }
  }, [scope, days, appIds, reload])

  function choose(id) { setScope(id); if (id !== 'all') onSelectApp?.(id) }
  const nameOf = id => apps.find(a => a.id === id)?.name || 'App'

  if (!apps.length) return <div className={`${card} text-center text-sm text-slate-400`}>Publish an app to start monitoring it.</div>

  const { loading, error } = state
  const data = state.scope === scope ? state.data : null
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-slate-400">App
        <select aria-label="App to monitor" className={`${select} block mt-1 min-w-56`} value={scope} onChange={e => choose(e.target.value)}>
          <option value="all">All apps</option>
          {apps.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_published ? '' : ' (not published)'}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-400">Period
        <select aria-label="Period" className={`${select} block mt-1`} value={days} onChange={e => setDays(Number(e.target.value))}>
          {MONITOR_PERIODS.map(([d, text]) => <option key={d} value={d}>Last {text}</option>)}
        </select>
      </label>
      <button onClick={() => setReload(n => n + 1)} disabled={loading}
        className="h-9 px-3 rounded-lg border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-40">
        {loading ? 'Loading…' : 'Refresh'}
      </button>
      <p className="text-[11px] text-slate-500 basis-full">Every real run: signed-in users, API calls, triggers and website visitors. Your own draft and test runs aren't counted.</p>
    </div>

    {error && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
      {error} <button onClick={() => setReload(n => n + 1)} className="underline ml-1">Try again</button>
    </div>}
    {!error && loading && !data && <p role="status" className="text-sm text-slate-400 py-8 text-center">Loading monitoring data…</p>}
    {!error && data && (scope === 'all'
      ? <Overview data={data} nameOf={nameOf} onOpen={choose} entitlements={entitlements} />
      : <AppHealth data={data} days={days} />)}
  </div>
}

function Alerts({ alerts, nameOf }) {
  const list = sortAlerts(alerts)
  if (!list.length) return null
  return <section aria-label="Needs attention" className="space-y-2">
    {list.map((a, i) => <div key={`${a.app_id || ''}:${a.kind}:${i}`} role={a.level === 'critical' ? 'alert' : undefined}
      className={`rounded-xl border px-4 py-3 text-sm ${ALERT_STYLE[a.level] || ALERT_STYLE.info}`}>
      {nameOf && a.app_id ? <strong className="font-semibold">{nameOf(a.app_id)}: </strong> : null}{a.message}
    </div>)}
  </section>
}

function Overview({ data, nameOf, onOpen, entitlements }) {
  const rows = [...data.apps].sort((a, b) => b.totals.runs - a.totals.runs)
  const alerts = data.apps.flatMap(a => a.alerts.map(alert => ({ ...alert, app_id: a.app_id })))
  const sum = key => rows.reduce((n, r) => n + (r.totals[key] || 0), 0)
  const runs = sum('runs'), errors = sum('errors')
  const activeEnt = entitlements.filter(e => e.status === 'active')
  return <>
    <Alerts alerts={alerts} nameOf={nameOf} />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatTile label="Runs" value={runs.toLocaleString()} />
      <StatTile label="Failed runs" value={runs ? pct(errors / runs) : '—'} color="#E17055" sub={`${errors} of ${runs}`} />
      <StatTile label="Cost (recorded)" value={usd(rows.some(r => r.totals.cost_usd != null) ? sum('cost_usd') : null)} color="#00B894" />
      <StatTile label="Active customers" value={new Set(activeEnt.map(e => e.user_id)).size} color="#FDCB6E" sub="paid access now" />
    </div>
    <div className={`${card} overflow-x-auto`}>
      <p className={`${label} mb-3`}>Apps</p>
      <table className="w-full text-sm min-w-[640px]">
        <thead><tr className="text-left text-[11px] text-slate-500">
          <th className="py-2 font-medium">App</th><th className="font-medium">Runs</th><th className="font-medium">Users</th>
          <th className="font-medium">Failed</th><th className="font-medium">Slowest 5%</th><th className="font-medium">Useful</th><th />
        </tr></thead>
        <tbody className="divide-y divide-white/5">
          {rows.map(r => <tr key={r.app_id} className="text-slate-200">
            <td className="py-2.5 pr-3"><button onClick={() => onOpen(r.app_id)} className="text-left text-white hover:underline">{nameOf(r.app_id)}</button>
              {r.alerts.some(a => a.level !== 'info') && <span className="ml-2 text-[10px] text-amber-300">needs attention</span>}</td>
            <td>{r.totals.runs.toLocaleString()}</td><td>{r.totals.users}</td>
            <td className={r.totals.error_rate >= 0.05 ? 'text-amber-300' : ''}>{pct(r.totals.error_rate)}</td>
            <td>{duration(r.totals.latency_p95_ms)}</td>
            <td>{r.totals.rated ? `${pct(r.totals.satisfaction)} of ${r.totals.rated}` : '—'}</td>
            <td className="text-right"><button onClick={() => onOpen(r.app_id)} className="text-xs text-[#A29BFE] hover:underline">Details →</button></td>
          </tr>)}
        </tbody>
      </table>
      {!runs && <p className="text-sm text-slate-400 mt-3">No runs in this period yet. Share the live app or its embed to start collecting data.</p>}
    </div>
  </>
}

function AppHealth({ data, days }) {
  const t = data.totals
  const max = Math.max(1, ...data.daily.map(d => d.runs))
  const sources = Object.entries(data.by_source || {}).sort((a, b) => b[1] - a[1])
  const errorKinds = Object.entries(data.error_kinds || {})
  return <>
    <Alerts alerts={data.alerts} />
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <StatTile label="Runs" value={t.runs.toLocaleString()} sub={t.visitor_runs ? `${t.visitor_runs} from website visitors` : undefined} />
      <StatTile label="Users" value={t.users} color="#00B894" sub="signed in" />
      <StatTile label="Failed runs" value={pct(t.error_rate)} color="#E17055" sub={`${t.errors} of ${t.runs}`} />
      <StatTile label="Typical response" value={duration(t.latency_p50_ms)} color="#74B9FF" sub={`slowest 5%: ${duration(t.latency_p95_ms)}`} />
      <StatTile label="AI cost" value={usd(t.cost_usd)} color="#FDCB6E" sub={t.cost_per_run_usd != null ? `${usd(t.cost_per_run_usd)} per run` : 'not recorded yet'} />
      <StatTile label="Useful answers" value={pct(t.satisfaction)} color="#A29BFE" sub={t.rated ? `${t.rated} ratings` : 'no ratings yet'} />
    </div>

    <div className={card}>
      <div className="flex items-center justify-between mb-4">
        <p className={label}>Runs per day</p>
        <p className="text-[11px] text-slate-500"><span className="inline-block w-2 h-2 rounded-sm bg-[#6C5CE7] mr-1" />ok <span className="inline-block w-2 h-2 rounded-sm bg-red-400 ml-3 mr-1" />failed</p>
      </div>
      {t.runs ? <>
        <div className="flex items-end gap-[2px] h-32" role="img" aria-label={`Runs per day over the last ${days} days`}>
          {data.daily.map(d => <div key={d.date} title={`${d.date}: ${d.runs} runs, ${d.errors} failed`} className="flex-1 min-w-0 flex flex-col justify-end h-full">
            <div className="bg-red-400 rounded-t-sm" style={{ height: `${(d.errors / max) * 100}%` }} />
            <div className="bg-[#6C5CE7]" style={{ height: `${((d.runs - d.errors) / max) * 100}%` }} />
          </div>)}
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 mt-2"><span>{data.daily[0]?.date}</span><span>{data.daily.at(-1)?.date}</span></div>
      </> : <p className="text-sm text-slate-400">No runs in this period. Share the live app or its embed to start collecting data.</p>}
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className={card}>
        <p className={`${label} mb-3`}>By version</p>
        {data.by_version.length ? <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-slate-500"><th className="py-1.5 font-medium">Version</th><th className="font-medium">Runs</th><th className="font-medium">Failed</th><th className="font-medium">Slowest 5%</th></tr></thead>
          <tbody className="divide-y divide-white/5">{data.by_version.map(v => <tr key={String(v.version)} className="text-slate-200">
            <td className="py-2">{v.version == null ? 'Draft' : `v${v.version}`}{v.version != null && v.version === data.live_version && <span className="ml-2 text-[10px] text-emerald-300">live</span>}</td>
            <td>{v.runs.toLocaleString()}</td><td className={v.error_rate >= 0.05 ? 'text-amber-300' : ''}>{pct(v.error_rate)}</td><td>{duration(v.latency_p95_ms)}</td>
          </tr>)}</tbody>
        </table> : <p className="text-sm text-slate-400">No runs yet.</p>}
        <p className="text-[11px] text-slate-500 mt-3">Compare a release with the one before it; roll back in Version if a release fails more often.</p>
      </div>
      <div className={`${card} space-y-4`}>
        <div>
          <p className={`${label} mb-2`}>Where runs come from</p>
          {sources.length ? sources.map(([source, n]) => <div key={source} className="flex justify-between text-sm text-slate-200 py-1">
            <span>{SOURCE_LABELS[source] || source}</span><span>{n.toLocaleString()} · {pct(n / t.runs)}</span></div>) : <p className="text-sm text-slate-400">No runs yet.</p>}
        </div>
        {errorKinds.length > 0 && <div>
          <p className={`${label} mb-2`}>Why runs failed</p>
          {errorKinds.map(([kind, n]) => <div key={kind} className="flex justify-between text-sm text-slate-200 py-1"><span>{ERROR_LABELS[kind] || kind}</span><span>{n}</span></div>)}
        </div>}
      </div>
    </div>
    {data.truncated && <p className="text-[11px] text-slate-500">Showing the most recent 20,000 runs of this period.</p>}
  </>
}
