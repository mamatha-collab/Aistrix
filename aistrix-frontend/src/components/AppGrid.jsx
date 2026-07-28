import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../supabase'
import AppCard, { AppTab } from './AppCard'
import { useToast } from '../hooks/useToast'

// Lazy-loaded — both are modals only rendered behind a toggle, and AppGrid is
// statically imported from App.jsx, so anything imported statically here
// otherwise ends up in the main bundle even though it's never needed on
// initial paint.
const CreateAppModal = lazy(() => import('./CreateAppModal'))

const SOLUTION_PACKS = [
  { id: 'job_search', emoji: '💼', color: '#6C5CE7', name: 'Job Search',      desc: 'Resume, cover letters, interview prep, and salary negotiation.',  tags: ['resume','career','interview','linkedin','cover letter','job','salary'] },
  { id: 'marketing',  emoji: '📈', color: '#E84393', name: 'Marketing',       desc: 'Content, campaigns, SEO, social media, and analytics tools.',     tags: ['marketing','seo','content','social','campaign','email','copywriting'] },
  { id: 'content',    emoji: '✍️', color: '#00B894', name: 'Content Creator', desc: 'Blog posts, scripts, captions, newsletters, and more.',           tags: ['writing','content','blog','script','newsletter','caption','copywriting'] },
  { id: 'small_biz',  emoji: '🏢', color: '#FDCB6E', name: 'Small Business',  desc: 'Proposals, invoices, customer support, HR, and operations.',      tags: ['business','proposal','invoice','hr','finance','legal','customer'] },
]

const APP_GOALS = [
  { id: 'write',   label: 'Write faster',      cue: 'AI', domain: 'content',   query: 'writer',    pack: 'Content Creator', outcome: 'Draft posts, captions, scripts, and summaries faster.' },
  { id: 'hire',    label: 'Hire better',       cue: 'AI', domain: 'career',    query: 'resume',    pack: 'Job Search',       outcome: 'Screen resumes, improve profiles, and prepare interviews.' },
  { id: 'sales',   label: 'Close more deals',  cue: 'AI', domain: 'business',  query: 'proposal',  pack: 'Small Business',   outcome: 'Create proposals, summaries, and outreach that move deals forward.' },
  { id: 'support', label: 'Support customers', cue: 'AI', domain: 'business',  query: 'support',   pack: 'Small Business',   outcome: 'Draft helpful replies and turn recurring questions into reusable apps.' },
  { id: 'finance', label: 'Manage finances',   cue: 'AI', domain: 'business',  query: 'invoice',   pack: 'Small Business',   outcome: 'Generate invoices, summarize costs, and explain business numbers.' },
  { id: 'brand',   label: 'Grow my brand',     cue: 'AI', domain: 'marketing', query: 'marketing', pack: 'Marketing',        outcome: 'Create campaigns, SEO copy, social posts, and email assets.' },
]

