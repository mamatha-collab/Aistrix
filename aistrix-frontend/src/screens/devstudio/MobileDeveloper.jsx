import { ENTITIES } from '../../lib/entities'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Activity, ChevronLeft, MessageSquare, RefreshCw, Settings2 } from 'lucide-react'
import AistrixWordmark from '../../components/AistrixWordmark'
import ConfirmDialog from '../../components/ConfirmDialog'
import ErrorBoundary from '../../components/ErrorBoundary'
import { getMonitorOverview, pct } from '../../lib/monitor'
import { getAppFeedback, statusLabel } from '../../lib/feedback'
import { timeAgo } from '../../utils'

import { BRAND } from '../../lib/brand'
const MonitorPanel = lazy(() => import('./MonitorPanel'))
const MobileManage = lazy(() => import('./MobileManage'))
const SettingsPage = lazy(() => import('../SettingsPage'))
const PublishedVersions = lazy(() => import('../../components/PublishedVersions'))
const card = 'rounded-2xl border border-white/8 bg-[#171B33] p-4'
const action = 'min-h-11 rounded-xl px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5'

function FeedbackCard({ item }) {
  const shared = item.shared_input != null || item.shared_output != null
  return <details className={card}>
    <summary className="cursor-pointer list-none space-y-1">
      <p className="text-sm text-white leading-relaxed break-words"><span aria-label={item.rating === -1 ? 'Not useful' : 'Useful'} className="mr-1.5">{item.rating === -1 ? '👎' : '👍'}</span><span>{item.comment || 'Answer marked not useful'}</span></p>
      <p className="text-xs text-slate-400">{timeAgo(item.created_at)} · {statusLabel(item.status)}{shared ? ' · Tap for details' : ''}</p>
    </summary>
    <div className="mt-4 space-y-3 border-t border-white/8 pt-3">
      {shared ? [['Customer question', item.shared_input], ['Answer they got', item.shared_output]].map(([label, value]) => <div key={label}>
        <p className="text-xs font-semibold text-slate-400 mb-1">{label}</p>
        <p className="text-sm text-slate-200 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{value == null ? 'Not shared' : value === '' ? 'Shared, but empty' : value}</p>
      </div>) : <p className="text-sm text-slate-400">The customer didn't share their question or the answer.</p>}
      <p className="text-xs text-slate-500">Triage and turn it into a regression test in Evaluate on a computer or tablet.</p>
    </div>
  </details>
}

export default function MobileDeveloper({ user, apps, phaseByAppId, loading, error, onRefresh, onAppUpdated, onSignOut, onToggleTheme }) {
  const [view, setView] = useState('monitor')
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [limit, setLimit] = useState(10)
  const [hasLoaded, setHasLoaded] = useState(false)
  useEffect(() => { if (!loading) setHasLoaded(true) }, [loading])
  useEffect(() => {
    if (!accountOpen) return
    const close = event => { if (event.key === 'Escape') setAccountOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [accountOpen])
  const selected = apps.find(a => a.id === selectedId)
  const live = apps.filter(a => a.is_published)
  const filteredApps = apps.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))

  // Health of the last 7 days from the server: real runs, alerts, open feedback.
  const [overview, setOverview] = useState({ loading: true, error: '', apps: [] })
  const [overviewKey, setOverviewKey] = useState(0)
  const appIds = apps.map(a => a.id).join(',')
  useEffect(() => {
    if (view === 'monitor') return undefined
    if (!appIds) { setOverview({ loading: false, error: '', apps: [] }); return undefined }
    let active = true
    setOverview(o => ({ ...o, loading: true, error: '' }))
    getMonitorOverview(appIds.split(','), 7)
      .then(data => { if (active) setOverview({ loading: false, error: '', apps: data.apps || [] }) })
      .catch(e => { if (active) setOverview({ loading: false, error: e.message || 'App health could not be loaded.', apps: [] }) })
    return () => { active = false }
  }, [appIds, overviewKey, view])
  const health = id => overview.apps.find(a => a.app_id === id)
  const needsLook = id => { const h = health(id); return !!h && (h.open_feedback > 0 || h.alerts.some(al => al.level !== 'info')) }
  function refreshAll() { onRefresh?.(); setOverviewKey(n => n + 1); setFeedbackKey(n => n + 1) }

  // Feedback view: one app's open customer feedback.
  const feedbackApp = filter || overview.apps.find(a => a.open_feedback > 0)?.app_id || live[0]?.id || apps[0]?.id || ''
  const [inbox, setInbox] = useState({ loading: false, error: '', items: [] })
  const [feedbackKey, setFeedbackKey] = useState(0)
  useEffect(() => {
    if (view !== 'feedback' || !feedbackApp) return undefined
    let active = true
    setInbox({ loading: true, error: '', items: [] })
    getAppFeedback(feedbackApp, 'open')
      .then(data => { if (active) setInbox({ loading: false, error: '', items: data.items || [], nextOffset: data.next_offset }) })
      .catch(e => { if (active) setInbox({ loading: false, error: e.message || 'Feedback could not be loaded.', items: [] }) })
    return () => { active = false }
  }, [view, feedbackApp, feedbackKey])

  function openApp(id) { setSelectedId(id); setShowVersions(false); setView('apps') }
  function navigate(next) { setView(next); setSelectedId(null); setShowVersions(false); setLimit(10) }

  const appRow = app => <button key={app.id} onClick={() => openApp(app.id)} className={`${card} w-full text-left flex items-center gap-3 min-h-20`}>
    <span className="text-2xl shrink-0" aria-hidden="true">{app.emoji || '✦'}</span>
    <span className="min-w-0 flex-1"><span className="block font-semibold text-white text-sm truncate">{app.name}</span>
      <span className="block text-xs text-slate-400 mt-1">{app.is_published ? `Live${app.live_version ? ` · v${app.live_version}` : ''}` : 'Draft · In Build'}</span>
    </span>
    {needsLook(app.id) && <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" aria-label="Needs attention" />}
  </button>

  return <div className="developer-content flex-1 min-w-0 min-h-0 flex flex-col bg-[#09101F]" data-testid="mobile-developer">
    <header className="shrink-0 h-16 px-4 flex items-center justify-between gap-3 border-b border-white/8 bg-[#111827]">
      <div className="flex items-center gap-1.5 min-w-0"><img src="/aistrix-logo.svg" alt="" className="h-7 w-7" /><span className="font-bold text-white text-lg"><AistrixWordmark /></span></div>
      <div className="relative">
        <button className="h-11 w-11 rounded-xl bg-white/5 border border-white/8 text-white font-semibold text-sm" aria-label="Account menu" aria-expanded={accountOpen} aria-haspopup="menu" onClick={() => setAccountOpen(v => !v)}>
          {(user.user_metadata?.display_name || user.email || '?')[0].toUpperCase()}
        </button>
        {accountOpen && <>
          <button aria-label="Close account menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setAccountOpen(false)} />
          <div role="menu" className="absolute top-full right-0 mt-2 z-50 w-60 rounded-2xl border border-white/10 bg-[#111827] shadow-2xl p-2">
            <p className="truncate text-xs text-slate-400 px-3 py-3 border-b border-white/8 mb-1">{user.email}</p>
            {[['Settings', () => navigate('settings')], ['Change theme', onToggleTheme]].map(([label, handler]) => <button key={label} className={`${action} w-full text-left`} onClick={() => { setAccountOpen(false); handler?.() }}>{label}</button>)}
            <button className={`${action} !text-red-300 w-full text-left border-t border-white/8 mt-1`} onClick={() => { setAccountOpen(false); setConfirmSignOut(true) }}>Sign out</button>
          </div>
        </>}
      </div>
    </header>

    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 space-y-5" key={`${view}:${selectedId || ''}`}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl text-white font-semibold">{selected && view === 'apps' ? 'App details' : view === 'monitor' ? 'Monitor' : view === 'apps' ? 'Apps' : view === 'manage' ? 'Manage' : view === 'settings' ? 'Settings' : 'Feedback'}</h1>
        {view !== 'manage' && <button className={`${action} !p-2.5 border border-white/8`} aria-label="Refresh app activity" disabled={loading || (view !== 'monitor' && overview.loading)} onClick={refreshAll}><RefreshCw size={18} className={loading || (view !== 'monitor' && overview.loading) ? 'animate-spin' : ''} /></button>}
      </div>
      {error && view !== 'manage' && <div role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">{error}<button className="block underline min-h-11" onClick={refreshAll}>Try again</button></div>}
      {view === 'settings' ? <ErrorBoundary compact title="Settings could not load"><Suspense fallback={<p role="status" className="text-sm text-slate-400">Loading Settings…</p>}><SettingsPage user={user} developer embedded /></Suspense></ErrorBoundary> : view === 'manage' ? <ErrorBoundary compact title="Manage could not load"><Suspense fallback={<p role="status" className="text-sm text-slate-400">Loading Manage…</p>}><MobileManage apps={apps} user={user} onAppUpdated={onAppUpdated} /></Suspense></ErrorBoundary> : loading && !hasLoaded ? <div role="status" className="space-y-3"><p className="text-sm text-slate-400">Loading app activity…</p>{[0, 1, 2].map(i => <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />)}</div> : !apps.length && !error ? <div className={`${card} space-y-2`}><h2 className="text-white font-semibold">No apps yet</h2><p className="text-sm text-slate-400 leading-relaxed">Create your first app on a computer or tablet. Check its activity and feedback here.</p></div> : <>
        {view === 'monitor' && <ErrorBoundary compact title="Monitor could not load"><Suspense fallback={<p role="status" className="text-sm text-slate-400">Loading Monitor…</p>}>
          <MonitorPanel apps={apps} compact refreshKey={overviewKey} onNavigate={(stage, id) => {
            if (stage === 'evaluate') { setFilter(id); navigate('feedback') }
            else { openApp(id); setShowVersions(true) }
          }} />
        </Suspense></ErrorBoundary>}
        {view === 'apps' && !selected && <>
          {apps.length > 5 && <input aria-label="Find an app" placeholder="Find an app" className="w-full min-h-11 rounded-xl bg-[#0E1424] border border-white/10 px-3 text-sm text-white" value={search} onChange={e => setSearch(e.target.value)} />}
          {[['Live apps', true], ['In Build', false]].map(([label, published]) => {
            const group = filteredApps.filter(a => !!a.is_published === published)
            return group.length ? <section key={label} className="space-y-3"><h2 className="text-sm text-slate-400 font-semibold">{label} · {group.length}</h2>{group.map(appRow)}</section> : null
          })}
          {!filteredApps.length && <p className="text-sm text-slate-400">No apps match your search.</p>}
        </>}
        {view === 'apps' && selected && <>
          <button className={`${action} flex items-center gap-1 !px-0`} onClick={() => setSelectedId(null)}><ChevronLeft size={18} />All apps</button>
          <div className={`${card} space-y-3`}><h2 className="text-lg text-white font-semibold break-words">{selected.name}</h2><p className="text-sm text-slate-400">{selected.is_published ? `Live${selected.live_version ? ` · v${selected.live_version}` : ''}` : 'Not published'}</p>
            {selected.description && <p className="text-sm text-slate-300 leading-relaxed break-words">{selected.description}</p>}
            {selected.is_published && <a href={`/app/${selected.id}`} target="_blank" rel="noreferrer" className={`${action} inline-flex items-center bg-[#6C5CE7] !text-white`}>Open live app ↗</a>}
          </div>
          {health(selected.id) && <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-400">
            <span>{health(selected.id).totals.runs} runs this week</span>
            <span>{health(selected.id).totals.rated ? `${pct(health(selected.id).totals.satisfaction)} useful · ${health(selected.id).totals.rated} rated` : 'No ratings yet'}</span>
            {health(selected.id).totals.errors > 0 && <span className="text-amber-300">{pct(health(selected.id).totals.error_rate)} failed</span>}
          </div>}
          {(health(selected.id)?.alerts || []).filter(al => al.level !== 'info').map(al => <p key={al.kind} className={`text-sm ${al.level === 'critical' ? 'text-red-200' : 'text-amber-200'}`}>{al.message}</p>)}
          <button className={`${action} w-full text-left border border-white/8`} onClick={() => { setFilter(selected.id); navigate('feedback') }}>Feedback to review · {health(selected.id)?.open_feedback ?? '—'} →</button>
          {(selected.is_published || selected.live_version) && <section className="space-y-3 [&_button]:min-h-11"><button className={`${action} w-full text-left border border-white/8`} aria-expanded={showVersions} onClick={() => setShowVersions(v => !v)}>{showVersions ? 'Hide release history' : 'Release history'}</button>
            {showVersions && <ErrorBoundary compact title="Release history could not load"><Suspense fallback={<p className="text-sm text-slate-400">Loading releases…</p>}><PublishedVersions app={selected} onAppUpdated={onAppUpdated} /></Suspense></ErrorBoundary>}
          </section>}
          <details className={`${card} text-sm text-slate-400`}><summary className="cursor-pointer">Build status</summary><p className="mt-3 leading-relaxed">{({ design: 'Design', test: 'Test', deploy: 'Publish' })[phaseByAppId[selected.id]] || 'Design'} stage. Continue building on a computer or tablet.</p></details>
        </>}
        {view === 'feedback' && <>
          {inbox.nextOffset != null && <p className="text-xs text-slate-400">Showing the latest 200 reports. Review the full feedback queue in Eval on a computer or tablet.</p>}
          <select aria-label="Filter feedback by app" value={feedbackApp} onChange={e => { setFilter(e.target.value); setLimit(10) }} className="w-full min-h-11 rounded-xl bg-[#0E1424] border border-white/10 px-3 text-sm text-white">{apps.map(a => <option key={a.id} value={a.id}>{a.name}{health(a.id)?.open_feedback ? ` · ${health(a.id).open_feedback} open` : ''}</option>)}</select>
          {inbox.error ? <div role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">{inbox.error}<button className="block underline min-h-11" onClick={() => setFeedbackKey(n => n + 1)}>Try again</button></div>
            : inbox.loading ? <p role="status" className="text-sm text-slate-400">Loading feedback…</p>
            : inbox.items.length ? <div className="space-y-3">{inbox.items.slice(0, limit).map(i => <FeedbackCard key={i.id} item={i} />)}{inbox.items.length > limit && <button className={`${action} w-full border border-white/8`} onClick={() => setLimit(n => n + 10)}>Show more feedback</button>}</div>
            : <p className="text-sm text-slate-400">No open feedback for this app. When customers mark an answer "not useful", it appears here.</p>}
        </>}
      </>}
    </div>
    <nav aria-label="Developer mobile navigation" className="shrink-0 flex border-t border-white/8 bg-[#111827] pb-[env(safe-area-inset-bottom)]">
      {[[Activity, 'monitor', 'Monitor'], [ENTITIES.apps.Icon, 'apps', ENTITIES.apps.label], [MessageSquare, 'feedback', 'Feedback'], [Settings2, 'manage', 'Manage']].map(([Icon, id, label]) => <button key={id} onClick={() => { if (id === 'feedback') setFilter(''); navigate(id) }} aria-current={view === id ? 'page' : undefined} className={`flex-1 min-h-16 flex flex-col items-center justify-center gap-1 text-xs ${view === id ? 'text-[#A29BFE]' : 'text-slate-400'}`}><Icon size={20} /><span>{label}</span></button>)}
    </nav>
    {confirmSignOut && <ConfirmDialog title={`Sign out of ${BRAND}?`} subtitle={user.email} confirmLabel="Sign out" busyLabel="Signing out…" danger onCancel={() => setConfirmSignOut(false)} onConfirm={async () => { await onSignOut(); setConfirmSignOut(false) }}>You can sign in again to check your apps.</ConfirmDialog>}
  </div>
}
