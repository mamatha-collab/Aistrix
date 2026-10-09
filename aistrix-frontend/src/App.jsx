import { useState, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { supabase } from './supabase'
import Sidebar from './components/SidebarClean'
import TopBar from './components/TopBarClean'
import AppGrid from './components/AppGrid'
import DetailPanel from './components/DetailPanel'
import Auth from './components/Auth'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { identify, resetIdentity } from './lib/analytics'
import { getUserRole, isAdmin, isModerator } from './utils/roles'
import { useKeyboard } from './hooks/useKeyboard'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useWorkspaces } from './hooks/useWorkspaces'
import { History, LayoutGrid, Settings, Workflow } from 'lucide-react'

// Lazy-load heavy pages — only downloaded when first visited
const Gallery         = lazy(() => import('./pages/Gallery'))
const AppPage         = lazy(() => import('./pages/AppPage'))
const AppDocsPage     = lazy(() => import('./pages/AppDocsPage'))
const AppEmbedPage    = lazy(() => import('./pages/AppEmbedPage'))
const OverviewPage    = lazy(() => import('./pages/OverviewPage'))
const SettingsPage    = lazy(() => import('./pages/SettingsPage'))
const AlertsPage      = lazy(() => import('./pages/AlertsPage'))
const ProfilesPage    = lazy(() => import('./pages/ProfilesPage'))
const FlowsPage       = lazy(() => import('./pages/FlowsPage'))
const GoalsPage       = lazy(() => import('./pages/GoalsPage'))
const EventsPage      = lazy(() => import('./pages/EventsPage'))
const DataSourcesPage = lazy(() => import('./pages/DataSourcesPage'))
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'))
const AdminPage       = lazy(() => import('./pages/AdminPage'))
const ModeratorPage   = lazy(() => import('./pages/ModeratorPage'))
const AnalyticsPage   = lazy(() => import('./pages/AnalyticsPage'))
const ReportsPage     = lazy(() => import('./pages/ReportsPage'))
const DevDashboardPage = lazy(() => import('./pages/DevDashboardPage'))
const DevStudioPage    = lazy(() => import('./pages/DevStudioPage'))
const KnowledgeVaultPage = lazy(() => import('./pages/KnowledgeVaultPage'))
const PrivacyPage       = lazy(() => import('./pages/LegalPages').then(m => ({ default: m.PrivacyPage })))
const TermsPage         = lazy(() => import('./pages/LegalPages').then(m => ({ default: m.TermsPage })))
const MarketplacePage    = lazy(() => import('./pages/MarketplacePage').then(m => ({ default: m.MarketplacePage })))
const MarketplaceAppPage = lazy(() => import('./pages/MarketplacePage').then(m => ({ default: m.MarketplaceAppPage })))
const DeveloperProfilePage = lazy(() => import('./pages/DeveloperProfilePage'))
const InvitePage           = lazy(() => import('./pages/InvitePage'))

// Lazy-load modal/panel components — all of these are gated behind a `show*`
// toggle and never needed for the initial shell render, so there's no reason
// for them (and, for RunHistory/CreateFromWebsiteModal, react-markdown along
// with them) to sit in the main bundle.
const RunHistory             = lazy(() => import('./components/RunHistory'))
const ApiKeySettings         = lazy(() => import('./components/ApiKeySettings'))
const OnboardingWizard       = lazy(() => import('./components/OnboardingWizard'))
const OnboardingModal        = lazy(() => import('./components/OnboardingModal'))
const UserProfile            = lazy(() => import('./components/UserProfile'))
const AppTypeSelector        = lazy(() => import('./components/AppTypeSelector'))
const AIAppBuilder           = lazy(() => import('./components/AIAppBuilder'))
const TypeBuilderGuide       = lazy(() => import('./components/TypeBuilderGuide'))
const CreateFromWebsiteModal = lazy(() => import('./components/CreateFromWebsiteModal'))
const WorkspaceRecommendations = lazy(() => import('./components/WorkspaceRecommendations'))
const CreateAppModal           = lazy(() => import('./components/CreateAppModal'))
const WorkspaceSettingsModal   = lazy(() => import('./components/WorkspaceSettingsModal'))

// Legal pages must stay reachable without signing in.
const PUBLIC_PAGES = { '/privacy': PrivacyPage, '/terms': TermsPage }

