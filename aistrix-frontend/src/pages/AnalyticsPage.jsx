import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { timeAgo } from '../utils'

// ─── Chart primitives ───────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = '#6C5CE7', trend }) {
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
      <p className="text-xs text-slate-400 mb-2">{label}</p>
      <p className="text-3xl font-bold text-white mb-1">{value ?? '—'}</p>
      <div className="flex items-center justify-between">
        {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
        {trend !== undefined && (
          <span className={`text-[10px] font-medium ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="h-0.5 w-8 rounded-full mt-3" style={{ background: color }} />
    </div>
  )
}

function BarChart({ data, height = 120, color = '#6C5CE7' }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => {
        const pct = (d.value / max) * (height - 24)
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
            {d.value > 0 && (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] text-white bg-[#272C52] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                {d.value}
              </div>
            )}
            <div className="w-full rounded-t transition-all" style={{ height: Math.max(pct, d.value > 0 ? 3 : 0), background: color + 'cc' }} />
            <span className="text-[9px] text-slate-600 truncate w-full text-center">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function HBarChart({ data, color = '#6C5CE7' }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-base shrink-0 w-6">{d.emoji}</span>
          <span className="text-xs text-slate-300 w-32 truncate shrink-0">{d.label}</span>
          <div className="flex-1 bg-[#1F2444] rounded-full h-2 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
          <span className="text-[10px] text-slate-500 w-10 text-right shrink-0">{d.value}</span>
        </div>
      ))}
    </div>
  )
}

function DonutChart({ thumbsUp, thumbsDown }) {
  const total = thumbsUp + thumbsDown
  if (total === 0) return <p className="text-slate-500 text-sm text-center py-4">No ratings yet</p>
  const upPct = Math.round((thumbsUp / total) * 100)
  const r = 36, cx = 44, cy = 44, stroke = 10
  const circ = 2 * Math.PI * r
  const upArc = (thumbsUp / total) * circ

  return (
    <div className="flex items-center gap-6">
      <svg width={88} height={88} className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1F2444" strokeWidth={stroke} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E17055" strokeWidth={stroke}
          strokeDasharray={`${circ} ${circ}`} strokeDashoffset={0} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#00B894" strokeWidth={stroke}
          strokeDasharray={`${upArc} ${circ}`} strokeDashoffset={0} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={13} fontWeight="bold">
          {upPct}%
        </text>
      </svg>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#00B894]" />
          <span className="text-xs text-slate-300">👍 {thumbsUp} positive</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#E17055]" />
          <span className="text-xs text-slate-300">👎 {thumbsDown} needs work</span>
        </div>
        <p className="text-[10px] text-slate-500">{total} rated runs total</p>
      </div>
    </div>
  )
}

function HourChart({ data }) {
  const max = Math.max(...data, 1)
  const hours = Array.from({ length: 24 }, (_, i) => i)
  return (
    <div>
      <div className="flex items-end gap-0.5" style={{ height: 56 }}>
        {hours.map(h => {
          const val = data[h] || 0
          const pct = (val / max) * 44
          return (
            <div key={h} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              {val > 0 && (
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] text-white bg-[#272C52] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  {val}
                </div>
              )}
              <div className="w-full rounded-t" style={{ height: Math.max(pct, val > 0 ? 2 : 0), background: '#6C5CE7' + (val > 0 ? 'cc' : '22') }} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[9px] text-slate-600 mt-1 px-0.5">
        <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

const PERIODS = [
  { id: 7,   label: '7 days' },
  { id: 30,  label: '30 days' },
  { id: 90,  label: '90 days' },
  { id: 365, label: '1 year' },
  { id: 3650, label: 'All time' },
]

const PERIOD_LABEL = {
  7:    'the last 7 days',
  30:   'the last 30 days',
  90:   'the last 90 days',
  365:  'the last year',
  3650: 'all time',
}

export default function AnalyticsPage({ user }) {
  const [period, setPeriod] = useState(30)
  const [runs, setRuns] = useState([])
  const [prevRuns, setPrevRuns] = useState([])
  const [appMap, setAppMap] = useState({})
  const [allTimeLastRuns, setAllTimeLastRuns] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when period or user.id changes
  }, [period, user.id])

  useEffect(() => {
    loadAllTimeLastRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  async function loadAllTimeLastRuns() {
    const { data } = await supabase
      .from('run_history')
      .select('app_id, app_name, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500)
    if (!data) return
    const map = {}
    data.forEach(r => {
      const key = r.app_id || r.app_name
      if (!map[key]) map[key] = r.created_at
    })
    setAllTimeLastRuns(map)
  }

  async function load() {
    setLoading(true)
    const now = new Date()
    const start = new Date(now); start.setDate(start.getDate() - period)
    const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - period)

    const [{ data: current }, { data: previous }, { data: apps }] = await Promise.all([
      supabase.from('run_history').select('id, app_id, app_name, created_at, rating_value')
        .eq('user_id', user.id).gte('created_at', start.toISOString()).order('created_at'),
      supabase.from('run_history').select('id', { count: 'exact', head: false })
        .eq('user_id', user.id)
        .gte('created_at', prevStart.toISOString()).lt('created_at', start.toISOString()),
      supabase.from('apps').select('id, name, emoji, ai_provider').eq('is_published', true),
    ])

    setRuns(current ?? [])
    setPrevRuns(previous ?? [])
    const map = {}
    apps?.forEach(a => { map[a.id] = a })
    setAppMap(map)
    setLoading(false)
  }

  const stats = useMemo(() => {
    if (!runs.length) return null
    const total = runs.length
    const prevTotal = prevRuns.length
    const trend = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null
    const rated = runs.filter(r => r.rating_value != null)
    const thumbsUp = rated.filter(r => r.rating_value === 1).length
    const thumbsDown = rated.filter(r => r.rating_value === -1).length
    const ratingPct = rated.length > 0 ? Math.round((thumbsUp / rated.length) * 100) : null

    // Runs per day
    const dayMap = {}
    for (let i = period - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      dayMap[key] = 0
    }
    runs.forEach(r => {
      const key = r.created_at.slice(0, 10)
      if (key in dayMap) dayMap[key]++
    })

    // Reduce labels for large periods
    const step = period > 30 ? Math.ceil(period / 20) : 1
    const timelineData = Object.entries(dayMap)
      .filter((_, i) => i % step === 0 || i === Object.keys(dayMap).length - 1)
      .map(([date, value]) => ({
        label: new Date(date).toLocaleDateString('en-US', period <= 7 ? { weekday: 'short' } : period <= 30 ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' }),
        value,
      }))

    // Per app
    const appCounts = {}
    runs.forEach(r => {
      const key = r.app_id
      if (!appCounts[key]) appCounts[key] = { label: r.app_name, emoji: appMap[r.app_id]?.emoji || '🤖', value: 0 }
      appCounts[key].value++
    })
    const appData = Object.values(appCounts).sort((a, b) => b.value - a.value).slice(0, 8)

    // Per hour
    const hourData = new Array(24).fill(0)
    runs.forEach(r => { hourData[new Date(r.created_at).getHours()]++ })

    // Avg per day
    const days = Math.max(period, 1)
    const avgPerDay = (total / days).toFixed(1)

    // Most active day
    const dayOfWeekCounts = new Array(7).fill(0)
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    runs.forEach(r => { dayOfWeekCounts[new Date(r.created_at).getDay()]++ })
    const peakDow = DOW[dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts))]

    return { total, trend, avgPerDay, ratingPct, thumbsUp, thumbsDown, timelineData, appData, hourData, peakDow }
  }, [runs, prevRuns, appMap, period])

  const appHealth = useMemo(() => {
    if (!runs.length) return []
    const byKey = {}
    runs.forEach(r => {
      const key = r.app_id || r.app_name
      if (!byKey[key]) byKey[key] = { id: r.app_id, name: r.app_name, emoji: appMap[r.app_id]?.emoji || '🤖', runs: [] }
      byKey[key].runs.push(r)
    })
    return Object.values(byKey).map(app => {
      const total = app.runs.length
      const rated = app.runs.filter(r => r.rating_value != null)
      const thumbsUp = rated.filter(r => r.rating_value === 1).length
      const thumbsDown = rated.filter(r => r.rating_value === -1).length
      const usefulPct = rated.length > 0 ? Math.round((thumbsUp / rated.length) * 100) : null
      const notUsefulPct = rated.length > 0 ? Math.round((thumbsDown / rated.length) * 100) : null
      const lastRunInPeriod = app.runs[app.runs.length - 1]?.created_at
      const allTimeKey = app.id || app.name
      const lastRunAllTime = allTimeLastRuns[allTimeKey] ?? lastRunInPeriod
      const daysSince = lastRunAllTime ? (Date.now() - new Date(lastRunAllTime).getTime()) / 86400000 : null
      const needsReview = (usefulPct !== null && usefulPct < 50) || (daysSince !== null && daysSince > 14)
      return { ...app, total, rated: rated.length, thumbsUp, thumbsDown, usefulPct, notUsefulPct, lastRunAllTime, daysSince, needsReview }
    }).sort((a, b) => {
      if (a.needsReview !== b.needsReview) return a.needsReview ? -1 : 1
      return b.total - a.total
    })
  }, [runs, appMap, allTimeLastRuns])

  const card = 'bg-[#171B33] border border-white/5 rounded-2xl p-5'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Analytics</h1>
          <p className="text-slate-400 text-sm mt-0.5">Deep dive into your AI app usage patterns.</p>
        </div>
        <div className="flex gap-1 bg-[#1F2444] p-1 rounded-xl">
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${period === p.id ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className={`${card} animate-pulse h-32`} />)}
        </div>
      ) : !stats || stats.total === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <p className="text-4xl mb-3">📈</p>
          <p className="text-white font-medium mb-1">No data in {PERIOD_LABEL[period] ?? `the last ${period} days`}</p>
          <p className="text-slate-400 text-sm mb-4">Run some apps and come back to see your analytics.</p>
          {period !== 3650 && (
            <button
              onClick={() => setPeriod(3650)}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-white/8 hover:bg-white/12 border border-white/15 text-slate-300 hover:text-white transition-colors"
            >
              View all-time →
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total runs" value={stats.total} sub={`last ${period} days`} trend={stats.trend} color="#6C5CE7" />
            <StatCard label="Avg per day" value={stats.avgPerDay} sub="runs / day" color="#00B894" />
            <StatCard label="Satisfaction" value={stats.ratingPct !== null ? `${stats.ratingPct}%` : '—'} sub="of rated runs positive" color="#FDCB6E" />
            <StatCard label="Most active" value={stats.peakDow} sub="day of week" color="#E84393" />
          </div>

          {/* Timeline */}
          <div className={card}>
            <p className="text-sm font-medium text-white mb-5">Runs over time</p>
            <BarChart data={stats.timelineData} height={140} color="#6C5CE7" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* App breakdown */}
            <div className={card}>
              <p className="text-sm font-medium text-white mb-4">Top apps by usage</p>
              {stats.appData.length === 0
                ? <p className="text-slate-500 text-sm">No app data</p>
                : <HBarChart data={stats.appData} color="#6C5CE7" />}
            </div>

            {/* Ratings */}
            <div className={card}>
              <p className="text-sm font-medium text-white mb-4">Result quality ratings</p>
              <DonutChart thumbsUp={stats.thumbsUp} thumbsDown={stats.thumbsDown} />
              {stats.thumbsUp + stats.thumbsDown > 0 && (
                <p className="text-[10px] text-slate-500 mt-4">
                  💡 Rate results with 👍 👎 in the app runner to track quality over time.
                </p>
              )}
            </div>
          </div>

          {/* Peak hours */}
          <div className={card}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-white">Peak usage hours</p>
              <p className="text-xs text-slate-500">
                Busiest hour: {stats.hourData.indexOf(Math.max(...stats.hourData))}:00
              </p>
            </div>
            <HourChart data={stats.hourData} />
          </div>

          {/* App / workflow health */}
          {appHealth.length > 0 && (
            <div className={card}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium text-white">App &amp; workflow health</p>
                <p className="text-xs text-slate-500">Needs review = &lt;50% useful or stale &gt;14 days</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] text-slate-500 border-b border-white/5">
                      <th className="pb-2 font-medium pr-4">App / Workflow</th>
                      <th className="pb-2 font-medium pr-4 text-right">Runs</th>
                      <th className="pb-2 font-medium pr-4 text-right">Useful rate</th>
                      <th className="pb-2 font-medium pr-4 text-right">Not useful</th>
                      <th className="pb-2 font-medium pr-4 text-right">Last run</th>
                      <th className="pb-2 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {appHealth.map(app => (
                      <tr key={app.id || app.name} className="group">
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="text-base leading-none">{app.emoji}</span>
                            <span className="text-white font-medium truncate max-w-[180px]">{app.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-right text-slate-300">{app.total}</td>
                        <td className="py-2.5 pr-4 text-right">
                          {app.usefulPct !== null ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="w-16 h-1.5 bg-[#1F2444] rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-[#00B894]" style={{ width: `${app.usefulPct}%` }} />
                              </div>
                              <span className={app.usefulPct >= 70 ? 'text-green-400' : app.usefulPct >= 50 ? 'text-yellow-400' : 'text-red-400'}>
                                {app.usefulPct}%
                              </span>
                            </div>
                          ) : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5 pr-4 text-right">
                          {app.notUsefulPct !== null && app.notUsefulPct > 0
                            ? <span className="text-red-400">{app.notUsefulPct}%</span>
                            : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-slate-400">
                          {app.lastRunAllTime ? timeAgo(app.lastRunAllTime) : '—'}
                        </td>
                        <td className="py-2.5 text-right">
                          {app.needsReview ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/25">
                              ⚠ Review
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-green-500/10 text-green-400 border border-green-500/20">
                              ✓ OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {appHealth.some(a => a.rated === 0) && (
                <p className="text-[10px] text-slate-600 mt-3">
                  💡 Apps with no ratings yet don't show a useful rate. Rate results with 👍 👎 in the runner.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
