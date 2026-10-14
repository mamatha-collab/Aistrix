import { useState, useEffect, lazy, Suspense } from 'react'
import { track, EVENTS } from '../lib/analytics'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import ErrorBoundary from '../components/ErrorBoundary'
import { scopeToWorkspace } from '../lib/workspace'
import NotificationsPanel from '../components/NotificationsPanel'
import { Search, X } from 'lucide-react'
import { AppEmojiWithType, AppNavigator, DEV_PHASES, EMPTY_BP, HelpPanel, MoveBackModal, TAB_NOTES, TabNoteFolderTab, WelcomeScreen, calcReadiness, getDevPhase, migrateBlueprint, normalizeDevPhase } from './devstudio/shared'

// Each step loads when it is opened (keeps the first Dev Studio load small).
const TAB_LOADING = <div className="py-16 text-center text-slate-500 text-sm">Loading…</div>
const DeployTab = lazy(() => import('./devstudio/DeployTab').then(m => ({ default: m.DeployTab })))
const DesignTab = lazy(() => import('./devstudio/DesignTab').then(m => ({ default: m.DesignTab })))
const EvaluateTab = lazy(() => import('./devstudio/OperateTabs').then(m => ({ default: m.EvaluateTab })))
const ImproveTab = lazy(() => import('./devstudio/OperateTabs').then(m => ({ default: m.ImproveTab })))
const MonetizeTab = lazy(() => import('./devstudio/OperateTabs').then(m => ({ default: m.MonetizeTab })))
const MonitorTab = lazy(() => import('./devstudio/OperateTabs').then(m => ({ default: m.MonitorTab })))
const SecretsTab = lazy(() => import('./devstudio/OperateTabs').then(m => ({ default: m.SecretsTab })))
const SellTab = lazy(() => import('./devstudio/OperateTabs').then(m => ({ default: m.SellTab })))
const VersionTab = lazy(() => import('./devstudio/OperateTabs').then(m => ({ default: m.VersionTab })))
const TestTab = lazy(() => import('./devstudio/TestTab').then(m => ({ default: m.TestTab })))


// ─── Main Page ────────────────────────────────────────────────────────────────

const LIFECYCLE_TABS = [
  { id: 'design',   label: 'Design',      icon: '✏️',  desc: 'Blueprint', group: 'build' },
  { id: 'test',     label: 'Test',        icon: '🧪',  desc: 'Validate',  group: 'build' },
  { id: 'deploy',   label: 'Deploy',      icon: '🚀',  desc: 'Publish',   group: 'build' },
  { id: 'sell',     label: 'Marketplace', short: 'Market', icon: '🛒',  desc: 'List',      group: 'grow' },
  { id: 'monitor',  label: 'Monitor',     icon: '📡',  desc: 'Usage',     group: 'grow' },
  { id: 'evaluate', label: 'Evaluate',    short: 'Eval', icon: '🎯',  desc: 'Quality',   group: 'grow' },
  { id: 'improve',  label: 'Improve',     icon: '🔬',  desc: 'Iterate',   group: 'grow' },
  { id: 'version',  label: 'Version',     icon: '📦',  desc: 'History',   group: 'manage' },
  { id: 'monetize', label: 'Revenue',     icon: '💰',  desc: 'Profit',    group: 'manage' },
  { id: 'secrets',  label: 'Secrets',     icon: '🔐',  desc: 'Env vars',  group: 'manage' },
]

const LIFECYCLE_GROUPS = [
  { id: 'build',  label: 'Build' },
  { id: 'grow',   label: 'Operate & Grow' },
  { id: 'manage', label: 'Manage' },
]

