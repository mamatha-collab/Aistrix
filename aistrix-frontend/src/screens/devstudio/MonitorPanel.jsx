import { useEffect, useState } from 'react'
import { ERROR_LABELS, MONITOR_PERIODS, SOURCE_LABELS, duration, pct, sortAlerts, usd } from '../../lib/monitor'
import { StatTile } from './shared'
import { useMonitor } from '../../hooks/useMonitor'
import TelemetryHealth from './TelemetryHealth'
import SafeCard from '../../components/SafeCard'

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
export default function MonitorPanel({ apps, selectedAppId, onSelectApp, onNavigate, compact = false, refreshKey = 0 }) {
  const [scope, setScope] = useState(selectedAppId && apps.some(a => a.id === selectedAppId) ? selectedAppId : 'all')
  const [days, setDays] = useState(7)
  // Data is kept with the scope it was loaded for: the overview and one app's
  // health have different shapes, so a switch never renders stale data.
  const appIds = apps.map(a => a.id).join(',')
  const { data, loading, error, updatedAt, refresh } = useMonitor(appIds, scope, days)
  useEffect(() => { if (refreshKey) refresh() }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setScope(selectedAppId || 'all') }, [selectedAppId])
  useEffect(() => { if (scope !== 'all' && !appIds.split(',').includes(scope)) setScope('all') }, [scope, appIds])

  function choose(id) { setScope(id); if (id !== 'all') onSelectApp?.(id) }
  const nameOf = id => apps.find(a => a.id === id)?.name || 'App'

  if (!apps.length) return <div className={`${card} text-center text-sm text-slate-400`}>Publish an app to start monitoring it.</div>

  return <section aria-label="Production Monitor" className="space-y-5 min-w-0">
    {!compact && <header><h1 className="text-2xl font-semibold text-white">Monitor</h1><p className="text-sm text-slate-400 mt-1">Live app health, at a glance.</p></header>}
    {scope !== 'all' && <p className="text-xs text-slate-400">{apps.find(a => a.id === scope)?.is_published ? 'Live' : 'Offline · historical production activity'}{apps.find(a => a.id === scope)?.live_version != null ? ` · v${apps.find(a => a.id === scope).live_version}` : ''}</p>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-slate-400">App
        <select aria-label="App to monitor" className={`${select} block mt-1 w-full max-w-72`} value={scope} onChange={e => choose(e.target.value)}>
          <option value="all">All apps</option>
          {apps.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_published ? '' : ' (not published)'}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-400">Period
        <select aria-label="Period" className={`${select} block mt-1`} value={days} onChange={e => setDays(Number(e.target.value))}>
          {MONITOR_PERIODS.map(([d, text]) => <option key={d} value={d}>Last {text}</option>)}
        </select>
      </label>
      {!compact && <button onClick={refresh} disabled={loading}
        className="h-9 px-3 rounded-lg border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-40">
        {loading ? 'Loading…' : 'Refresh'}
      </button>}
      <p className="text-[11px] text-slate-500 basis-full" aria-live="polite">{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Waiting for data'} · Updates every 60 seconds while visible</p>
    </div>

    {error && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
      {error} {data && <p className="text-xs mt-2">Showing the last successful update; these figures may be out of date.</p>}<button onClick={refresh} className="underline ml-1">Try again</button>
    </div>}
    {!error && loading && !data && <p role="status" className="text-sm text-slate-400 py-8 text-center">Loading monitoring data…</p>}
    {data && <SafeCard name="Run tracking status" quiet><TelemetryHealth health={data.telemetry_health} /></SafeCard>}
    {data && (scope === 'all'
      ? <Overview data={data} nameOf={nameOf} onOpen={choose} onNavigate={onNavigate} days={days} />
      : <AppHealth data={data} days={days} onNavigate={onNavigate} appId={scope} />)}
    <p className="text-[11px] text-slate-500">Every real run: signed-in users, API calls, triggers and website visitors. Your own draft and test runs aren't counted.</p>
  </section>
}

// Free developers get Basic analytics (totals and errors); the rest is
// included for Verified developers, so say so instead of "not recorded".
const VERIFIED_ONLY = 'Included for Verified developers'

function HealthSummary({ totals: t, basic = false }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    <StatTile label="Runs" value={t.runs.toLocaleString()} sub={`${t.users} signed-in users${t.visitor_runs ? ` · ${t.visitor_runs} visitor runs` : ''}`} />
    <StatTile label="Failure rate" value={pct(t.error_rate)} sub={`${t.errors} failed · ${t.runs - t.errors} successful`} />
    <StatTile label="Typical response" value={duration(t.latency_p50_ms)} sub={basic ? VERIFIED_ONLY : t.latency_p95_ms == null ? 'No response timings recorded' : `p95 ${duration(t.latency_p95_ms)} · 95% finish within this time`} />
    <StatTile label="Recorded AI cost" value={usd(t.cost_usd)} sub={basic ? VERIFIED_ONLY : t.cost_recorded_runs == null ? 'Cost coverage unavailable' : `${t.cost_recorded_runs} of ${t.runs} runs have cost${t.cost_recorded_runs < t.runs ? ' · partial' : ''}`} />
  </div>
}

function Coverage({ data, limited }) {
  return <>
    {data?.truncated && <p role="status" className="rounded-lg border border-amber-500/20 p-3 text-xs text-amber-300">Partial data: a monitoring row limit was reached. Totals, rates, timings and alerts cover the returned sample. Try a shorter period.</p>}
    {limited && <p className="text-xs text-amber-300">Overview includes the first 50 requested apps. Select an individual app for its monitoring data.</p>}
  </>
}

function Activity({ daily = [], runs, days }) {
  const max = Math.max(1, ...daily.map(d => d.runs))
  return <section className={card} aria-label="Activity">
    <div className="flex items-center justify-between gap-3 mb-4"><h2 className="text-sm text-white font-semibold">Activity</h2><span className="text-[10px] text-slate-500">Purple: successful · Red: failed</span></div>
    {runs ? <><div className="flex items-end gap-1 h-28" role="img" aria-label={`Runs per day over the last ${days} days`}>
      {daily.map(d => <div key={d.date} title={`${d.date}: ${d.runs} runs, ${d.errors} failed`} className="flex-1 min-w-0 flex flex-col justify-end h-full"><div className="bg-red-400 rounded-t-sm" style={{ height: `${d.errors / max * 100}%` }} /><div className="bg-[#6C5CE7] rounded-t-sm" style={{ height: `${Math.max(0, d.runs - d.errors) / max * 100}%` }} /></div>)}
    </div><div className="flex justify-between text-[10px] text-slate-500 mt-2"><span>{daily[0]?.date}</span><span>{daily.at(-1)?.date}</span></div><details className="text-xs text-slate-400 mt-3"><summary className="cursor-pointer">View daily counts</summary><div className="max-h-48 overflow-auto mt-2">{daily.map(d => <p key={d.date} className="py-1">{d.date}: {d.runs} runs, {d.errors} failed</p>)}</div></details></> : <p className="text-sm text-slate-400">No runs in this period. Share your live app to start collecting activity.</p>}
    <p className="text-[10px] text-slate-500 mt-3">UTC dates; first and last days may be partial.</p>
  </section>
}

function Alerts({ alerts, nameOf, onOpen, onNavigate, appId, days, liveVersion, runs, basic = false }) {
  const [expanded, setExpanded] = useState(false)
  const list = sortAlerts(alerts).filter(a => a.level !== 'info')
  return <section aria-label="Needs attention" className="space-y-2">
    <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Needs attention{list.length ? ` · ${list.length}` : ''}</h2>{list.length > 3 && <button className="text-xs text-[#A29BFE]" onClick={() => setExpanded(v => !v)}>{expanded ? 'Show less' : 'View all alerts'}</button>}</div>
    {!list.length && <p className={`${card} text-sm text-slate-400`}>{basic
      ? 'Alerts (failing runs, slow responses, a release failing more than the last) are included for Verified developers.'
      : `${runs ? 'No alert thresholds reached in this period.' : 'No production traffic to assess yet.'} Alerts require enough runs or ratings to be meaningful.`}</p>}
    {(expanded ? list : list.slice(0, 3)).map((a, i) => <div key={`${a.app_id || ''}:${a.kind}:${i}`} role={a.level === 'critical' ? 'alert' : undefined}
      className={`rounded-xl border px-4 py-3 text-sm ${ALERT_STYLE[a.level] || ALERT_STYLE.info}`}>
      {nameOf && a.app_id ? <strong className="font-semibold">{nameOf(a.app_id)}: </strong> : null}{a.message}
      <p className="text-[11px] mt-2 opacity-80">{a.kind === 'errors_24h' ? 'Last 24 hours' : days === 1 ? 'Last 24 hours' : `Last ${days} days`}{(a.live_version ?? liveVersion) != null ? ` · live v${a.live_version ?? liveVersion}` : ''}</p>
      <button className="mt-3 min-h-10 text-xs font-semibold border border-current/20 rounded-lg px-3" onClick={() => {
        const id = a.app_id || appId
        if (onNavigate && ['satisfaction', 'version'].includes(a.kind)) onNavigate(a.kind === 'version' ? 'version' : 'evaluate', id)
        else if (onOpen) onOpen(id)
        else document.getElementById('monitor-diagnostics')?.scrollIntoView({ behavior: 'smooth' })
      }}>{a.kind === 'satisfaction' ? 'Review in Eval →' : a.kind === 'version' ? 'Review versions →' : 'Inspect app →'}</button>
    </div>)}
  </section>
}

function Overview({ data, nameOf, onOpen, onNavigate, days }) {
  const rows = [...data.apps].sort((a, b) => b.totals.runs - a.totals.runs)
  const alerts = data.apps.flatMap(a => a.alerts.map(alert => ({ ...alert, app_id: a.app_id, live_version: a.live_version })))
  const t = data.summary?.totals
  const runs = t?.runs || rows.reduce((n, r) => n + r.totals.runs, 0)
  return <>
    {t ? <HealthSummary totals={t} basic={data.apps?.some(a => a.analytics === 'basic')} /> : <p role="status" className="text-xs text-amber-300">Overview summaries need the matching backend update. Individual app details remain available.</p>}
    <div className="flex flex-wrap gap-3 items-center justify-between text-xs text-slate-400"><span>{t?.rated ? `${pct(t.satisfaction)} useful · ${t.rated} customer ratings` : 'No customer ratings in this period.'}</span>{onNavigate && <button className="min-h-10 px-3 rounded-lg border border-white/10 text-[#A29BFE]" onClick={() => onNavigate('evaluate', rows.find(r => r.open_feedback > 0)?.app_id || rows[0]?.app_id)}>{rows.reduce((n, r) => n + (r.open_feedback || 0), 0)} Feedback to review</button>}</div>
    <Coverage data={data.summary} limited={data.app_limit_reached} />
    <Alerts alerts={alerts} nameOf={nameOf} onOpen={onOpen} onNavigate={onNavigate} days={days} runs={runs} basic={data.apps?.some(a => a.analytics === 'basic')} />
    {data.summary && <Activity daily={data.summary.daily} runs={runs} days={days} />}
    <div className={`${card} overflow-x-auto`}>
      <p className={`${label} mb-3`}>Apps</p>
      <table className="hidden lg:table w-full text-sm min-w-[640px]">
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
      <div className="lg:hidden space-y-2">{rows.map(r => <button key={r.app_id} onClick={() => onOpen(r.app_id)} className="w-full rounded-lg border border-white/8 p-3 text-left"><span className="block text-sm font-semibold text-white">{nameOf(r.app_id)}</span><span className="block text-xs text-slate-400 mt-2">{r.totals.runs} runs · {pct(r.totals.error_rate)} failed · p95 {duration(r.totals.latency_p95_ms)}</span></button>)}</div>
      {!runs && <p className="text-sm text-slate-400 mt-3">No runs in this period yet. Share the live app or its embed to start collecting data.</p>}
    </div>
  </>
}

function AppHealth({ data, days, onNavigate, appId }) {
  const t = data.totals
  const sources = Object.entries(data.by_source || {}).sort((a, b) => b[1] - a[1])
  const errorKinds = Object.entries(data.error_kinds || {})
  return <>
    <HealthSummary totals={t} basic={data.analytics === 'basic'} />
    <Coverage data={data} />
    <Alerts alerts={data.alerts} appId={appId} onNavigate={onNavigate} liveVersion={data.live_version} days={days} runs={t.runs} basic={data.analytics === 'basic'} />

    <Activity daily={data.daily} runs={t.runs} days={days} />
    <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
      <div><h2 className="text-sm font-semibold text-white">Customer feedback</h2><p className="text-sm text-slate-300 mt-2">{t.rated ? `${pct(t.satisfaction)} useful · ${t.rated} ratings` : 'No customer ratings in this period.'}</p><p className="text-xs text-slate-500 mt-1">Customer ratings are a signal, not an automated quality score.</p></div>
      {onNavigate && <button className="min-h-10 text-xs font-semibold text-[#A29BFE] px-3" onClick={() => onNavigate('evaluate', appId)}>Review in Eval →</button>}
    </div>

    <div id="monitor-diagnostics" className="grid grid-cols-1 lg:grid-cols-2 gap-4 scroll-mt-4">
      <div className={card}>
        <p className={`${label} mb-3`}>By version</p>
        {data.by_version.length ? <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-slate-500"><th className="py-1.5 font-medium">Version</th><th className="font-medium">Runs</th><th className="font-medium">Failed</th><th className="font-medium">Slowest 5%</th></tr></thead>
          <tbody className="divide-y divide-white/5">{data.by_version.map(v => <tr key={String(v.version)} className="text-slate-200">
            <td className="py-2">{v.version == null ? 'Version not recorded' : `v${v.version}`}{v.version != null && v.version === data.live_version && <span className="ml-2 text-[10px] text-emerald-300">live</span>}</td>
            <td>{v.runs.toLocaleString()}</td><td className={v.error_rate >= 0.05 ? 'text-amber-300' : ''}>{pct(v.error_rate)}</td><td>{duration(v.latency_p95_ms)}</td>
          </tr>)}</tbody>
        </table> : <p className="text-sm text-slate-400">{data.analytics === 'basic' ? 'Per-version health is included for Verified developers.' : 'No runs yet.'}</p>}
        <p className="text-[11px] text-slate-500 mt-3">Compare releases with enough traffic before deciding whether to roll back.</p>
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
    {onNavigate && <button className="min-h-10 border border-white/10 rounded-lg px-3 text-xs text-[#A29BFE]" onClick={() => onNavigate('version', appId)}>Open Version →</button>}
  </>
}
