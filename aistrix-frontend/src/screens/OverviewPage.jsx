import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { timeAgo } from '../utils'
import { scopeToWorkspace } from '../lib/workspace'

// ~$0.002 per run is a rough blended estimate across Claude/GPT-4o usage
const COST_PER_RUN = 0.002
const MINUTES_PER_RUN = 5

function RoiMetric({ label, value, sub, accent = '#6C5CE7', icon }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon && <span className="text-sm">{icon}</span>}
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value ?? '—'}</p>
      {sub && <p className="text-[10px] text-slate-500 leading-relaxed">{sub}</p>}
    </div>
  )
}

function MiniBar({ count, max, day }) {
  const pct = max > 0 ? Math.max((count / max) * 100, count > 0 ? 6 : 0) : 0
  return (
    <div className="flex flex-col items-center gap-1.5 flex-1">
      <span className="text-[10px] text-slate-500">{count || ''}</span>
      <div className="w-full bg-[#1F2444] rounded-full flex items-end overflow-hidden" style={{ height: 48 }}>
        <div className="w-full bg-[#6C5CE7] rounded-full transition-all" style={{ height: `${pct}%` }} />
      </div>
      <span className="text-[9px] text-slate-600">{day}</span>
    </div>
  )
}

export default function OverviewPage({ user, onSelectApp }) {
  const [stats, setStats] = useState(null)
  const [recentRuns, setRecentRuns] = useState([])
  const [topApps, setTopApps] = useState([])
  const [topFlows, setTopFlows] = useState([])
  const [dayCounts, setDayCounts] = useState([])
  const [nextActions, setNextActions] = useState([])
  const [roiStats, setRoiStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is stable per user; adding it as a dep would re-run this every render
  }, [user])

  async function load() {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const day30ago = new Date(); day30ago.setDate(day30ago.getDate() - 29); day30ago.setHours(0, 0, 0, 0)
    const day14ago = new Date(); day14ago.setDate(day14ago.getDate() - 13); day14ago.setHours(0, 0, 0, 0)

    const [
      { count: totalRuns },
      { count: todayRuns },
      { data: recent },
      { data: apps },
      { data: history14 },
      { count: failedCount },
      { count: workflowCount },
      { data: flows },
    ] = await Promise.all([
      supabase.from('run_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('run_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', startOfDay.toISOString()),
      supabase.from('run_history').select('id, app_name, flow_name, input, created_at, rating_value').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('apps').select('id, name, emoji, color, total_runs').eq('is_published', true).order('total_runs', { ascending: false }).limit(5),
      supabase.from('run_history').select('created_at').eq('user_id', user.id).gte('created_at', day14ago.toISOString()),
      supabase.from('run_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id).like('output', 'Backend error%'),
      scopeToWorkspace(supabase.from('flows').select('id', { count: 'exact', head: true }), user),
      scopeToWorkspace(supabase.from('flows').select('id, name, emoji, steps'), user).limit(20),
    ])

    // Build 14-day chart
    const buckets = {}
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      buckets[key] = 0
    }
    history14?.forEach(r => {
      const key = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (key in buckets) buckets[key]++
    })
    const counts = Object.entries(buckets).map(([day, count]) => ({ day, count }))
    const maxCount = Math.max(...counts.map(c => c.count), 1)

    // ROI calculations
    const total = totalRuns ?? 0
    const minutesSaved = total * MINUTES_PER_RUN
    const hoursSaved = minutesSaved >= 60
      ? `${Math.floor(minutesSaved / 60)}h ${minutesSaved % 60}m`
      : `${minutesSaved}m`
    const stepsAutomated = (flows ?? []).reduce((n, f) => n + (f.steps?.length || 0), 0) * Math.max(total, 1)
    const costEstimate = (total * COST_PER_RUN).toFixed(2)

    // Most-used workflows: count runs per flow_name from run_history
    const { data: flowRunData } = await supabase
      .from('run_history')
      .select('flow_name')
      .eq('user_id', user.id)
      .not('flow_name', 'is', null)
      .gte('created_at', day30ago.toISOString())

    const flowRunCounts = {}
    flowRunData?.forEach(r => {
      if (r.flow_name) flowRunCounts[r.flow_name] = (flowRunCounts[r.flow_name] || 0) + 1
    })
    const topFlowsList = Object.entries(flowRunCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => {
        const flow = (flows ?? []).find(f => f.name === name)
        return { name, count, emoji: flow?.emoji || '⚡' }
      })

    // Team adoption: count distinct users who ran any app (needs run_history to have user_id queryable)
    // We'll show the user's own active days as a proxy when team data isn't available
    const activeDays30 = (history14?.length ?? 0) > 0
      ? new Set(history14.map(r => new Date(r.created_at).toDateString())).size
      : 0

    setRoiStats({
      hoursSaved,
      minutesSaved,
      failedCount: failedCount ?? 0,
      workflowCount: workflowCount ?? 0,
      stepsAutomated,
      costEstimate,
      activeDays30,
      successRate: total > 0 ? Math.round(((total - (failedCount ?? 0)) / total) * 100) : 100,
    })
    setStats({ totalRuns: total, todayRuns: todayRuns ?? 0 })
    setRecentRuns(recent ?? [])
    setTopApps(apps ?? [])
    setTopFlows(topFlowsList)
    setDayCounts(counts.map(c => ({ ...c, max: maxCount })))

    // Next action recommendations
    if (flows?.length) {
      const allAppIds = [...new Set(flows.flatMap(f => (f.steps || []).map(s => s.app_id).filter(Boolean)))]
      const { data: ranApps } = await supabase.from('run_history').select('app_id').eq('user_id', user.id).in('app_id', allAppIds)
      const ranSet = new Set((ranApps || []).map(r => r.app_id))
      const suggestions = []
      for (const flow of flows) {
        const steps = flow.steps || []
        const nextStep = steps.find(s => s.app_id && !ranSet.has(s.app_id))
        if (nextStep) {
          const { data: appData } = await supabase.from('apps').select('id, name, emoji, description').eq('id', nextStep.app_id).maybeSingle()
          if (appData) suggestions.push({ flow, app: appData, stepNum: steps.indexOf(nextStep) + 1, total: steps.length })
        }
      }
      setNextActions(suggestions.slice(0, 3))
    }
    setLoading(false)
  }

  if (loading) return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
      {/* Greeting skeleton */}
      <div className="space-y-2">
        <div className="h-6 w-56 bg-white/8 rounded-lg animate-pulse" />
        <div className="h-4 w-80 bg-white/5 rounded-lg animate-pulse" />
      </div>
      {/* ROI card skeleton */}
      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <div className="h-10 bg-white/5 animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5">
          {[0,1,2,3].map(i => (
            <div key={i} className="bg-[#0E1424] px-4 py-5 space-y-2">
              <div className="h-3 w-20 bg-white/8 rounded animate-pulse" />
              <div className="h-7 w-14 bg-white/12 rounded-lg animate-pulse" />
              <div className="h-3 w-28 bg-white/5 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-px bg-white/5">
          {[0,1,2].map(i => (
            <div key={i} className="bg-[#0E1424] px-4 py-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/8 animate-pulse shrink-0" />
              <div className="space-y-1.5">
                <div className="h-5 w-10 bg-white/10 rounded animate-pulse" />
                <div className="h-3 w-20 bg-white/5 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Recent runs skeleton */}
      <div className="rounded-2xl border border-white/10 p-5 space-y-3">
        <div className="h-4 w-32 bg-white/8 rounded animate-pulse" />
        {[0,1,2].map(i => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-white/8 animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-40 bg-white/8 rounded animate-pulse" />
              <div className="h-2.5 w-64 bg-white/5 rounded animate-pulse" />
            </div>
            <div className="h-3 w-16 bg-white/5 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
      <div>
        <h1 className="text-white text-xl font-semibold mb-1">
          Good {greeting}, {user?.user_metadata?.display_name || user?.email?.split('@')[0]} 👋
        </h1>
        <p className="text-slate-400 text-sm">Your AI workflows are running. Here's the business impact so far.</p>
      </div>

      {/* ── ROI Dashboard ─────────────────────────────────────────────────── */}
      {roiStats && (
        <div className="rounded-2xl border border-[#6C5CE7]/25 overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3 flex items-center justify-between"
            style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.15), rgba(232,67,147,0.08))' }}>
            <p className="text-xs font-bold text-white tracking-wide uppercase">ROI Dashboard</p>
            <span className="text-[10px] text-slate-500">~{MINUTES_PER_RUN} min saved per run · ${COST_PER_RUN}/run est.</span>
          </div>

          {/* Primary metrics row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5">
            {[
              {
                label: 'Time saved',
                value: roiStats.hoursSaved,
                sub: `${roiStats.minutesSaved} minutes total`,
                accent: '#A29BFE',
                icon: '⏱️',
                bg: 'from-[#6C5CE7]/8',
              },
              {
                label: 'Runs completed',
                value: stats.totalRuns,
                sub: `${stats.todayRuns} today`,
                accent: '#00B894',
                icon: '⚡',
                bg: 'from-[#00B894]/8',
              },
              {
                label: 'Manual steps automated',
                value: roiStats.stepsAutomated.toLocaleString(),
                sub: `across ${roiStats.workflowCount} workflows`,
                accent: '#74B9FF',
                icon: '🤖',
                bg: 'from-[#0984E3]/8',
              },
              {
                label: 'API cost estimate',
                value: `$${roiStats.costEstimate}`,
                sub: `vs hours of manual work`,
                accent: '#FDCB6E',
                icon: '💰',
                bg: 'from-[#FDCB6E]/8',
              },
            ].map(m => (
              <div key={m.label} className={`bg-gradient-to-b ${m.bg} to-[#0E1424] px-4 py-4`}>
                <RoiMetric {...m} />
              </div>
            ))}
          </div>

          {/* Secondary metrics row */}
          <div className="grid grid-cols-3 gap-px bg-white/5">
            {/* Failed runs */}
            <div className="bg-[#0E1424] px-4 py-3 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${roiStats.failedCount > 0 ? 'bg-red-500/15' : 'bg-green-500/12'}`}>
                {roiStats.failedCount > 0 ? '⚠️' : '✓'}
              </div>
              <div>
                <p className={`text-lg font-bold ${roiStats.failedCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {roiStats.failedCount > 0 ? roiStats.failedCount : 'None'}
                </p>
                <p className="text-[10px] text-slate-500">Failed runs</p>
                <p className="text-[9px] text-slate-600">{roiStats.successRate}% success rate</p>
              </div>
            </div>

            {/* Most used workflow */}
            <div className="bg-[#0E1424] px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#6C5CE7]/15 flex items-center justify-center text-sm shrink-0">
                {topFlows[0]?.emoji || '⚡'}
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold text-white truncate">{topFlows[0]?.name || '—'}</p>
                <p className="text-[10px] text-slate-500">Top workflow (30d)</p>
                <p className="text-[9px] text-slate-600">{topFlows[0]?.count ?? 0} runs</p>
              </div>
            </div>

            {/* Team adoption / active days */}
            <div className="bg-[#0E1424] px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#E84393]/12 flex items-center justify-center text-sm shrink-0">
                📅
              </div>
              <div>
                <p className="text-lg font-bold text-[#E84393]">{roiStats.activeDays30}</p>
                <p className="text-[10px] text-slate-500">Active days (14d)</p>
                <p className="text-[9px] text-slate-600">Days with at least 1 run</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Most used workflows ────────────────────────────────────────────── */}
      {topFlows.length > 0 && (
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
          <p className="text-sm font-medium text-white mb-4">Most used workflows — last 30 days</p>
          <div className="space-y-2.5">
            {topFlows.map((f, i) => {
              const pct = topFlows[0].count > 0 ? (f.count / topFlows[0].count) * 100 : 0
              return (
                <div key={f.name} className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-600 w-4 text-right shrink-0">{i + 1}</span>
                  <span className="text-base shrink-0">{f.emoji}</span>
                  <span className="text-xs text-slate-300 w-40 truncate shrink-0">{f.name}</span>
                  <div className="flex-1 bg-[#1F2444] rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-[#6C5CE7] rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-500 w-14 text-right shrink-0">{f.count} runs</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── What's Next ───────────────────────────────────────────────────── */}
      {nextActions.length > 0 && (
        <div className="bg-gradient-to-r from-[#6C5CE7]/10 to-[#E84393]/10 border border-[#6C5CE7]/20 rounded-2xl p-5">
          <p className="text-sm font-semibold text-white mb-3">⚡ What's next for you</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {nextActions.map(({ flow, app, stepNum, total }) => (
              <button key={app.id} onClick={() => onSelectApp?.(app)}
                className="text-left bg-[#171B33] hover:bg-[#1F2444] border border-white/5 hover:border-[#6C5CE7]/40 rounded-xl p-3.5 transition-all group">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{app.emoji}</span>
                  <span className="text-[10px] text-slate-500 bg-[#1F2444] group-hover:bg-[#272C52] px-2 py-0.5 rounded-full">
                    {flow.emoji} {flow.name} · Step {stepNum}/{total}
                  </span>
                </div>
                <p className="text-sm font-medium text-white mb-0.5">{app.name}</p>
                <p className="text-[11px] text-slate-400 line-clamp-2">{app.description}</p>
                <p className="text-[10px] text-[#6C5CE7] mt-2 group-hover:text-white transition-colors">Run now →</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Activity chart ────────────────────────────────────────────────── */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
        <p className="text-sm font-medium text-white mb-4">Activity — last 14 days</p>
        {dayCounts.every(c => c.count === 0) ? (
          <p className="text-slate-500 text-sm text-center py-6">No runs yet — run an app to see activity here.</p>
        ) : (
          <div className="flex gap-1.5 items-end" style={{ height: 80 }}>
            {dayCounts.map(({ day, count, max }) => (
              <MiniBar key={day} count={count} max={max} day={day.split(' ')[1]} />
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent runs */}
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
          <p className="text-sm font-medium text-white mb-4">Recent runs</p>
          {recentRuns.length === 0 ? (
            <p className="text-slate-500 text-sm">No runs yet.</p>
          ) : (
            <div className="space-y-2">
              {recentRuns.map(run => (
                <div key={run.id} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-[#6C5CE7]">{run.flow_name || run.app_name}</span>
                      <span className="text-[10px] text-slate-500">{timeAgo(run.created_at)}</span>
                      {run.rating_value === 1 && <span className="text-[10px]">👍</span>}
                      {run.rating_value === -1 && <span className="text-[10px]">👎</span>}
                    </div>
                    <p className="text-xs text-slate-400 truncate">{run.input}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Most used apps */}
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
          <p className="text-sm font-medium text-white mb-4">Most used apps</p>
          {topApps.length === 0 ? (
            <p className="text-slate-500 text-sm">Run apps to see usage here.</p>
          ) : (
            <div className="space-y-2">
              {topApps.map((app, i) => {
                const pct = topApps[0].total_runs > 0 ? (app.total_runs / topApps[0].total_runs) * 100 : 0
                return (
                  <div key={app.id} className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-600 w-4 text-right">{i + 1}</span>
                    <span className="text-base shrink-0">{app.emoji}</span>
                    <span className="text-xs text-slate-300 w-36 truncate shrink-0">{app.name}</span>
                    <div className="flex-1 bg-[#1F2444] rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-[#6C5CE7] rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-500 w-12 text-right shrink-0">{app.total_runs} runs</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