// Every in-app "view" gets its own URL, so browser back/forward, deep links,
// and support screenshots all reflect the section actually on screen instead
// of everything staying at "/".
const VIEW_PATH_MAP = {
  apps: '/apps', overview: '/dashboard', profiles: '/profiles', flows: '/flows',
  history: '/history',
  goals: '/goals', events: '/events', analytics: '/analytics', reports: '/reports',
  settings: '/settings', alerts: '/alerts', developer: '/developer',
  data_sources: '/data-sources', integrations: '/integrations', admin: '/admin', moderator: '/moderator',
  knowledge_vault: '/knowledge-vault',
}
const PATH_VIEW_MAP = {
  ...Object.fromEntries(Object.entries(VIEW_PATH_MAP).map(([view, path]) => [path, view])),
  '/home': 'overview', '/pricing': 'overview', '/overview': 'overview',
  '/workspaces': 'flows', '/workflows': 'flows',
  '/run-history': 'history',
  '/api': 'developer', '/usage': 'analytics', '/dev-studio': 'developer',
  '/knowledge': 'knowledge_vault', '/knowledge-base': 'knowledge_vault',
  '/marketplace': 'marketplace',
}

function isDeveloperExperiencePath(pathname) {
  return pathname === '/developer'
    || pathname === '/dev-studio'
    || pathname === '/api'
    || pathname === '/marketplace'
    || pathname.startsWith('/developer/')
    || pathname.startsWith('/marketplace/')
}

function shouldShowStarterOnboarding(pathname = window.location.pathname) {
  const currentMode = localStorage.getItem('aistrix_mode') || 'business'
  return currentMode !== 'developer' && !isDeveloperExperiencePath(pathname)
}

// Rendered next to a lazily loaded build step: runs once that step has
// actually mounted, so the previous step can be removed without the popup
// disappearing while the next one loads.
function AfterMount({ run }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  useLayoutEffect(() => { run() }, [])
  return null
}