function AistrixAppSuggestions({ goal, suggestedApps, onUseRecommendation, onBuildApp, onBuildWorkflow }) {
  if (!goal) return null
  return (
    <div className="mb-5 rounded-xl border border-[#6C5CE7]/25 bg-[#6C5CE7]/10 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold">Aistrix suggests: start with the {goal.pack} pack</p>
          <p className="text-slate-400 text-xs mt-1">{goal.outcome}</p>
          {suggestedApps.length > 0 && (
            <p className="text-[11px] text-slate-500 mt-2">
              Recommended apps: {suggestedApps.slice(0, 3).map(a => a.name).join(', ')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button onClick={onUseRecommendation}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7] text-white hover:bg-[#7C6CFF] transition-colors">
            Show recommended apps
          </button>
          <button onClick={onBuildWorkflow}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors">
            Build AI Workflow
          </button>
          <button onClick={onBuildApp}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors">
            Build AI App
          </button>
        </div>
      </div>
    </div>
  )
}

function matchPackApps(apps, pack) {
  return apps.filter(app => (app.tags || []).some(t => pack.tags.some(pt => t.toLowerCase().includes(pt) || pt.includes(t.toLowerCase()))))
}

function SolutionPacksSection({ user, apps, onFavoritesChanged }) {
  const [installed, setInstalled] = useState(new Set())
  const [installing, setInstalling] = useState(null)
  const toast = useToast()

  useEffect(() => {
    if (!user) return
    supabase.from('favorites').select('app_id').eq('user_id', user.id).then(({ data: favs }) => {
      const favIds = new Set((favs || []).map(f => String(f.app_id)))
      const already = new Set(SOLUTION_PACKS.filter(pack => {
        const matching = matchPackApps(apps, pack)
        return matching.length > 0 && matching.every(a => favIds.has(String(a.id)))
      }).map(p => p.id))
      setInstalled(already)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when user or the apps list changes
  }, [user?.id, apps])

  async function installPack(pack) {
    if (!user) return
    setInstalling(pack.id)
    const matching = matchPackApps(apps, pack)
    if (!matching.length) { toast('No matching apps found for this pack yet', 'info'); setInstalling(null); return }
    const rows = matching.map(a => ({ user_id: user.id, app_id: a.id }))
    const { error } = await supabase.from('favorites').upsert(rows, { onConflict: 'user_id,app_id', ignoreDuplicates: true })
    if (error) { toast(error.message, 'error'); setInstalling(null); return }
    setInstalled(prev => new Set([...prev, pack.id]))
    onFavoritesChanged?.()
    toast(`✓ ${pack.name} installed — ${matching.length} apps added to Favorites`, 'success', 4000)
    setInstalling(null)
  }

  return (
    <div className="mb-8">
      <p className="text-xs text-slate-300 uppercase font-semibold tracking-wide mb-3">Quick start — install a solution pack</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {SOLUTION_PACKS.map(pack => {
          const isDone = installed.has(pack.id)
          const isInstalling = installing === pack.id
          return (
            <div key={pack.id} className={`flex flex-col p-3 rounded-xl border transition-all ${isDone ? 'border-green-500/40 bg-green-500/8' : 'border-white/20 bg-[#121829] hover:border-white/35 hover:bg-[#17203A] hover:shadow-md hover:shadow-black/30'}`}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                  style={{ background: isDone ? '#10b98122' : pack.color + '22' }}>
                  {isInstalling ? <span className="animate-spin text-sm">⟳</span> : isDone ? '✓' : pack.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold leading-snug truncate">{pack.name}</p>
                  <p className="text-[10px] text-slate-500">{matchPackApps(apps, pack).length} apps</p>
                </div>
              </div>
              <p className="text-slate-400 text-[11px] leading-relaxed flex-1 line-clamp-2">{pack.desc}</p>
              <button
                onClick={() => !isDone && !installing && installPack(pack)}
                disabled={!!installing || isDone}
                className={`mt-2.5 w-full text-[11px] font-medium py-1.5 rounded-lg transition-all disabled:opacity-50 ${isDone ? 'cursor-default bg-green-500/10 text-green-400' : 'cursor-pointer bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25'}`}>
                {isDone ? '✓ Installed' : isInstalling ? 'Installing…' : '+ Install'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DomainTemplateCard({ domain, domainApps, selectedApp, user, onSelectApp, onNavChange }) {
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState(false)
  const toast = useToast()

  async function useTemplate() {
    if (!user) return
    setInstalling(true)
    const { data: existing } = await supabase.from('flows')
      .select('id').eq('user_id', user.id).ilike('name', `%${domain.name}%`).maybeSingle()
    if (existing) {
      setInstalled(true); setInstalling(false)
      onNavChange?.('flows'); return
    }
    const { error } = await supabase.from('flows').insert({
      user_id: user.id,
      name: `${domain.name} Workflow`,
      emoji: domain.emoji,
      description: domain.description || `A complete ${domain.name.toLowerCase()} workflow`,
      steps: domainApps.map(a => ({ app_id: a.id, app_name: a.name, app_emoji: a.emoji })),
    })
    setInstalling(false)
    if (error) { toast(`Couldn't install this workflow: ${error.message}`, 'error'); return }
    setInstalled(true)
    onNavChange?.('flows')
  }

  return (
    <div className="mb-8 bg-[#121829] border border-white/22 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 p-5 border-b border-white/10">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
          style={{ background: domain.color + '20' }}>
          {domain.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-white font-semibold text-base">{domain.name} Workflow Template</h2>
            <span className="text-[9px] bg-[#6C5CE7]/15 text-[#A29BFE] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">Template</span>
          </div>
          <p className="text-xs text-slate-300">{domain.description || `${domainApps.length} apps chained together — install to your Workflows and start running.`}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => onNavChange?.('flows')}
            className="text-xs px-3 py-1.5 bg-[#1A2038] hover:bg-[#212840] border border-white/20 text-slate-200 hover:text-white rounded-xl transition-colors">
            ✏️ Edit
          </button>
          <button onClick={useTemplate} disabled={installing || installed}
            className="text-xs px-4 py-1.5 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-50 text-white rounded-xl font-medium transition-colors whitespace-nowrap">
            {installing ? 'Installing...' : installed ? '✓ Installed' : '+ Use template'}
          </button>
        </div>
      </div>

      {/* Pipeline */}
      <div className="px-5 py-4 flex items-center gap-2 overflow-x-auto">
        <span className="text-[10px] text-slate-400 uppercase font-medium shrink-0 mr-1">Suggested flow</span>
        {domainApps.map((app, i) => (
          <div key={app.id} className="flex items-center gap-2 shrink-0">
            <div onClick={e => { e.stopPropagation(); onSelectApp(app) }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border cursor-pointer transition-all
                ${selectedApp?.id === app.id
                  ? 'border-[#6C5CE7] bg-[#6C5CE7]/10 text-white'
                  : 'border-white/22 bg-[#1A2038] hover:border-white/35 text-slate-200 hover:text-white'}`}>
              <span className="text-sm">{app.emoji}</span>
              <span className="text-xs font-medium whitespace-nowrap">{app.name}</span>
            </div>
            {i < domainApps.length - 1 && <span className="text-slate-500">→</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AppGrid({ onSelectApp, selectedApp, user, search, runCounts = {}, showCreate, onCloseCreate, onOpenCreate, onBackToTypeSelector, onNavChange, deletedAppId, initialAppType = 'prompt', websitePrefilledApp, createdApp, onCreatedAppConsumed, onAppCreated }) {
  const [domains, setDomains] = useState([])
  const [apps, setApps] = useState([])
  const [myApps, setMyApps] = useState([])
  const [sharedApps, setSharedApps] = useState([])
  const [sharedRoles, setSharedRoles] = useState({})
  const [loadingShared, setLoadingShared] = useState(false)
  const [mainTab, setMainTab] = useState('discover') // 'discover' | 'mine' | 'shared'
  const [favorites, setFavorites] = useState(new Set())
  const [activeDomain, setActiveDomain] = useState('all')
  const [selectedGoal, setSelectedGoal] = useState(null)
  // Default to the detailed card view — it's the one with the Preview / Try
  // sample / Run app actions; compact tabs are opt-in via the toggle above.
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('aistrix:appViewMode') || 'grid')
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  useEffect(() => {
    localStorage.setItem('aistrix:appViewMode', viewMode)
  }, [viewMode])

  useEffect(() => {
    fetchDomains()
    fetchApps()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  }, [])

  useEffect(() => {
    if (user) fetchFavorites()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when user changes
  }, [user])

  useEffect(() => {
    if (mainTab === 'mine' && user) fetchMyApps()
    if (mainTab === 'shared' && user) fetchSharedApps()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when mainTab or user changes
  }, [mainTab, user])

  useEffect(() => {
    if (deletedAppId) {
      setApps(prev => prev.filter(a => String(a.id) !== String(deletedAppId)))
      setMyApps(prev => prev.filter(a => String(a.id) !== String(deletedAppId)))
    }
  }, [deletedAppId])

  useEffect(() => {
    if (!createdApp) return
    setApps(prev => {
      if (prev.some(a => a.id === createdApp.id)) return prev
      return [createdApp, ...prev]
    })
    setMyApps(prev => {
      if (prev.some(a => a.id === createdApp.id)) return prev
      return [createdApp, ...prev]
    })
    onCreatedAppConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when createdApp changes
  }, [createdApp])

  useEffect(() => {
    function handleSendToApp(e) {
      const targetApp = e.detail
      const full = apps.find(a => a.id === targetApp.id)
      if (full) onSelectApp(full)
    }
    window.addEventListener('aistrix:send-to-app', handleSendToApp)
    return () => window.removeEventListener('aistrix:send-to-app', handleSendToApp)
  }, [apps, onSelectApp])

  async function fetchDomains() {
    const { data } = await supabase
      .from('domains')
      .select('*')
      .order('order_index')
    if (data) setDomains(data)
  }

  async function fetchApps() {
    const { data } = await supabase
      .from('apps')
      .select('*, domains(name, emoji, color, slug)')
      .eq('is_published', true)
      .order('workflow_order')
    if (data) {
      setApps(data)
    }
    setLoading(false)
  }

  async function fetchMyApps() {
    if (!user) return
    const { data } = await supabase
      .from('apps')
      .select('*, domains(name, emoji, color, slug)')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
    if (data) setMyApps(data)
  }

  async function fetchSharedApps() {
    if (!user) return
    setLoadingShared(true)
    const { data: memberships } = await supabase.from('app_members').select('app_id, role')
      .or(`user_id.eq.${user.id},invited_email.eq.${user.email}`)
    const ids = [...new Set((memberships || []).map(m => m.app_id))]
    const roles = {}
    for (const m of memberships || []) roles[m.app_id] = m.role
    setSharedRoles(roles)
    if (!ids.length) { setSharedApps([]); setLoadingShared(false); return }
    const { data } = await supabase.from('apps').select('*, domains(name, emoji, color, slug)').in('id', ids)
    setSharedApps(data || [])
    setLoadingShared(false)
  }

  async function togglePublish(app) {
    const { data } = await supabase
      .from('apps')
      .update({ is_published: !app.is_published })
      .eq('id', app.id)
      .select()
      .single()
    if (data) {
      setMyApps(prev => prev.map(a => a.id === app.id ? { ...a, is_published: data.is_published } : a))
    }
  }

  async function fetchFavorites() {
    const { data } = await supabase
      .from('favorites')
      .select('app_id')
      .eq('user_id', user.id)
    if (data) setFavorites(new Set(data.map(f => String(f.app_id))))
  }

  async function toggleFavorite(appId) {
    const id = String(appId)
    const isFav = favorites.has(id)

    if (isFav) {
      const { error } = await supabase.from('favorites').delete().eq('app_id', id).eq('user_id', user.id)
      if (error) { toast(error.message, 'error'); return }
      setFavorites(prev => { const next = new Set(prev); next.delete(id); return next })
    } else {
      const { error } = await supabase.from('favorites').insert({ app_id: id, user_id: user.id })
      if (error) { toast(error.message, 'error'); return }
      setFavorites(prev => new Set([...prev, id]))
    }
  }

  const [localSearch, setLocalSearch] = useState('')
  const effectiveSearch = localSearch || search

  const filteredApps = useMemo(() => apps.filter(app => {
    const matchesDomain = activeDomain === 'all'
      || (activeDomain === 'favorites' && favorites.has(String(app.id)))
      || app.domain_id === activeDomain
    const matchesSearch = !effectiveSearch
      || app.name.toLowerCase().includes(effectiveSearch.toLowerCase())
      || app.description?.toLowerCase().includes(effectiveSearch.toLowerCase())
      || app.tags?.some(t => t.toLowerCase().includes(effectiveSearch.toLowerCase()))
    return matchesDomain && matchesSearch
  }), [apps, activeDomain, favorites, effectiveSearch])

  const domainAppCountMap = useMemo(() => {
    const map = {}
    apps.forEach(a => { map[a.domain_id] = (map[a.domain_id] || 0) + 1 })
    return map
  }, [apps])

  const activeGoal = APP_GOALS.find(g => g.id === selectedGoal)
  const goalSuggestedApps = useMemo(() => {
    if (!activeGoal) return []
    const terms = activeGoal.query.toLowerCase().split(/\s+/)
    return apps.filter(app => terms.some(term =>
      app.name?.toLowerCase().includes(term) ||
      app.description?.toLowerCase().includes(term) ||
      app.tags?.some(t => t.toLowerCase().includes(term))
    )).slice(0, 6)
  }, [activeGoal, apps])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {showCreate && (
        <Suspense fallback={null}>
          <CreateAppModal user={user} initialType={initialAppType}
            websitePrefilled={websitePrefilledApp}
            onClose={onCloseCreate}
            onBack={onBackToTypeSelector}
            onCreated={newApp => { setApps(prev => [...prev, newApp]); onCloseCreate?.(); onAppCreated?.(newApp) }} />
        </Suspense>
      )}

      {/* ── Fixed top area ── */}
      <div className="shrink-0 px-6 pt-6">
        {/* ── Tabs + actions ── */}
        <div className="section-tab-row flex items-center justify-between">
          <div className="section-tabs">
            <button onClick={() => setMainTab('discover')}
              className={`section-tab ${mainTab === 'discover' ? 'section-tab-active' : ''}`}>
              <span className="section-tab-label">Discover</span>
              🌐 Discover
            </button>
            <button onClick={() => setMainTab('mine')}
              className={`section-tab ${mainTab === 'mine' ? 'section-tab-active' : ''}`}>
              <span className="section-tab-label">My Apps</span>
              {myApps.length > 0 && <span className="section-tab-count">{myApps.length}</span>}
              🗂 My Apps {myApps.length > 0 && <span className="ml-1.5 opacity-70">{myApps.length}</span>}
            </button>
            <button onClick={() => setMainTab('shared')}
              className={`section-tab ${mainTab === 'shared' ? 'section-tab-active' : ''}`}>
              <span className="section-tab-label">Shared</span>
              👥 Shared {sharedApps.length > 0 && <span className="ml-1.5 opacity-70">{sharedApps.length}</span>}
            </button>
          </div>
        </div>

        {/* ── Goal bar (discover only) ── */}
        {mainTab === 'discover' && (
          <div className="mb-5">
            <p className="text-[11px] text-slate-500 mb-2 font-medium uppercase tracking-wide">What do you want to solve?</p>
            <div className="flex flex-wrap gap-2">
              {APP_GOALS.map(g => {
                const d = domains.find(d => d.slug === g.domain || d.name.toLowerCase().includes(g.domain))
                return (
                  <button
                    key={g.label}
                    onClick={() => { setSelectedGoal(g.id); if (d) setActiveDomain(d.id); setLocalSearch('') }}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all ${
                      selectedGoal === g.id
                        ? 'border-[#6C5CE7]/60 bg-[#6C5CE7]/20 text-white'
                        : 'border-white/15 bg-[#1A2038] text-slate-300 hover:text-white hover:border-white/30 hover:bg-[#212840]'
                    }`}
                  >
                    <span className="text-[10px] font-bold text-[#A29BFE]">{g.cue}</span> {g.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Solution Packs (discover only) ── */}
        {mainTab === 'discover' && (
          <AistrixAppSuggestions
            goal={activeGoal}
            suggestedApps={goalSuggestedApps}
            onUseRecommendation={() => setLocalSearch(activeGoal?.query || '')}
            onBuildApp={() => onOpenCreate?.()}
            onBuildWorkflow={() => onNavChange?.('flows')}
          />
        )}

        {mainTab === 'discover' && (
          <SolutionPacksSection user={user} apps={apps} onFavoritesChanged={fetchFavorites} />
        )}

        {/* ── Row 3: Category filters + search + view toggle (discover only) ── */}
        {mainTab === 'discover' && (
          <div className="flex items-center gap-2 mb-4 min-w-0">
            {/* Scrollable pills */}
            <div className="flex items-center gap-2 flex-1 overflow-x-auto min-w-0 no-scrollbar">
              {[
                { id: 'all',       label: 'All',      count: apps.length,    emoji: '' },
                { id: 'favorites', label: 'Favorites', count: favorites.size, emoji: '★' },
              ].map(tab => (
                <button key={tab.id} onClick={() => setActiveDomain(tab.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-lg text-xs font-medium transition-all shrink-0
                    ${activeDomain === tab.id
                      ? 'bg-[#6C5CE7] text-white shadow-sm shadow-[#6C5CE7]/30'
                      : 'bg-[#1A2038] text-slate-300 hover:text-white hover:bg-[#212840]'}`}>
                  {tab.emoji && <span>{tab.emoji}</span>}
                  {tab.label}
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${activeDomain === tab.id ? 'bg-white/20' : 'bg-white/10'}`}>
                    {tab.count}
                  </span>
                </button>
              ))}
              <div className="w-px h-4 bg-white/10 mx-0.5 shrink-0" />
              {domains.map(domain => (
                <button key={domain.id} onClick={() => setActiveDomain(domain.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-lg text-xs font-medium transition-all shrink-0
                    ${activeDomain === domain.id ? 'text-white shadow-sm' : 'bg-[#1A2038] text-slate-300 hover:text-white hover:bg-[#212840]'}`}
                  style={activeDomain === domain.id ? { background: domain.color, boxShadow: `0 2px 8px ${domain.color}40` } : {}}>
                  {domain.emoji} {domain.name}
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${activeDomain === domain.id ? 'bg-white/20' : 'bg-white/10'}`}>
                    {domainAppCountMap[domain.id] || 0}
                  </span>
                </button>
              ))}
            </div>
            {/* Fixed: search + view toggle */}
            <div className="relative shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
              <input
                value={localSearch}
                onChange={e => setLocalSearch(e.target.value)}
                placeholder="Filter apps..."
                aria-label="Filter apps"
                className="w-36 bg-[#1A2038] border border-white/20 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors"
              />
            </div>
            <div className="flex items-center bg-[#1A2038] border border-white/20 rounded-lg p-0.5 shrink-0">
              <button onClick={() => setViewMode('compact')}
                title="Compact" aria-label="Compact tabs view"
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${viewMode === 'compact' ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
                <span aria-hidden="true">▦</span>
              </button>
              <button onClick={() => setViewMode('grid')}
                title="Cards" aria-label="Detailed cards view"
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
                <span aria-hidden="true">▤</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Floating scrollable area ── */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">

        {/* ── My Apps view ── */}
        {mainTab === 'mine' && (
          <div className="mb-10">
            {myApps.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-5xl mb-4">🗂</div>
                <p className="text-white font-medium mb-2">No apps yet</p>
                <p className="text-slate-400 text-sm">Build your first AI-powered app — it takes under a minute</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {myApps.map(app => (
                  <AppCard
                    key={app.id}
                    app={{ ...app, total_runs: (app.total_runs || 0) + (runCounts[String(app.id)] || 0) }}
                    selected={selectedApp?.id === app.id}
                    starred={favorites.has(String(app.id))}
                    isOwn={true}
                    onClick={() => onSelectApp(app)}
                    onToggleFavorite={() => toggleFavorite(app.id)}
                    showPublishToggle={true}
                    onPublishToggle={() => togglePublish(app)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Shared with me ── */}
        {mainTab === 'shared' && (
          <div className="mb-10">
            {loadingShared ? (
              <p className="text-slate-500 text-sm text-center py-20">Loading...</p>
            ) : sharedApps.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-5xl mb-4">👥</div>
                <p className="text-white font-medium mb-2">Nothing shared with you yet</p>
                <p className="text-slate-400 text-sm">Apps a teammate invites you to will show up here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {sharedApps.map(app => (
                  <AppCard
                    key={app.id}
                    app={{ ...app, total_runs: (app.total_runs || 0) + (runCounts[String(app.id)] || 0) }}
                    selected={selectedApp?.id === app.id}
                    starred={favorites.has(String(app.id))}
                    sharedRole={sharedRoles[app.id]}
                    onClick={() => onSelectApp(app)}
                    onToggleFavorite={() => toggleFavorite(app.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Discover: domain template strip + app grid ── */}
        {mainTab === 'discover' && <>

          {/* ── Domain workspace template strip ── */}
          {activeDomain !== 'all' && activeDomain !== 'favorites' && (() => {
            const domain = domains.find(d => d.id === activeDomain)
            if (!domain) return null
            const domainApps = apps.filter(a => a.domain_id === activeDomain).sort((a, b) => a.workflow_order - b.workflow_order)
            if (!domainApps.length) return null
            return (
              <DomainTemplateCard
                domain={domain}
                domainApps={domainApps}
                selectedApp={selectedApp}
                user={user}
                onSelectApp={onSelectApp}
                onNavChange={onNavChange}
              />
            )
          })()}

          {loading ? (
            viewMode === 'compact' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mb-10">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="bg-[#171B33] border border-white/10 rounded-xl p-3 animate-pulse h-24 flex flex-col items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-white/5" />
                    <div className="h-2.5 bg-white/5 rounded w-3/4" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-10">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="bg-[#171B33] border border-white/10 rounded-2xl p-5 animate-pulse h-52">
                    <div className="w-12 h-12 rounded-xl bg-white/5 mb-4" />
                    <div className="h-3.5 bg-white/5 rounded mb-3 w-2/3" />
                    <div className="h-2.5 bg-white/5 rounded mb-2" />
                    <div className="h-2.5 bg-white/5 rounded w-3/4" />
                  </div>
                ))}
              </div>
            )
          ) : filteredApps.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">
                {effectiveSearch ? '🔍' : activeDomain === 'favorites' ? '★' : '🤖'}
              </div>
              <p className="text-white font-medium mb-2">
                {effectiveSearch ? `No AI apps found for "${effectiveSearch}"` : activeDomain === 'favorites' ? 'No favorites yet' : 'No AI apps here yet'}
              </p>
              <p className="text-slate-400 text-sm">
                {effectiveSearch ? 'Try a different search term'
                  : activeDomain === 'favorites' ? 'Click ☆ on any app card to save it here'
                  : 'Build your first AI-powered app — it takes under a minute'}
              </p>
            </div>
          ) : viewMode === 'compact' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mb-10">
              {filteredApps.map(app => (
                <AppTab
                  key={app.id}
                  app={{ ...app, total_runs: (app.total_runs || 0) + (runCounts[String(app.id)] || 0) }}
                  selected={selectedApp?.id === app.id}
                  starred={favorites.has(String(app.id))}
                  isOwn={app.created_by === user?.id}
                  onClick={() => onSelectApp(app)}
                  onToggleFavorite={() => toggleFavorite(app.id)}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-10">
              {filteredApps.map(app => (
                <AppCard
                  key={app.id}
                  app={{ ...app, total_runs: (app.total_runs || 0) + (runCounts[String(app.id)] || 0) }}
                  selected={selectedApp?.id === app.id}
                  starred={favorites.has(String(app.id))}
                  isOwn={app.created_by === user?.id}
                  onClick={() => onSelectApp(app)}
                  onToggleFavorite={() => toggleFavorite(app.id)}
                />
              ))}
            </div>
          )}

        </>}

        {/* ── Footer ── */}
        <div className="border-t border-white/10 pt-6 pb-3 mt-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-500">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-[#6C5CE7] flex items-center justify-center text-white font-bold text-[9px]">A</div>
              <span>© {new Date().getFullYear()} Aistrix. All rights reserved.</span>
            </div>
            <div className="flex items-center gap-3">
              {['App Gallery', 'Privacy Policy', 'Terms of Service', 'Support'].map((link, i) => (
                <span key={link} className="flex items-center gap-3">
                  {i > 0 && <span>·</span>}
                  <a href={
                      link === 'App Gallery' ? '/gallery'
                      : link === 'Support' ? 'mailto:support@aistrix.com'
                      : link === 'Privacy Policy' ? '/privacy'
                      : '/terms'
                    }
                    className="hover:text-slate-400 transition-colors">{link}</a>
                </span>
              ))}
            </div>
            <span className="text-slate-700">Powered by Claude & GPT</span>
          </div>
        </div>
      </div>
    </div>
  )
}