export default function DevStudioPage({
  user,
  onOpenCreate,
  onShowHistory,
  onShowSettings,
  noKeys = false,
  onNavChange,
  search = '',
  onSearch,
  searchRef,
  createdApp,
  onCreatedAppConsumed,
}) {
  const [tab, setTab] = useState('design')
  // Below 1280px the app list is a slide-in panel instead of a fixed column.
  const [appsDrawer, setAppsDrawer] = useState(false)
  const [smallScreenNote, setSmallScreenNote] = useState(() => {
    try { return localStorage.getItem('aistrix_small_screen_note') !== 'dismissed' } catch { return true }
  })
  const NAVIGATOR_TABS = ['design','test','deploy','improve','version','secrets']
  const [activeAppId, setActiveAppId] = useState(null)
  const [deployFixReason, setDeployFixReason] = useState('')
  const [apps, setApps] = useState([])
  const [runs, setRuns] = useState([])
  const [appStats, setAppStats] = useState({})
  const [totalStats, setTotalStats] = useState({ runs: 0, users: 0, satisfaction: null })
  const [entitlements, setEntitlements] = useState([])
  const [loading, setLoading] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [phaseByAppId, setPhaseByAppId] = useState({})  // explicit phase overrides per app
  const [moveBack, setMoveBack] = useState(null)        // { app, phase } while asking why a deployed app goes back
  const toast = useToast()

  useEffect(() => {
    if (!createdApp) return
    setApps(prev => prev.some(a => a.id === createdApp.id) ? prev : [createdApp, ...prev])
    setActiveAppId(createdApp.id)
    setTab('design')
    onCreatedAppConsumed?.()
  }, [createdApp]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
    // Handle OAuth / Connect return redirects
    const params = new URLSearchParams(window.location.search)
    if (params.get('github_connected') === '1') {
      // toast shown by next render; clean up URL
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('stripe_connect') === 'success') {
      window.history.replaceState({}, '', window.location.pathname)
      setTab('monetize')
    }
  }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const { data: myApps } = await scopeToWorkspace(supabase.from('apps').select('*'), user, 'created_by')
      .order('total_runs', { ascending: false })
    if (!myApps?.length) { setLoading(false); return }
    setApps(myApps)
    setActiveAppId(prev => myApps.some(a => a.id === prev) ? prev : null)

    // Load blueprint dev phases. This is separate from apps.status, which is used by moderation/marketplace review.
    const { data: bpRows } = await supabase.from('app_blueprints')
      .select('app_id, blueprint').in('app_id', myApps.map(a => a.id))
    if (bpRows?.length) {
      const phases = {}
      for (const row of bpRows) {
        const phase = normalizeDevPhase(row.blueprint?.dev_phase)
        if (phase) phases[row.app_id] = phase
      }
      setPhaseByAppId(phases)
    }

    const [{ data: runData }, { data: entData }] = await Promise.all([
      supabase.from('run_history')
        .select('id, app_id, app_name, created_at, rating_value, user_id, input_tokens, output_tokens, input, output')
        .in('app_id', myApps.map(a => a.id)),
      supabase.from('app_entitlements')
        .select('id, app_id, user_id, plan, status, runs_this_period, run_quota, current_period_end, created_at')
        .in('app_id', myApps.map(a => a.id)),
    ])
    const allRuns = runData || []
    setRuns(allRuns)
    setEntitlements(entData || [])

    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const statsMap = {}
    myApps.forEach(app => {
      const appRuns = allRuns.filter(r => r.app_id === app.id)
      const recent  = appRuns.filter(r => new Date(r.created_at) >= sevenDaysAgo)
      const daily   = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0,0,0,0)
        const next = new Date(d); next.setDate(next.getDate() + 1)
        return recent.filter(r => new Date(r.created_at) >= d && new Date(r.created_at) < next).length
      })
      const rated = appRuns.filter(r => r.rating_value != null)
      statsMap[app.id] = { uniqueUsers: new Set(appRuns.map(r => r.user_id)).size, thumbsUp: rated.filter(r => r.rating_value === 1).length, rated: rated.length, daily }
    })
    setAppStats(statsMap)

    const allRated = allRuns.filter(r => r.rating_value != null)
    setTotalStats({
      runs: allRuns.length,
      users: new Set(allRuns.map(r => r.user_id)).size,
      satisfaction: allRated.length > 0 ? Math.round((allRated.filter(r => r.rating_value === 1).length / allRated.length) * 100) : null,
    })
    setLoading(false)
  }

  function updateAppInState(updated) {
    setApps(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))
  }

  async function moveAppPhase(appId, newPhase, { confirmed = false, tracked = false } = {}) {
    const phase = normalizeDevPhase(newPhase) || 'design'
    const app = apps.find(a => a.id === appId)
    // Leaving Deploy: warn about the live version and ask why (MoveBackModal).
    if (!confirmed && phase !== 'deploy' && app && getDevPhase(app, phaseByAppId) === 'deploy') {
      setMoveBack({ app, phase })
      return
    }
    if (!tracked) track(EVENTS.BUILD_PHASE_MOVED, { app_id: appId, from: app ? getDevPhase(app, phaseByAppId) : null, to: phase })
    setPhaseByAppId(prev => ({ ...prev, [appId]: phase }))
    // A live app stays live while it's changed: end users keep running the
    // published version until a new one passes its tests and is published.

    const { data: row } = await supabase.from('app_blueprints')
      .select('blueprint').eq('app_id', appId).maybeSingle()
    const blueprint = migrateBlueprint({ ...EMPTY_BP, ...(row?.blueprint || {}), dev_phase: phase })
    await supabase.from('app_blueprints').upsert(
      { app_id: appId, user_id: user.id, blueprint, readiness_score: app ? calcReadiness(app, blueprint) : 0, updated_at: new Date().toISOString() },
      { onConflict: 'app_id' }
    )

    if (phase === 'deploy') { setActiveAppId(appId); setTab('deploy') }
    else if (phase === 'test') { setActiveAppId(appId); setTab('test') }
    else { setActiveAppId(appId); setTab('design') }
  }

  async function confirmMoveBack(note) {
    const { app, phase } = moveBack
    const { error } = await supabase.from('apps').update({ change_note: note }).eq('id', app.id)
    if (error) { toast(error.message, 'error'); return }
    updateAppInState({ ...app, change_note: note })
    setMoveBack(null)
    track(EVENTS.BUILD_PHASE_MOVED, { app_id: app.id, from: 'deploy', to: phase, reason: note.reason, live: !!app.is_published })
    await moveAppPhase(app.id, phase, { confirmed: true, tracked: true })
  }

  function returnToDesignForPublishFix(appId, reason) {
    setDeployFixReason(reason || 'the app contract')
    moveAppPhase(appId, 'design')
  }

  const searchNeedle = (search || '').trim().toLowerCase()
  const appMatchesSearch = (app) => {
    if (!app) return false
    if (!searchNeedle) return true
    return [
      app.name,
      app.description,
      app.type,
      app.domain,
      app.category,
      app.status,
      getDevPhase(app, phaseByAppId),
    ].filter(Boolean).join(' ').toLowerCase().includes(searchNeedle)
  }
  const visibleApps = searchNeedle ? apps.filter(appMatchesSearch) : apps
  const activeApp = apps.find(a => a.id === activeAppId) || null
  const activeAppPhase = activeApp ? getDevPhase(activeApp, phaseByAppId) : null
  const activeTabMeta = LIFECYCLE_TABS.find(t => t.id === tab) || LIFECYCLE_TABS[0]
  const activePhaseApps = ['design','test','deploy'].includes(tab)
    ? visibleApps.filter(a => getDevPhase(a, phaseByAppId) === tab)
    : visibleApps
  const phaseScopedActiveAppId = ['design','test','deploy'].includes(tab) && (activeAppPhase !== tab || !appMatchesSearch(activeApp))
    ? null
    : activeAppId

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {moveBack && <MoveBackModal app={moveBack.app} phase={moveBack.phase} onCancel={() => setMoveBack(null)} onConfirm={confirmMoveBack} />}

      {/* ── Sticky top bar: tab ribbon + guide + tab note folder tab ── */}
      <div className="sticky top-0 z-30 bg-[#09101F] border-b border-white/5">
        {(loading || apps.length > 0) && (
          <>
            <div className="h-[72px] px-4 xl:px-6 bg-[#111827] border-b border-white/5 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[260px_minmax(0,1fr)_auto] items-center gap-3">
              <div className="min-w-0 hidden md:block">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-[#6C5CE7]/18 border border-[#6C5CE7]/30 flex items-center justify-center text-sm">{activeTabMeta.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-start gap-1.5 min-w-0">
                      <p className="text-white font-bold text-lg leading-tight truncate">Aistrix</p>
                      <span className="-mt-1.5 px-2 py-0.5 rounded-full bg-[#00D4AA]/10 border border-[#00D4AA]/20 text-[#00D4AA] text-[9px] font-bold uppercase tracking-wider shrink-0">Developer</span>
                    </div>
                    <p className="text-slate-400 text-xs truncate mt-0.5">{activeTabMeta.label} · {activeTabMeta.desc}</p>
                  </div>
                </div>
              </div>

              <div className="hidden xl:block" />

              <div className="flex items-center gap-2 shrink-0 justify-self-end max-w-full overflow-x-auto">
                {NAVIGATOR_TABS.includes(tab) && (
                  <button onClick={() => setAppsDrawer(true)} aria-label="Open the app list"
                    className="xl:hidden h-10 px-3 rounded-xl bg-[#0E1424] border border-white/8 text-sm text-slate-300 hover:text-white transition-colors whitespace-nowrap">
                    ☰ Apps
                  </button>
                )}
                <div className="hidden xl:flex items-center gap-2 bg-[#0E1424] border border-white/8 rounded-xl px-3 h-10 text-sm text-slate-300 w-48 2xl:w-56">
                  <Search size={15} className="shrink-0 text-slate-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => onSearch?.(e.target.value)}
                    placeholder="Search"
                    aria-label="Search developer apps, runs, and versions"
                    ref={searchRef}
                    className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
                  />
                  {search && (
                    <button onClick={() => onSearch?.('')} aria-label="Clear search" className="text-slate-500 hover:text-white transition-colors shrink-0">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 rounded-xl bg-[#0E1424] border border-white/8 p-1">
                  <NotificationsPanel user={user} onNavChange={onNavChange} />
                  <button
                    onClick={onShowHistory}
                    className="hover:bg-[#1A2038] text-slate-200 text-xs font-semibold px-2.5 py-2 rounded-lg transition-colors whitespace-nowrap"
                  >
                    History
                  </button>
                  <button
                    onClick={onShowSettings}
                    aria-label={noKeys ? 'Keys — no AI key added yet' : undefined}
                    title={noKeys ? 'No AI key added — add one to build apps' : undefined}
                    className="relative hover:bg-[#1A2038] text-slate-200 text-xs font-semibold px-2.5 py-2 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Keys
                    {noKeys && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-[#0F1225] text-[10px] font-bold flex items-center justify-center" aria-hidden="true">!</span>}
                  </button>
                </div>
                <button onClick={onOpenCreate}
                  className="bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white text-xs font-bold px-3 py-2.5 rounded-xl transition-colors shadow-lg shadow-[#6C5CE7]/20 whitespace-nowrap">
                  + App
                </button>
                <div className="flex items-center gap-1 rounded-xl bg-[#0E1424] border border-white/8 p-1">
                  {TAB_NOTES[tab] && <TabNoteFolderTab id={tab} />}
                  <button
                    onClick={() => setShowHelp(true)}
                    title="Guide"
                    aria-label="Guide"
                    className="group w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#1A2038] transition-colors duration-300"
                  >
                    <span className="aistrix-guide-bulb relative w-7 h-7 rounded-full bg-[#6C5CE7]/25 text-[#A29BFE] text-xs font-bold flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:bg-[#6C5CE7]/35 group-hover:text-white group-active:scale-95">?</span>
                  </button>
                </div>
              </div>
            </div>

            {smallScreenNote && (
              <div className="md:hidden flex items-start gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-200">
                <span className="flex-1">Dev Studio works best on a larger screen. You can still check on your apps here.</span>
                <button aria-label="Dismiss" className="text-amber-200/70 hover:text-white px-1"
                  onClick={() => { setSmallScreenNote(false); try { localStorage.setItem('aistrix_small_screen_note', 'dismissed') } catch { /* private mode */ } }}>×</button>
              </div>
            )}
            <div className="min-h-[92px] bg-[#1A2038] grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] overflow-x-auto overflow-y-hidden">
              <div className="min-w-0 px-4 py-3">
                <div className="grid grid-cols-[0.9fr_1.18fr_0.9fr] gap-2 h-full min-w-[640px]">
                  {LIFECYCLE_GROUPS.map(group => (
                    <div key={group.id} className="min-w-0 rounded-2xl bg-[#111827]/60 border border-white/8 p-2 h-[68px]">
                      <p className="px-2 pb-1.5 text-[9px] text-slate-500 uppercase font-bold tracking-wider leading-none truncate">{group.label}</p>
                      <div className="flex gap-1 min-w-0">
                        {LIFECYCLE_TABS.filter(t => t.group === group.id).map(t => {
                          const active = tab === t.id
                          return (
                            <button key={t.id} onClick={() => { setTab(t.id); if (['design','test','deploy'].includes(t.id)) setActiveAppId(null) }}
                              title={`${t.label}: ${t.desc}`}
                              className={`flex-1 min-w-0 h-[42px] px-1.5 py-1.5 rounded-xl transition-all text-left ${
                                active
                                  ? 'bg-[#6C5CE7] text-white shadow-md shadow-[#6C5CE7]/25'
                                  : 'text-slate-400 hover:text-white hover:bg-white/5'
                              }`}>
                              <span className="flex items-center gap-1 min-w-0">
                                <span className="text-sm leading-none shrink-0">{t.icon}</span>
                                <span className="text-[10px] font-bold leading-none whitespace-nowrap truncate">{t.short || t.label}</span>
                              </span>
                              <span className={`block text-[9px] leading-none mt-1 whitespace-nowrap truncate ${active ? 'text-white/70' : 'text-slate-600'}`}>{t.desc || ' '}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hidden xl:block border-l border-white/5 px-4 py-3">
                <div className="h-[68px] rounded-2xl bg-[#111827]/60 border border-white/8 p-2 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-[#0E1424] border border-white/5 px-2 py-2">
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider leading-none">Apps</p>
                    <p className="text-white text-lg font-bold mt-1 leading-none">{apps.length}</p>
                  </div>
                  <div className="rounded-xl bg-[#0E1424] border border-white/5 px-2 py-2">
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider leading-none">Runs</p>
                    <p className="text-white text-lg font-bold mt-1 leading-none">{totalStats.runs}</p>
                  </div>
                  <div className="rounded-xl bg-[#0E1424] border border-white/5 px-2 py-2">
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider leading-none">Useful</p>
                    <p className="text-white text-lg font-bold mt-1 leading-none">{totalStats.satisfaction ?? '—'}{totalStats.satisfaction != null ? '%' : ''}</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Body: content + right panes ── */}
      {/* First-time welcome screen (scrolls on its own; the top bar above doesn't) */}
      {!loading && apps.length === 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6">
          <WelcomeScreen onCreateApp={onOpenCreate} />
        </div>
      )}

      {(loading || apps.length > 0) && (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Main content */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-6 space-y-5">
            {/* Tab content */}
            {['design','test','deploy'].includes(tab) ? (
              phaseScopedActiveAppId ? (
                <ErrorBoundary compact title={`${DEV_PHASES[tab]?.label || 'Dev Studio'} section could not load`} resetKey={`${tab}:${phaseScopedActiveAppId}`}>
                  <Suspense fallback={TAB_LOADING}>
                  {tab === 'design' && <DesignTab   apps={activePhaseApps} allApps={apps} loading={loading} onOpenCreate={onOpenCreate} user={user} onAppUpdated={updateAppInState} onGoToTest={appId => { moveAppPhase(appId, 'test'); setDeployFixReason('') }} selectedAppId={phaseScopedActiveAppId} onSelectApp={setActiveAppId} deployFixReason={deployFixReason} phaseByAppId={phaseByAppId} />}
                  {tab === 'test'   && <TestTab     apps={activePhaseApps} allApps={apps} user={user} selectedAppId={phaseScopedActiveAppId} phaseByAppId={phaseByAppId} onMovePhase={moveAppPhase} onOpenKeys={onShowSettings} />}
                  {tab === 'deploy' && <DeployTab   apps={activePhaseApps} user={user} onAppUpdated={updateAppInState} onFixInDesign={returnToDesignForPublishFix} selectedAppId={phaseScopedActiveAppId} onSelectApp={setActiveAppId} onMovePhase={moveAppPhase} onOpenKeys={onShowSettings} />}
                  </Suspense>
                </ErrorBoundary>
              ) : (
                (() => {
                  const designApps = visibleApps.filter(a => getDevPhase(a, phaseByAppId) === 'design')
                  const appRow = (a, onPick) => {
                    const pick = typeof onPick === 'function' ? onPick : () => setActiveAppId(a.id)
                    const phase = DEV_PHASES[getDevPhase(a, phaseByAppId)]
                    return (
                      <div key={a.id} className="relative">
                        <button onClick={pick}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#131929] border border-white/8 hover:border-white/20 hover:bg-[#1A2038] text-left transition-colors">
                          <AppEmojiWithType app={a} size="lg" />
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <p className="text-white text-sm font-semibold truncate">{a.name}</p>
                            <p className="text-slate-500 text-xs truncate">{a.description || 'No description'}</p>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${phase.bg} ${phase.color} ${phase.border}`}>
                            {phase.label}
                          </span>
                        </button>
                      </div>
                    )
                  }
                  if (tab === 'design') return (
                    <div className="space-y-6 max-w-xl mx-auto py-12">
                      <div className="bg-[#171B33] border border-[#6C5CE7]/25 rounded-2xl p-7 text-center shadow-xl shadow-[#6C5CE7]/10">
                        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#6C5CE7]/20 border border-[#6C5CE7]/30 flex items-center justify-center text-2xl">✏️</div>
                        <div>
                          <p className="text-white font-bold text-xl">Design a new AI app</p>
                          <p className="text-slate-400 text-sm mt-2 max-w-sm mx-auto">Start with an app idea, define the blueprint, then move it through Test and Deploy.</p>
                        </div>
                        <button onClick={onOpenCreate}
                          className="mt-6 inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white font-bold text-base transition-colors shadow-lg shadow-[#6C5CE7]/30">
                          ＋ New AI App
                        </button>
                        <p className="text-[11px] text-slate-500 mt-3">Only apps in Design phase can be edited here.</p>
                      </div>
                      {designApps.length > 0 ? (
                        <div className="space-y-2">
                          {designApps.map(appRow)}
                        </div>
                      ) : null}
                    </div>
                  )
                  const testableApps = visibleApps.filter(a => getDevPhase(a, phaseByAppId) === 'test')
                  const deployableApps = visibleApps.filter(a => getDevPhase(a, phaseByAppId) === 'deploy')
                  if (tab === 'test') {
                    if (!testableApps.length && !designApps.length) return (
                      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                        <span className="text-4xl">🧪</span>
                        <p className="text-white font-semibold text-sm">No apps to test yet</p>
                        <p className="text-slate-500 text-xs max-w-xs">Design your first app to get started.</p>
                      </div>
                    )
                    return (
                      <div className="space-y-6 max-w-lg mx-auto py-12">
                        {testableApps.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400/70 px-1">🧪 Ready to test</p>
                            {testableApps.map(appRow)}
                          </div>
                        )}
                        {designApps.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 px-1">✏️ Still designing — blueprint may be incomplete</p>
                            {designApps.map(a => appRow(a, () => moveAppPhase(a.id, 'test')))}
                          </div>
                        )}
                      </div>
                    )
                  }
                  const testedApps = visibleApps.filter(a => getDevPhase(a, phaseByAppId) === 'test')
                  if (!deployableApps.length && !testedApps.length) return (
                    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                      <span className="text-4xl">🚀</span>
                      <p className="text-white font-semibold text-sm">No apps ready to deploy</p>
                      <p className="text-slate-500 text-xs max-w-xs">Complete testing first, then move an app to Deploy phase.</p>
                    </div>
                  )
                  return (
                    <div className="space-y-6 max-w-lg mx-auto py-12">
                      {testedApps.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-widest text-amber-400/70 px-1">🧪 Testing — finish validation before deploying</p>
                          {testedApps.map(appRow)}
                        </div>
                      )}
                      {deployableApps.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/70 px-1">🚀 Ready to deploy</p>
                          {deployableApps.map(appRow)}
                        </div>
                      )}
                    </div>
                  )
                })()
              )
            ) : null}
            {!['design','test','deploy'].includes(tab) && (
            <ErrorBoundary compact title={`${LIFECYCLE_TABS.find(t => t.id === tab)?.label || "This"} section couldn't load`} resetKey={`${tab}:${activeAppId}`}>
            <Suspense fallback={TAB_LOADING}>
            {tab === 'sell'     && <SellTab     apps={apps} user={user} onAppUpdated={updateAppInState} />}
            {tab === 'monitor'  && <MonitorTab  apps={apps} appStats={appStats} loading={loading} totalStats={totalStats} runs={runs} entitlements={entitlements} user={user} />}
            {tab === 'evaluate' && <EvaluateTab apps={apps} appStats={appStats} runs={runs} user={user} />}
            {tab === 'improve'  && <ImproveTab  apps={apps} user={user} runs={runs} selectedAppId={activeAppId} onSelectApp={setActiveAppId} />}
            {tab === 'version'  && <VersionTab  apps={apps} user={user} onAppUpdated={updateAppInState} selectedAppId={activeAppId} onSelectApp={setActiveAppId} />}
            {tab === 'monetize' && <MonetizeTab apps={apps} runs={runs} loading={loading} user={user} />}
            {tab === 'secrets'  && <SecretsTab  apps={apps} user={user} selectedAppId={activeAppId} onSelectApp={setActiveAppId} />}
            </Suspense>
            </ErrorBoundary>
            )}
          </div>

          {/* ── Right: App navigator ── */}
          {NAVIGATOR_TABS.includes(tab) && (
            <div className="hidden xl:block shrink-0 overflow-y-auto border-l border-white/5 w-[340px]">
              <ErrorBoundary variant="card" title="The app list couldn't load" resetKey={tab}>
              <AppNavigator
                apps={visibleApps}
                phaseByAppId={phaseByAppId}
                activeAppId={activeAppId}
                activeTab={tab}
                onSelectApp={id => setActiveAppId(id)}
                onSwitchTab={setTab}
                onMovePhase={moveAppPhase}
                onCreateApp={onOpenCreate}
              />
              </ErrorBoundary>
            </div>
          )}
          {NAVIGATOR_TABS.includes(tab) && appsDrawer && (
            <div className="xl:hidden fixed inset-0 z-40 flex justify-end bg-black/50" onClick={() => setAppsDrawer(false)}>
              <div role="dialog" aria-label="App list" className="h-full max-w-[90vw] overflow-y-auto bg-[#0F1225] border-l border-white/10 shadow-2xl"
                onClick={e => e.stopPropagation()}>
                <div className="flex justify-end px-4 pt-3">
                  <button onClick={() => setAppsDrawer(false)} aria-label="Close the app list" className="text-slate-400 hover:text-white text-lg px-1">×</button>
                </div>
                <ErrorBoundary variant="card" title="The app list couldn't load" resetKey={tab}>
                <AppNavigator
                  apps={visibleApps}
                  phaseByAppId={phaseByAppId}
                  activeAppId={activeAppId}
                  activeTab={tab}
                  onSelectApp={id => { setActiveAppId(id); setAppsDrawer(false) }}
                  onSwitchTab={t => { setTab(t); setAppsDrawer(false) }}
                  onMovePhase={moveAppPhase}
                  onCreateApp={() => { setAppsDrawer(false); onOpenCreate?.() }}
                />
                </ErrorBoundary>
              </div>
            </div>
          )}


        </div>
      )}

      {/* Help panel */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  )
}