export default function App() {
  const [selectedApp, setSelectedApp] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [search, setSearch] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [runCounts, setRunCounts] = useState({})
  const [activeView, setActiveView] = useState(() => {
    const fromPath = PATH_VIEW_MAP[window.location.pathname]
      ?? (window.location.pathname.startsWith('/marketplace') ? 'marketplace' : null)
      ?? (window.location.pathname === '/dev-studio' ? 'developer' : null)
    if (fromPath) return fromPath
    // If no explicit path, restore to developer when mode was left as developer
    const savedMode = localStorage.getItem('aistrix_mode')
    if (savedMode === 'developer') return 'developer'
    return 'flows'
  })
  const [userRole, setUserRole] = useState(null)
  const [deletedAppId, setDeletedAppId] = useState(null)
  const [showTypeSelector, setShowTypeSelector] = useState(false)
  const [selectedAppType, setSelectedAppType] = useState('prompt')
  const [showTypeGuide, setShowTypeGuide] = useState(false)
  const [showAIBuilder, setShowAIBuilder] = useState(false)
  const [showWebsiteBuilder, setShowWebsiteBuilder] = useState(false)
  const [websitePrefilledApp, setWebsitePrefilledApp] = useState(null)
  const [createdApp, setCreatedApp] = useState(null)
  const [workspaceRecoApp, setWorkspaceRecoApp] = useState(null)
  const [showAppOnboarding, setShowAppOnboarding] = useState(false)
  const [mode, setMode] = useState(() => localStorage.getItem('aistrix_mode') || 'business')
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false)
  const workspaces = useWorkspaces(session?.user ?? null)
  // Mount build section once and keep alive — enables cross-fade between flows/apps with no remount
  const [buildMounted, setBuildMounted] = useState(() => {
    const fromPath = PATH_VIEW_MAP[window.location.pathname]
    if (fromPath) return ['flows', 'apps'].includes(fromPath)
    // default view: mount build layer only in business mode
    return localStorage.getItem('aistrix_mode') !== 'developer'
  })
  const searchInputRef = useRef(null)
  const isDesktopNav = useMediaQuery('(min-width: 768px)')
  const navigate = useNavigate()
  const location = useLocation()

  const handleRunComplete = useCallback((appId) => {
    const id = String(appId)
    setRunCounts(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }))
  }, [])

  const dismissWelcomeOnboarding = useCallback(() => {
    localStorage.setItem('aistrix_welcomed', '1')
    localStorage.setItem('aistrix_onboarding_done', '1')
    setShowOnboarding(false)
  }, [])

  const dismissAppOnboarding = useCallback(() => {
    localStorage.setItem('aistrix:app_onboarding_done', '1')
    setShowAppOnboarding(false)
  }, [])

  // The build flow (type picker → guide → build step) reads as one popup:
  // each step opens over the previous one, and closing ends the whole flow.
  function closeBuildFlow() {
    setShowTypeSelector(false); setShowTypeGuide(false)
    setShowCreate(false); setShowAIBuilder(false); setShowWebsiteBuilder(false)
    setWebsitePrefilledApp(null)
  }

  const handleEscape = useCallback(() => {
    if (showHistory)       { setShowHistory(false);       return }
    if (showSettings)      { setShowSettings(false);      return }
    if (showCreate)        { setShowCreate(false);        return }
    if (showOnboarding)    { setShowOnboarding(false);    return }
    if (showMobileSidebar) { setShowMobileSidebar(false); return }
    if (selectedApp)       { setSelectedApp(null);        return }
    if (search)            { setSearch('');               return }
  }, [showHistory, showSettings, showCreate, showOnboarding, showMobileSidebar, selectedApp, search])

  useKeyboard({
    onSearch: () => searchInputRef.current?.focus(),
    onEscape: handleEscape,
  })


  const navigateToView = useCallback((view) => {
    setActiveView(view)
    if (view === 'flows' || view === 'apps') setBuildMounted(true)
    const path = VIEW_PATH_MAP[view]
    if (path && path !== location.pathname) navigate(path)
  }, [navigate, location.pathname])

  const changeView = useCallback((view) => {
    navigateToView(view)
    setSelectedApp(null)
    setShowMobileSidebar(false)
  }, [navigateToView])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
      if (session) {
        if (!localStorage.getItem('aistrix_welcomed') && shouldShowStarterOnboarding()) setShowOnboarding(true)
        getUserRole(session.user.id).then(setUserRole)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (session) identify(session.user.id, { email: session.user.email })
      else if (event === 'SIGNED_OUT') resetIdentity()
      if (session && !localStorage.getItem('aistrix_welcomed') && shouldShowStarterOnboarding()) setShowOnboarding(true)
      if (session && !localStorage.getItem('aistrix:app_onboarding_done') && shouldShowStarterOnboarding()) {
        supabase.from('apps').select('id', { count: 'exact', head: true })
          .eq('created_by', session.user.id)
          .then(({ count }) => {
            if ((count || 0) === 0) setShowAppOnboarding(true)
          })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Remember the page that required sign-in so we can return to it afterward,
  // instead of always dropping the user on the default view post-login.
  useEffect(() => {
    if (!loading && !session && location.pathname !== '/') {
      sessionStorage.setItem('aistrix:postLoginPath', location.pathname + location.search)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on loading/session changes, not every location change
  }, [loading, session])

  useEffect(() => {
    if (!session) return
    const saved = sessionStorage.getItem('aistrix:postLoginPath')
    if (!saved) return
    sessionStorage.removeItem('aistrix:postLoginPath')
    if (saved !== location.pathname + location.search) navigate(saved, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when session changes (post-login redirect)
  }, [session])

  // Keep activeView in sync when the URL changes from outside changeView —
  // e.g. the browser back/forward buttons, or a direct/bookmarked alias URL.
  useEffect(() => {
    const mapped = PATH_VIEW_MAP[location.pathname]
      ?? (location.pathname.startsWith('/marketplace') ? 'marketplace' : null)
      ?? (location.pathname === '/dev-studio' ? 'developer' : null)
    if (!mapped) return
    if (mapped !== activeView) setActiveView(mapped)
    // Redirect alias paths to their canonical URL so bookmarks self-correct
    // (don't redirect /marketplace/:id — the dynamic segment must stay)
    const canonical = VIEW_PATH_MAP[mapped]
    if (canonical && canonical !== location.pathname && !location.pathname.startsWith('/marketplace/')) {
      navigate(canonical, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeView is read, not a trigger; only re-run on path changes
  }, [location.pathname])

  // Allow deep components (AppRunner, etc.) to trigger navigation without prop-drilling
  useEffect(() => {
    const handler = e => changeView(e.detail)
    window.addEventListener('aistrix:nav', handler)
    return () => window.removeEventListener('aistrix:nav', handler)
  }, [changeView])

  const PublicPage = PUBLIC_PAGES[location.pathname]
  if (PublicPage) return <Suspense fallback={null}><PublicPage /></Suspense>

  // Widgets are framed into other websites: they must render for signed-out
  // visitors too (AppEmbedPage shows its own sign-in gate when needed).
  if (location.pathname.startsWith('/embed/')) {
    return (
      <Routes>
        <Route path="/embed/:id" element={<Suspense fallback={null}><AppEmbedPage /></Suspense>} />
      </Routes>
    )
  }

  if (loading) return (
    <div className="min-h-screen bg-[#09101F] flex items-center justify-center">
      <div className="text-slate-400 text-sm">Loading...</div>
    </div>
  )

  if (!session) return <Auth />

  // Invite links: signed-out visitors log in first (the path is remembered
  // above and restored after login), then the invite is accepted here.
  if (location.pathname.startsWith('/invite/')) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<Suspense fallback={null}><InvitePage user={session.user} /></Suspense>} />
      </Routes>
    )
  }

  if (workspaces.loading) return (
    <div className="min-h-screen bg-[#09101F] flex items-center justify-center">
      <div className="text-slate-400 text-sm">Loading workspace…</div>
    </div>
  )

  const switchWorkspace = id => {
    setSelectedApp(null)
    setShowWorkspaceSettings(false)
    workspaces.switchTo(id)
  }

  // Lookup table for non-apps views — avoids a wall of conditionals
  const viewMap = {
    overview:    <OverviewPage    user={session.user} onSelectApp={app => { setSelectedApp(app); navigateToView('apps') }} />,
    profiles:    <ProfilesPage    user={session.user} />,
    history:     <RunHistory      user={session.user} onClose={() => changeView('flows')} inline />,
    flows:       null, // handled by shared build container below
    goals:       <GoalsPage       user={session.user} />,
    events:      <EventsPage      user={session.user} onRunEvent={event => { setSelectedApp({ id: event.app_id, name: event.app_name, emoji: event.app_emoji }); navigateToView('apps') }} />,
    analytics:   <AnalyticsPage   user={session.user} />,
    reports:     <ReportsPage     user={session.user} />,
    settings:    <SettingsPage    user={session.user} />,
    alerts:      <AlertsPage      user={session.user} />,
    developer:   <DevStudioPage user={session.user} onOpenCreate={() => setShowTypeSelector(true)} onShowHistory={() => setShowHistory(true)} onShowSettings={() => setShowSettings(true)} onNavChange={changeView} search={search} onSearch={setSearch} searchRef={searchInputRef} createdApp={createdApp} onCreatedAppConsumed={() => setCreatedApp(null)} />,
    data_sources:<DataSourcesPage user={session.user} />,
    integrations:<IntegrationsPage user={session.user} />,
    admin:          isAdmin(userRole)     ? <AdminPage          user={session.user} /> : null,
    moderator:      isModerator(userRole) ? <ModeratorPage      user={session.user} userRole={userRole} /> : null,
    knowledge_vault: <KnowledgeVaultPage user={session.user} />,
    marketplace:     location.pathname.startsWith('/marketplace/')
                       ? <MarketplaceAppPage appId={location.pathname.split('/marketplace/')[1]?.split('/')[0]} />
                       : <MarketplacePage />,
  }

  const activePage = viewMap[activeView]

  return (
    <Routes>
      <Route path="/app/:id" element={<Suspense fallback={null}><AppPage /></Suspense>} />
      <Route path="/app/:id/docs" element={<Suspense fallback={null}><AppDocsPage /></Suspense>} />
      <Route path="/embed/:id" element={<Suspense fallback={null}><AppEmbedPage /></Suspense>} />
      <Route path="/gallery" element={<Suspense fallback={null}><Gallery /></Suspense>} />
      <Route path="/dev/:userId" element={<Suspense fallback={null}><DeveloperProfilePage /></Suspense>} />
      <Route path="/*" element={
        // Keyed by workspace: switching remounts the shell so every page
        // reloads its data for the newly active workspace.
        <div key={workspaces.active?.id || 'no-workspace'} className="app-shell flex h-screen overflow-hidden bg-[#09101F]">

          {showMobileSidebar && (
            <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setShowMobileSidebar(false)} />
          )}

          {/* On mobile: only mount the Sidebar while it's open so keyboard/SR
              focus can never reach its controls when the drawer is closed.
              On desktop (md+): always mounted so the persistent nav is visible. */}
          {(isDesktopNav || showMobileSidebar) && (
            <div className={`fixed inset-y-0 left-0 z-40 md:relative md:z-auto md:flex ${showMobileSidebar ? 'translate-x-0' : 'md:translate-x-0'}`}>
              <Sidebar
                user={session.user}
                userRole={userRole}
                onSelectApp={app => { setSelectedApp(app); setShowMobileSidebar(false); navigateToView('apps') }}
                onClose={() => setShowMobileSidebar(false)}
                onShowProfile={() => setShowProfile(true)}
                onShowHistory={() => changeView('history')}
                activeView={activeView}
                onNavChange={changeView}
                mode={mode}
                onModeChange={next => {
                  setMode(next)
                  localStorage.setItem('aistrix_mode', next)
                  if (next === 'developer') {
                    setShowOnboarding(false)
                    setShowAppOnboarding(false)
                  }
                  changeView(next === 'developer' ? 'developer' : 'flows')
                }}
              />
            </div>
          )}

          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            {activeView !== 'developer' && (
              <TopBar
                onShowHistory={() => setShowHistory(true)}
                onShowSettings={() => setShowSettings(true)}
                onToggleSidebar={() => setShowMobileSidebar(v => !v)}
                onShowCreate={() => setShowTypeSelector(true)}
                onShowWorkspace={() => navigateToView('flows')}
                activeView={activeView}
                search={search}
                onSearch={setSearch}
                searchRef={searchInputRef}
                user={session.user}
                onNavChange={changeView}
                workspaces={workspaces.workspaces}
                activeWorkspace={workspaces.active}
                onSwitchWorkspace={switchWorkspace}
                onCreateWorkspace={async name => { const id = await workspaces.createTeam(name); switchWorkspace(id) }}
                onManageWorkspace={() => setShowWorkspaceSettings(true)}
              />
            )}
            {showWorkspaceSettings && workspaces.active && !workspaces.active.is_personal && (
              <Suspense fallback={null}>
                <WorkspaceSettingsModal
                  workspace={workspaces.active}
                  user={session.user}
                  onClose={() => setShowWorkspaceSettings(false)}
                  onChanged={() => workspaces.refresh(workspaces.active.id)}
                  onLeft={async () => {
                    setShowWorkspaceSettings(false)
                    const personal = workspaces.workspaces.find(w => w.is_personal)
                    await workspaces.refresh(personal?.id)
                  }}
                />
              </Suspense>
            )}
            <main className="relative flex flex-1 overflow-hidden pb-14 md:pb-0" onClick={() => activeView === 'apps' && setSelectedApp(null)}>
              {/* Shared build container — flows + apps stay mounted; only the active layer animates in */}
              {buildMounted && (
                <div className={`absolute inset-0 flex overflow-hidden ${(activeView === 'flows' || activeView === 'apps') ? '' : 'hidden'}`}>
                  {/* AI Workflows layer */}
                  <div className={activeView === 'flows' ? 'page-layer-active' : 'page-layer-hidden'}>
                    <Suspense fallback={null}>
                      <FlowsPage user={session.user} onShowHistory={() => setShowHistory(true)} />
                    </Suspense>
                  </div>
                  {/* AI Apps layer */}
                  <div className={activeView === 'apps' ? 'page-layer-active' : 'page-layer-hidden'}>
                    <AppGrid
                      onSelectApp={setSelectedApp}
                      selectedApp={selectedApp}
                      user={session.user}
                      search={search}
                      runCounts={runCounts}
                      deletedAppId={deletedAppId}
                      onOpenCreate={() => setShowTypeSelector(true)}
                      onNavChange={navigateToView}
                      createdApp={createdApp}
                      onCreatedAppConsumed={() => setCreatedApp(null)}
                    />
                    {selectedApp && (
                      <DetailPanel
                        app={selectedApp}
                        user={session.user}
                        onClose={() => setSelectedApp(null)}
                        onRun={handleRunComplete}
                        onDeleted={appId => { setDeletedAppId(appId); setSelectedApp(null) }}
                      />
                    )}
                  </div>
                </div>
              )}
              {/* All other views */}
              {activePage && activeView !== 'flows' && activeView !== 'apps' && (
                <div className="flex flex-1 overflow-hidden">
                  <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Loading...</div>}>
                    {activePage}
                  </Suspense>
                </div>
              )}
            </main>
          </div>

          {showTypeSelector && (
            <Suspense fallback={null}>
              <AppTypeSelector
                onClose={() => setShowTypeSelector(false)}
                onSelect={type => {
                  setSelectedAppType(type)
                  // Build with AI shows its guide inside the builder popup
                  if (type === 'ai_builder') { setShowAIBuilder(true); return }
                  setShowTypeGuide(true)
                  // keep showTypeSelector true — selector stays behind the guide
                }}
              />
            </Suspense>
          )}
          {showTypeGuide && (
            <Suspense fallback={null}>
              <TypeBuilderGuide
                type={selectedAppType}
                onClose={() => setShowTypeGuide(false)}
                onContinue={() => {
                  // The guide stays until the next step has mounted (AfterMount)
                  if (selectedAppType === 'ai_builder') setShowAIBuilder(true)
                  else if (selectedAppType === 'website') setShowWebsiteBuilder(true)
                  else setShowCreate(true)
                }}
              />
            </Suspense>
          )}
          {showCreate && (
            <Suspense fallback={null}>
              <AfterMount run={() => { setShowTypeGuide(false); setShowWebsiteBuilder(false) }} />
              <CreateAppModal
                user={session.user}
                initialType={selectedAppType}
                websitePrefilled={websitePrefilledApp}
                onClose={closeBuildFlow}
                onBack={() => { setShowCreate(false); setWebsitePrefilledApp(null); setShowTypeGuide(true) }}
                onCreated={newApp => {
                  closeBuildFlow()
                  setCreatedApp(newApp)
                  if (activeView !== 'developer') {
                    navigateToView('apps')
                    setWorkspaceRecoApp(newApp)
                  }
                }}
              />
            </Suspense>
          )}
          {showWebsiteBuilder && (
            <Suspense fallback={null}>
              <AfterMount run={() => setShowTypeGuide(false)} />
              <CreateFromWebsiteModal
                user={session.user}
                onClose={closeBuildFlow}
                onGenerated={prefilled => {
                  // Stays open until the details step has mounted over it
                  setWebsitePrefilledApp(prefilled)
                  setSelectedAppType('website')
                  setShowCreate(true)
                }}
              />
            </Suspense>
          )}
          {showAIBuilder && (
            <Suspense fallback={null}>
              <AIAppBuilder
                user={session.user}
                withGuide
                onClose={closeBuildFlow}
                onBack={() => setShowAIBuilder(false)}
                onCreated={newApp => {
                  closeBuildFlow()
                  setCreatedApp(newApp)
                  if (activeView !== 'developer') {
                    navigateToView('apps')
                    setSelectedApp(newApp)
                    setWorkspaceRecoApp(newApp)
                  }
                }}
              />
            </Suspense>
          )}
          {workspaceRecoApp && (
            <Suspense fallback={null}>
              <WorkspaceRecommendations
                app={workspaceRecoApp}
                onDismiss={() => setWorkspaceRecoApp(null)}
                onViewWorkspaces={() => { setWorkspaceRecoApp(null); navigateToView('flows') }}
              />
            </Suspense>
          )}
          {/* ── Mobile bottom nav ── */}
          <nav className="app-topbar fixed bottom-0 left-0 right-0 bg-[#121829] border-t border-white/8 flex md:hidden z-40">
            {[
              { view: 'apps',     Icon: LayoutGrid, label: 'Apps' },
              { view: 'flows',    Icon: Workflow,   label: 'Workflows' },
              { view: 'history',  Icon: History,    label: 'History',  action: () => setShowHistory(true) },
              { view: 'settings', Icon: Settings,   label: 'Settings' },
            ].map(({ view, Icon, label, action }) => (
              <button key={view}
                onClick={() => action ? action() : changeView(view)}
                className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-xs transition-colors
                  ${activeView === view && !action
                    ? 'text-[#A29BFE]'
                    : 'text-slate-500 hover:text-slate-300'}`}>
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {showHistory    && <Suspense fallback={null}><RunHistory     user={session.user} onClose={() => setShowHistory(false)} /></Suspense>}
          {showSettings   && <Suspense fallback={null}><ApiKeySettings  user={session.user} onClose={() => setShowSettings(false)} /></Suspense>}
          {showProfile    && <Suspense fallback={null}><UserProfile     user={session.user} onClose={() => setShowProfile(false)} /></Suspense>}
          {showOnboarding && (
            <Suspense fallback={null}>
              <OnboardingWizard
                user={session.user}
                onDismiss={dismissWelcomeOnboarding}
                onNavChange={changeView}
              />
            </Suspense>
          )}
          {showAppOnboarding && (
            <Suspense fallback={null}>
              <OnboardingModal
                onClose={dismissAppOnboarding}
                onComplete={dismissAppOnboarding}
              />
            </Suspense>
          )}
        </div>
      } />
    </Routes>
  )
}
