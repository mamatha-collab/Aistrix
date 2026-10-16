import { persistBlueprintPhase } from '../lib/blueprintStorage'
import { signOutOnPurpose } from '../lib/session'
import { APP_PUBLIC_SELECT, withPrivateFields } from '../lib/appColumns'
import { saveAppFields } from '../lib/appFields'
import MobileDeveloper from './devstudio/MobileDeveloper'
import { useMediaQuery } from '../hooks/useMediaQuery'
import OperationsWorkflow from './devstudio/OperationsWorkflow'
import { DeveloperAppList, DeveloperRowSection } from '../components/DeveloperShell'
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { track, EVENTS } from '../lib/analytics'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import ErrorBoundary from '../components/ErrorBoundary'
import ConfirmDialog from '../components/ConfirmDialog'
import { scopeToWorkspace } from '../lib/workspace'
import NotificationsPanel from '../components/NotificationsPanel'
import { ChartNoAxesColumn, ChevronDown, CircleHelp, CirclePlay, ClipboardCheck, Database, History, KeyRound, LockKeyhole, LogOut, Megaphone, Moon, PenLine, Play, Plus, Search, Send, Settings, Sun, TrendingUp, X } from 'lucide-react'
import { applyTheme } from '../utils/theme'
import { AppEmojiWithType, AppNavigator, DEV_PHASES, EMPTY_BP, HelpPanel, MoveBackModal, WelcomeScreen, calcReadiness, getDevPhase, migrateBlueprint, normalizeDevPhase } from './devstudio/shared'

// Each step loads when it is opened (keeps the first Dev Studio load small).
const TAB_LOADING = <div className="py-16 text-center text-slate-500 text-sm">Loading…</div>
const DeployTab = lazy(() => import('./devstudio/DeployTab').then(m => ({ default: m.DeployTab })))
const SettingsPage = lazy(() => import('./SettingsPage'))
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
  { id: 'design',   label: 'Design',      Icon: PenLine,           desc: 'Blueprint', group: 'build' },
  { id: 'test',     label: 'Test',        Icon: CirclePlay,        desc: 'Validate',  group: 'build' },
  { id: 'deploy',   label: 'Deploy',      Icon: Send,              desc: 'Publish',   group: 'build' },
  { id: 'monitor',  label: 'Monitor',     Icon: ChartNoAxesColumn, desc: 'Usage',     group: 'grow' },
  { id: 'evaluate', label: 'Evaluate',    short: 'Eval', Icon: ClipboardCheck, desc: 'Quality', group: 'grow' },
  { id: 'improve',  label: 'Improve',     Icon: TrendingUp,        desc: 'Iterate',   group: 'grow' },
  { id: 'sell',     label: 'Marketplace', short: 'Market', Icon: Megaphone, desc: 'List', group: 'grow' },
  { id: 'version',  label: 'Version',     Icon: History,           desc: 'History',   group: 'manage' },
  { id: 'monetize', label: 'Revenue',     Icon: Database,          desc: 'Profit',    group: 'manage' },
  { id: 'secrets',  label: 'Secrets',     Icon: LockKeyhole,       desc: 'Env vars',  group: 'manage' },
]

const LIFECYCLE_GROUPS = [
  { id: 'build',  label: 'Build' },
  { id: 'grow',   label: 'Operate & Grow' },
  { id: 'manage', label: 'Manage' },
]

export default function DevStudioPage({
  user,
  onOpenCreate: requestCreate,
  creationContent = null,
  onShowHistory,
  onShowSettings,
  noKeys = false,
  onNavChange,
  search = '',
  onSearch,
  searchRef,
  createdApp,
  onCreatedAppConsumed,
  navigationGuardRef: sharedNavigationGuardRef,
}) {
  const isPhone = useMediaQuery('(max-width: 767px)')
  const localNavigationGuardRef = useRef(null)
  const navigationGuardRef = sharedNavigationGuardRef || localNavigationGuardRef
  const [tab, setTabState] = useState('design')
  // Runs a navigation now, or — when the Design editor has unsaved edits —
  // after the developer chooses to discard or save them (its dialog).
  function guarded(action) {
    const guard = navigationGuardRef.current
    if (guard && !guard(action)) return false
    action()
    return true
  }
  const [settingsOpen, setSettingsOpen] = useState(false)
  function openSettings(focus = 'top') { guarded(() => setSettingsOpen(focus)) }
  function onOpenCreate() { guarded(() => { setSettingsOpen(false); setTabState('design'); requestCreate?.() }) }
  function setTab(next) {
    if (next === tab && !pageContent) return true
    return guarded(() => { setSettingsOpen(false); setTabState(next) })
  }
  function openTab(id) {
    if (id === tab && !pageContent) return
    guarded(() => { setSettingsOpen(false); setTabState(id); if (['design','test','deploy'].includes(id)) setActiveAppIdState(null) })
  }
  // Phones: keep the open tab's group (Build / Operate / Manage) in view.
  const ribbonRef = useRef(null)
  useEffect(() => {
    const el = ribbonRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return   // md+: nothing scrolls
    const group = LIFECYCLE_TABS.find(t => t.id === tab)?.group
    const target = group && el.querySelector(`[data-group="${group}"]`)
    if (target) el.scrollTo({ left: target.offsetLeft - el.offsetLeft, behavior: 'smooth' })
  }, [tab])
  const [activeAppId, setActiveAppIdState] = useState(null)
  function setActiveAppId(next) {
    if (typeof next === 'function' || next === activeAppId) setActiveAppIdState(next)
    else guarded(() => setActiveAppIdState(next))
  }
  const [deployFixReason, setDeployFixReason] = useState('')
  const [apps, setApps] = useState([])
  const [runs, setRuns] = useState([])
  const [feedbackError, setFeedbackError] = useState('')
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [appStats, setAppStats] = useState({})
  const [totalStats, setTotalStats] = useState({ runs: 0, users: 0, satisfaction: null })
  const [entitlements, setEntitlements] = useState([])
  const [loading, setLoading] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountMenuRef = useRef(null)
  const workspaceMenuRef = useRef(null)
  useEffect(() => {
    const outside = event => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountOpen(false)
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target)) workspaceMenuRef.current.open = false
    }
    const escape = event => {
      if (event.key !== 'Escape' || (!accountOpen && !workspaceMenuRef.current?.open)) return
      event.preventDefault()
      event.stopPropagation()
      if (accountOpen) { setAccountOpen(false); accountMenuRef.current?.querySelector('button')?.focus() }
      if (workspaceMenuRef.current?.open) { workspaceMenuRef.current.open = false; workspaceMenuRef.current.querySelector('summary')?.focus() }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [accountOpen])
  const [theme, setTheme] = useState(() => localStorage.getItem('aistrix_theme') || 'dark')
  const [phaseByAppId, setPhaseByAppId] = useState({})  // explicit phase overrides per app
  const [moveBack, setMoveBack] = useState(null)        // { app, phase } while asking why a deployed app goes back
  const toast = useToast()

  useEffect(() => {
    if (!createdApp) return
    setApps(prev => prev.some(a => a.id === createdApp.id) ? prev : [createdApp, ...prev])
    // "Save for Test" in Build with AI puts the new app straight into Test.
    const phase = normalizeDevPhase(createdApp.dev_phase) || 'design'
    setPhaseByAppId(prev => ({ ...prev, [createdApp.id]: phase }))
    setActiveAppIdState(createdApp.id)
    setTabState(phase)
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
    setLoadError('')
    try {
    const { data: rows, error: appsError } = await scopeToWorkspace(supabase.from('apps').select(APP_PUBLIC_SELECT), user, 'created_by')
      .order('total_runs', { ascending: false })
    if (appsError) { setLoadError(appsError.message); setLoading(false); return }
    if (!rows?.length) { setApps([]); setRuns([]); setLoading(false); return }
    // Prompts and other private fields come separately, for apps this user can edit.
    const myApps = await withPrivateFields(supabase, rows)
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

    const [{ data: runData, error: runError }, { data: entData }] = await Promise.all([
      supabase.from('run_history')
        .select('id, app_id, app_name, created_at, rating_value, user_id, input_tokens, output_tokens, input, output, feedback_text')
        .in('app_id', myApps.map(a => a.id)).order('created_at', { ascending: false }).limit(500),
      supabase.from('app_entitlements')
        .select('id, app_id, user_id, plan, status, runs_this_period, run_quota, current_period_end, created_at')
        .in('app_id', myApps.map(a => a.id)),
    ])
    setFeedbackError(runError ? `Run history could not be loaded: ${runError.message}` : '')
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
      const rated = appRuns.filter(r => (r.rating_value === 1 || r.rating_value === -1))
      statsMap[app.id] = { uniqueUsers: new Set(appRuns.map(r => r.user_id)).size, thumbsUp: rated.filter(r => r.rating_value === 1).length, rated: rated.length, daily }
    })
    setAppStats(statsMap)

    const allRated = allRuns.filter(r => (r.rating_value === 1 || r.rating_value === -1))
    setTotalStats({
      runs: allRuns.length,
      users: new Set(allRuns.map(r => r.user_id)).size,
      satisfaction: allRated.length > 0 ? Math.round((allRated.filter(r => r.rating_value === 1).length / allRated.length) * 100) : null,
    })
    } catch (error) {
      setLoadError(error.message || 'Please try again.')
    } finally { setLoading(false) }
  }


  function updateAppInState(updated) {
    setApps(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))
  }

  async function moveAppPhase(appId, newPhase, { confirmed = false, tracked = false } = {}) {
    const guard = navigationGuardRef.current
    if (guard && !guard(() => moveAppPhase(appId, newPhase, { confirmed, tracked }))) return
    const phase = normalizeDevPhase(newPhase) || 'design'
    const app = apps.find(a => a.id === appId)
    // Leaving Deploy: warn about the live version and ask why (MoveBackModal).
    if (!confirmed && phase !== 'deploy' && app && getDevPhase(app, phaseByAppId) === 'deploy') {
      setMoveBack({ app, phase })
      return
    }
    // A live app stays live while it's changed: end users keep running the
    // published version until a new one passes its tests and is published.

    try {
      await persistBlueprintPhase(supabase, appId, row => {
        const blueprint = migrateBlueprint({ ...EMPTY_BP, ...(row?.blueprint || {}), dev_phase: phase })
        return { app_id: appId, user_id: user.id, blueprint, readiness_score: app ? calcReadiness(app, blueprint) : 0, updated_at: new Date().toISOString() }
      })
      setPhaseByAppId(prev => ({ ...prev, [appId]: phase }))
      if (!tracked) track(EVENTS.BUILD_PHASE_MOVED, { app_id: appId, from: app ? getDevPhase(app, phaseByAppId) : null, to: phase })

      setActiveAppIdState(appId)
      setTabState(phase)
    } catch (error) {
      toast(`Could not move app: ${error.message || 'Please try again.'}`, 'error')
    }
  }

  async function confirmMoveBack(note) {
    const { app, phase } = moveBack
    const { error } = await saveAppFields(supabase, app, { change_note: note })
    if (error) { if (error.current) updateAppInState({ ...app, ...error.current }); toast(error.message, 'error', 7000); return }
    updateAppInState({ ...app, change_note: note })
    setMoveBack(null)
    track(EVENTS.BUILD_PHASE_MOVED, { app_id: app.id, from: 'deploy', to: phase, reason: note.reason, live: !!app.is_published })
    await moveAppPhase(app.id, phase, { confirmed: true, tracked: true })
  }

  function returnToDesignForPublishFix(appId, reason) {
    setDeployFixReason(reason || 'the app contract')
    moveAppPhase(appId, 'design')
  }

  function navigateOperations(target, appId) {
    const app = apps.find(a => a.id === appId)
    if (!app) return
    guarded(() => {
      if (['design', 'test', 'deploy'].includes(target) && getDevPhase(app, phaseByAppId) !== target) {
        moveAppPhase(appId, target)
      } else {
        setActiveAppIdState(appId)
        setTabState(target)
      }
    })
  }

  async function startOperationalFix(appId, run, testCase) {
    const app = apps.find(a => a.id === appId)
    if (!app) return
    const note = { reason: 'User feedback', note: `Investigate ${run ? `run ${run.id}` : 'app feedback'}.${testCase ? ` Regression: ${testCase.id}.` : ''} ${run?.feedback_text || 'Improve the answer, then validate in Test before publishing.'}`.slice(0, 500) }
    if (getDevPhase(app, phaseByAppId) === 'deploy') {
      setMoveBack({ app, phase: 'design', initialNote: note })
      return
    }
    const { error } = await saveAppFields(supabase, app, { change_note: note })
    if (error) { toast(`Could not start draft fix: ${error.message}`, 'error'); return }
    updateAppInState({ ...app, change_note: note })
    await moveAppPhase(appId, 'design', { confirmed: true })
  }

  // Same confirmation as the sidebar: signing out drops unsaved editor changes.
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  async function signOut() {
    setAccountOpen(false)
    await signOutOnPurpose(supabase)
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.add('theme-transitioning')
    setTheme(next)
    localStorage.setItem('aistrix_theme', next)
    applyTheme(next)
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350)
  }

  const searchNeedle = (search || '').trim().toLowerCase()
  const appMatchesSearch = (app) => {
    if (!app) return false
    if (!searchNeedle) return true
    return [
      app.name,
      app.description,
      app.type,
      app.app_type,
      app.domain,
      app.category,
      app.status,
      ...(Array.isArray(app.tags) ? app.tags : []),
      app.system_prompt,
      getDevPhase(app, phaseByAppId),
    ].filter(Boolean).join(' ').toLowerCase().includes(searchNeedle)
  }
  const visibleApps = searchNeedle ? apps.filter(appMatchesSearch) : apps

  // Results under the search box: apps, runs, pages and the guide.
  const [searchOpen, setSearchOpen] = useState(false)
  const searchResults = !searchNeedle ? [] : [
    ...visibleApps.slice(0, 5).map(app => {
      const phase = getDevPhase(app, phaseByAppId)
      const byPrompt = !`${app.name} ${app.description || ''}`.toLowerCase().includes(searchNeedle) && (app.system_prompt || '').toLowerCase().includes(searchNeedle)
      return { id: `app:${app.id}`, kind: 'App', label: app.name, detail: byPrompt ? 'Prompt matches' : `${phase[0].toUpperCase()}${phase.slice(1)}`,
        open: () => guarded(() => { setSettingsOpen(false); setActiveAppIdState(app.id); setTabState(phase) }) }
    }),
    ...runs.filter(r => [r.input, r.output, r.feedback_text].some(t => typeof t === 'string' && t.toLowerCase().includes(searchNeedle))).slice(0, 5).map(r => ({
      id: `run:${r.id}`, kind: 'Run', label: String(r.feedback_text || r.input || 'Run').slice(0, 80),
      detail: `${r.app_name || 'App'} · ${r.rating_value === -1 ? 'Not useful' : r.rating_value === 1 ? 'Useful' : 'Unrated'} · ${new Date(r.created_at).toLocaleDateString()}`,
      open: () => { setSelectedRunId(r.id); setSettingsOpen(false); navigateOperations('evaluate', r.app_id) },
    })),
    ...[
      ...LIFECYCLE_TABS.map(t => ({ id: `tab:${t.id}`, words: `${t.label} ${t.short || ''} ${t.desc}`, label: t.label, detail: t.desc, open: () => openTab(t.id) })),
      { id: 'settings', words: 'settings profile account appearance theme notifications', label: 'Settings', detail: 'Profile, appearance, notifications', open: () => openSettings('top') },
      { id: 'keys', words: 'keys api key ai provider', label: 'AI keys', detail: 'Settings → API Keys', open: () => openSettings('keys') },
    ].filter(page => page.words.toLowerCase().includes(searchNeedle)).map(page => ({ ...page, kind: 'Page' })),
    ...(['guide', 'help', 'docs', 'documentation', 'how'].some(w => w.startsWith(searchNeedle) || searchNeedle.startsWith(w))
      ? [{ id: 'guide', kind: 'Guide', label: 'Open the guide', detail: 'How each step works', open: () => setShowHelp(true) }] : []),
  ]
  function openSearchResult(result) {
    setSearchOpen(false)
    result.open()
  }
  const activeApp = apps.find(a => a.id === activeAppId) || null
  const activeAppPhase = activeApp ? getDevPhase(activeApp, phaseByAppId) : null
  const activePhaseApps = ['design','test','deploy'].includes(tab)
    ? visibleApps.filter(a => getDevPhase(a, phaseByAppId) === tab)
    : visibleApps
  const phaseScopedActiveAppId = ['design','test','deploy'].includes(tab) && (activeAppPhase !== tab || !appMatchesSearch(activeApp))
    ? null
    : activeAppId

  const pageContent = creationContent || (settingsOpen ? (
    <ErrorBoundary compact title="Settings couldn't load" resetKey="settings">
      <Suspense fallback={TAB_LOADING}><SettingsPage key={String(settingsOpen)} user={user} developer focus={settingsOpen === 'keys' ? 'keys' : null} /></Suspense>
    </ErrorBoundary>
  ) : null)

  if (isPhone) return <MobileDeveloper user={user} apps={apps} runs={runs} phaseByAppId={phaseByAppId} loading={loading}
    error={loadError || feedbackError} onRefresh={load} onAppUpdated={updateAppInState}
    onShowHistory={onShowHistory}
    onSignOut={signOut} onToggleTheme={toggleTheme} />

  return (
    <div className="developer-content flex-1 min-w-0 flex flex-col overflow-hidden">
      {moveBack && <MoveBackModal app={moveBack.app} phase={moveBack.phase} initialNote={moveBack.initialNote} onCancel={() => setMoveBack(null)} onConfirm={confirmMoveBack} />}
      {confirmSignOut && (
        <ConfirmDialog title="Sign out of Aistrix?" subtitle={user?.email}
          confirmLabel="Sign out" busyLabel="Signing out…" danger
          onCancel={() => setConfirmSignOut(false)} onConfirm={signOut}>
          Any unsaved changes in open editors (Design, Prompt Studio, tests) will be lost. Runs and saved work are kept.
        </ConfirmDialog>
      )}

      {/* ── Sticky top bar: tab ribbon + guide + tab note folder tab ── */}
      <div className="sticky top-0 z-30 pointer-events-none">
            <DeveloperRowSection side="header">
            <div className="pointer-events-auto hidden md:flex h-[71px] items-center justify-end gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative hidden lg:block w-56 xl:w-72"
                  onFocus={() => setSearchOpen(true)}
                  onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false) }}>
                <div className="flex items-center gap-2 bg-[#0E1424] border border-white/10 rounded-lg px-3 h-9 text-sm text-slate-300 focus-within:border-[#6C5CE7]/60 transition-colors">
                  <Search size={16} strokeWidth={1.75} className="shrink-0 text-slate-500" aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={e => { onSearch?.(e.target.value); setSearchOpen(true) }}
                    onKeyDown={e => {
                      if (e.key === 'Escape' && search) { e.preventDefault(); e.stopPropagation(); onSearch?.(''); return }
                      if (e.key === 'Enter' && searchResults[0]) { e.preventDefault(); openSearchResult(searchResults[0]) }
                      if (e.key === 'ArrowDown' && searchResults[0]) { e.preventDefault(); e.currentTarget.closest('.relative')?.querySelector('[data-search-result]')?.focus() }
                    }}
                    placeholder="Search apps, prompts, runs…"
                    aria-label="Search apps, prompts, runs and pages"
                    aria-controls="developer-search-results"
                    aria-expanded={searchOpen && !!searchNeedle}
                    ref={searchRef}
                    className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
                  />
                  {search && (
                    <button onClick={() => onSearch?.('')} aria-label="Clear search" className="text-slate-500 hover:text-white transition-colors shrink-0">
                      <X size={14} />
                    </button>
                  )}
                </div>
                {searchOpen && searchNeedle && (
                  <div id="developer-search-results" role="listbox" aria-label="Search results"
                    onKeyDown={e => {
                      const items = [...e.currentTarget.querySelectorAll('[data-search-result]')]
                      const at = items.indexOf(document.activeElement)
                      if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(at + 1, items.length - 1)]?.focus() }
                      if (e.key === 'ArrowUp') { e.preventDefault(); if (at <= 0) searchRef?.current?.focus(); else items[at - 1]?.focus() }
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSearchOpen(false); searchRef?.current?.focus() }
                    }}
                    className="absolute left-0 right-0 top-full mt-1 z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-white/10 bg-[#111827] shadow-2xl py-1">
                    {searchResults.length ? searchResults.map(result => (
                      <button key={result.id} data-search-result role="option" aria-selected="false" onClick={() => openSearchResult(result)}
                        className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-white/5 focus:bg-white/5 focus:outline-none">
                        <span className="mt-0.5 w-11 shrink-0 text-[10px] uppercase tracking-wider text-slate-500">{result.kind}</span>
                        <span className="min-w-0">
                          <span className="block text-sm text-white truncate">{result.label}</span>
                          <span className="block text-[11px] text-slate-400 truncate">{result.detail}</span>
                        </span>
                      </button>
                    )) : <p role="status" className="px-3 py-2 text-xs text-slate-400">No apps, runs or pages match “{search.trim()}”.</p>}
                  </div>
                )}
                </div>
                <div className="flex items-center gap-1">
                  <NotificationsPanel user={user} onNavChange={onNavChange} />
                  <button onClick={onShowHistory}
                    title="Run history"
                    className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm text-slate-200 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap">
                    <Play size={16} strokeWidth={1.75} aria-hidden="true" /> Runs
                  </button>
                  <button
                    onClick={() => openSettings('keys')}
                    aria-label={noKeys ? 'Keys — no AI key added yet' : undefined}
                    title={noKeys ? 'No AI key added — add one to build apps' : undefined}
                    className="relative inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm text-slate-200 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap"
                  >
                    <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" /> Keys
                    {noKeys && <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-amber-500 text-[#0F1225] text-[10px] font-bold flex items-center justify-center" aria-hidden="true">!</span>}
                  </button>
                  <button
                    onClick={() => setShowHelp(true)}
                    title="Guide"
                    aria-label="Guide"
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors shrink-0"
                  >
                    <CircleHelp size={17} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
                <button onClick={onOpenCreate} aria-label="+ App"
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white text-sm font-semibold transition-colors whitespace-nowrap">
                  <Plus size={16} strokeWidth={2} aria-hidden="true" /> App
                </button>
                <div ref={accountMenuRef} className="relative shrink-0">
                  <button
                    onClick={() => setAccountOpen(v => !v)}
                    aria-label="Account menu"
                    aria-haspopup="menu"
                    aria-expanded={accountOpen}
                    className="w-9 h-9 rounded-full bg-[#6C5CE7]/15 text-[#A29BFE] text-sm font-semibold flex items-center justify-center hover:bg-[#6C5CE7]/25 transition-colors"
                    style={{ background: user?.user_metadata?.avatar_color || undefined }}
                  >
                    {(user?.user_metadata?.display_name || user?.email || '?')[0].toUpperCase()}
                  </button>
                  {accountOpen && (
                    <div role="menu" className="absolute right-0 top-full mt-2 w-52 rounded-2xl bg-[#111827] border border-white/10 shadow-2xl overflow-hidden z-50">
                      <div className="px-3 py-3 border-b border-white/5">
                        <p className="text-white text-sm font-semibold truncate">{user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Account'}</p>
                        <p className="text-slate-500 text-[11px] truncate">{user?.email}</p>
                      </div>
                      <button
                        onClick={() => { setAccountOpen(false); openSettings('top') }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                      >
                        <Settings size={15} /> Settings
                      </button>
                      <button
                        onClick={() => { setAccountOpen(false); toggleTheme() }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                      >
                        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                      </button>
                      <button
                        onClick={() => { setAccountOpen(false); setConfirmSignOut(true) }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/10 hover:text-red-200 transition-colors"
                      >
                        <LogOut size={15} /> Sign out
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </DeveloperRowSection>
        <DeveloperRowSection side="content">
            <div className="pointer-events-auto bg-[#1A2038] grid grid-cols-1 md:overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="hidden md:flex min-w-0 pl-0 pr-4 py-3 items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {/* Phones: one group fills the width and the next one peeks in;
                    swipe to the next group (snaps). md+: all three side by side. */}
                <div ref={ribbonRef}
                  className="w-full min-w-[760px] flex md:grid md:grid-cols-[3fr_4fr_3fr] gap-4 h-full overflow-x-auto md:overflow-visible snap-x snap-mandatory md:snap-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {LIFECYCLE_GROUPS.map(group => (
                    <div key={group.id} data-group={group.id}
                      className={`developer-lifecycle-group ${LIFECYCLE_TABS.filter(t => t.group === group.id).length > 3 ? 'w-[94%]' : 'w-[85%]'} shrink-0 snap-start md:w-auto md:shrink min-w-0`}>
                      <p className="px-0.5 pb-1.5 text-[10px] text-slate-400 uppercase font-semibold tracking-wider leading-none truncate">{group.label}</p>
                      <div className="developer-lifecycle-box flex min-w-0 h-[48px] rounded-lg border border-white/10 bg-[#111827] overflow-hidden divide-x divide-white/10">
                        {LIFECYCLE_TABS.filter(t => t.group === group.id).map(t => {
                          const active = tab === t.id
                          return (
                            <button key={t.id} onClick={() => openTab(t.id)}
                              title={`${t.label}: ${t.desc}`}
                              aria-current={active ? 'step' : undefined}
                              className={`flex-1 min-w-0 flex items-center gap-2.5 px-2 min-[1440px]:px-3 text-left transition-colors ${
                                active
                                  ? 'bg-[#6C5CE7]/25 text-white'
                                  : 'text-slate-300 hover:text-white hover:bg-white/5'
                              }`}>
                              {/* Icons only where there's room (1440px+), so labels are never cut off */}
                              <t.Icon size={18} strokeWidth={1.75} aria-hidden="true"
                                className={`hidden min-[1440px]:block shrink-0 ${active ? 'text-[#A29BFE]' : 'text-slate-400'}`} />
                              <span className="min-w-0">
                                <span data-tab-label className="block text-[11px] font-semibold leading-tight whitespace-nowrap truncate">{t.short || t.label}</span>
                                <span className="block text-[10px] leading-tight mt-0.5 whitespace-nowrap truncate text-slate-500">{t.desc || ' '}</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
        </DeveloperRowSection>
        <DeveloperRowSection side="stats">
              <details ref={workspaceMenuRef} className="developer-workspace-summary hidden xl:block relative px-3 pt-[29px]">
                <summary className="cursor-pointer list-none inline-flex items-center justify-between gap-2 w-full h-10 px-3 rounded-lg border border-white/10 bg-[#111827] text-xs font-medium text-slate-200 hover:bg-white/5">
                  Workspace <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="text-slate-400" />
                </summary>
                <div className="absolute right-3 top-full z-40 w-72 rounded-2xl bg-[#111827] border border-white/8 p-2 grid grid-cols-3 gap-2 shadow-lg">
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
              </details>

        </DeveloperRowSection>
      </div>

      {loadError && <div role="alert" className="p-4 text-amber-300 text-sm">Could not load your apps: {loadError} <button onClick={load} className="underline">Retry</button></div>}
      {pageContent && <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6" data-testid={creationContent ? 'developer-creation' : 'developer-settings'}>{pageContent}</div>}
      {/* ── Body: content + right panes ── */}
      {/* First-time welcome screen (scrolls on its own; the top bar above doesn't) */}
      {!pageContent && !loading && !loadError && apps.length === 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pt-4 sm:pt-6">
          <WelcomeScreen onCreateApp={onOpenCreate} />
        </div>
      )}

      {(loading || apps.length > 0 || pageContent) && (
        <div className={pageContent ? 'contents' : 'flex flex-1 min-h-0 overflow-hidden'}>

          {/* Main content */}
          {!pageContent && <div className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-5 lg:px-6 py-4 md:py-6 space-y-5">
            {/* Tab content */}
            {['design','test','deploy'].includes(tab) ? (
              phaseScopedActiveAppId ? (
                <ErrorBoundary compact title={`${DEV_PHASES[tab]?.label || 'Dev Studio'} section could not load`} resetKey={`${tab}:${phaseScopedActiveAppId}`}>
                  <Suspense fallback={TAB_LOADING}>
                  {tab === 'design' && <DesignTab   navigationGuardRef={navigationGuardRef} apps={activePhaseApps} allApps={apps} loading={loading} onOpenCreate={onOpenCreate} user={user} onAppUpdated={updateAppInState} onGoToTest={appId => { moveAppPhase(appId, 'test'); setDeployFixReason('') }} selectedAppId={phaseScopedActiveAppId} onSelectApp={setActiveAppId} deployFixReason={deployFixReason} phaseByAppId={phaseByAppId} />}
                  {tab === 'test'   && <TestTab     apps={activePhaseApps} allApps={apps} user={user} selectedAppId={phaseScopedActiveAppId} phaseByAppId={phaseByAppId} onMovePhase={moveAppPhase} onOpenKeys={onShowSettings} />}
                  {tab === 'deploy' && <DeployTab   apps={activePhaseApps} user={user} onAppUpdated={updateAppInState} onFixInDesign={returnToDesignForPublishFix} onMonitor={appId => navigateOperations('monitor', appId)} selectedAppId={phaseScopedActiveAppId} onSelectApp={setActiveAppId} onMovePhase={moveAppPhase} onOpenKeys={onShowSettings} />}
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
                    <div className="space-y-5 md:space-y-6 max-w-xl mx-auto py-6 md:py-12">
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
                      <div className="space-y-5 md:space-y-6 max-w-lg mx-auto py-6 md:py-12">
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
                    <div className="space-y-5 md:space-y-6 max-w-lg mx-auto py-6 md:py-12">
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
            {['monitor','evaluate','improve','sell'].includes(tab) && <OperationsWorkflow stage={tab} apps={apps} runs={runs} user={user}
              selectedAppId={activeAppId} onSelectApp={setActiveAppId} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId}
              onNavigate={navigateOperations} onFix={startOperationalFix} loading={loading} error={feedbackError} onRefresh={load} />}
            {!['design','test','deploy'].includes(tab) && (
            <ErrorBoundary compact title={`${LIFECYCLE_TABS.find(t => t.id === tab)?.label || "This"} section couldn't load`} resetKey={`${tab}:${activeAppId}`}>
            <Suspense fallback={TAB_LOADING}>
            {tab === 'sell'     && <SellTab     apps={apps} user={user} onAppUpdated={updateAppInState} />}
            {!feedbackError && tab === 'monitor'  && <MonitorTab  apps={apps} appStats={appStats} loading={loading} totalStats={totalStats} runs={runs} entitlements={entitlements} user={user} />}
            {!feedbackError && tab === 'evaluate' && <EvaluateTab apps={apps} appStats={appStats} runs={runs} user={user} selectedAppId={activeAppId || apps[0]?.id} onSelectApp={setActiveAppId} />}
            {tab === 'improve'  && <ImproveTab  apps={apps} user={user} runs={runs} selectedAppId={activeAppId || apps[0]?.id} onSelectApp={setActiveAppId} />}
            {tab === 'version'  && <VersionTab  apps={apps} user={user} onAppUpdated={updateAppInState} selectedAppId={activeAppId} onSelectApp={setActiveAppId} />}
            {tab === 'monetize' && <MonetizeTab apps={apps} runs={runs} loading={loading} user={user} />}
            {tab === 'secrets'  && <SecretsTab  apps={apps} user={user} selectedAppId={activeAppId} onSelectApp={setActiveAppId} />}
            </Suspense>
            </ErrorBoundary>
            )}
          </div>

          }
          {/* ── Left: App navigator ── */}
          <DeveloperAppList>
            <div className="developer-app-list hidden md:block shrink-0 overflow-y-auto w-56">
              {searchNeedle && !visibleApps.length && (
                <div role="status" className="mx-3 mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400">
                  No apps match “{search.trim()}”. <button onClick={() => onSearch?.('')} className="text-[#A29BFE] hover:underline">Clear search</button>
                </div>
              )}
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
                compact
                onOpenApp={(id, phase) => guarded(() => { setActiveAppIdState(id); setTabState(phase) })}
              />
              </ErrorBoundary>
            </div>
          </DeveloperAppList>


        </div>
      )}

      {/* Help panel */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  )
}
