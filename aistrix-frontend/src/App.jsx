import './business-workspace.css'
import { useState, useEffect, useRef, useCallback, lazy, Suspense, startTransition } from 'react'
import { noteAuthEvent } from './lib/session'
import { supabase } from './supabase'
import { loadProviders, useProviderStatus } from './lib/providers'
import Sidebar from './components/SidebarClean'
import DeveloperShell, { DeveloperLoading } from './components/DeveloperShell'
import TopBar from './components/TopBarClean'
import AppGrid from './components/AppGrid'
import { WorkspaceRouteContext } from './components/WorkspaceRouteContext'
import { standaloneScreen } from './lib/workspaceRoutes'
import WorkspaceScreens from './components/WorkspaceScreens'
import DetailPanel from './components/DetailPanel'
import Auth from './components/Auth'
import ErrorBoundary from './components/ErrorBoundary'
import { useNavigate, useLocation } from './navigation'
import { identify, resetIdentity, track, EVENTS } from './lib/analytics'
import { getUserRole } from './utils/roles'
import { useKeyboard } from './hooks/useKeyboard'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useWorkspaces } from './hooks/useWorkspaces'
import { Code2, History, LayoutGrid, Settings, User, Workflow } from 'lucide-react'

const FlowsPage = lazy(() => import('./screens/FlowsPage'))
const PrivacyPage = lazy(() => import('./screens/LegalPages').then(m => ({ default: m.PrivacyPage })))
const TermsPage = lazy(() => import('./screens/LegalPages').then(m => ({ default: m.TermsPage })))

// Lazy-load modal/panel components — all of these are gated behind a `show*`
// toggle and never needed for the initial shell render, so there's no reason
// for them (and, for RunHistory, react-markdown along
// with them) to sit in the main bundle.
const RunHistory             = lazy(() => import('./components/RunHistory'))
const ApiKeySettings         = lazy(() => import('./components/ApiKeySettings'))
const OnboardingWizard       = lazy(() => import('./components/OnboardingWizard'))
const OnboardingModal        = lazy(() => import('./components/OnboardingModal'))
const UserProfile            = lazy(() => import('./components/UserProfile'))
const AppTypeSelector        = lazy(() => import('./components/AppTypeSelector'))
const AIAppBuilder           = lazy(() => import('./components/AIAppBuilder'))
const WorkspaceRecommendations = lazy(() => import('./components/WorkspaceRecommendations'))
const CreateAppModal           = lazy(() => import('./components/CreateAppModal'))
const WorkspaceSettingsModal   = lazy(() => import('./components/WorkspaceSettingsModal'))

// Legal pages must stay reachable without signing in.
const PUBLIC_PAGES = { '/privacy': PrivacyPage, '/terms': TermsPage }

// Every in-app "view" gets its own URL, so browser back/forward, deep links,
// and support screenshots all reflect the section actually on screen instead
// of everything staying at "/".
const VIEW_PATH_MAP = {
  marketplace: '/marketplace', apps: '/apps', overview: '/dashboard', profiles: '/profiles', flows: '/flows',
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

// Business-user screens. The Developer workspace never shows them: a link,
// notification, back button or old bookmark that leads to one from Developer
// stays in Dev Studio. Business is reached only with the Business/Developer
// switch. (Settings, Admin, Moderator and the Marketplace belong to both.)
const BUSINESS_VIEWS = new Set(['apps', 'overview', 'profiles', 'flows', 'history', 'goals', 'events', 'analytics',
  'reports', 'alerts', 'data_sources', 'integrations', 'knowledge_vault'])

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

export default function App({ routeContent }) {
  const [selectedApp, setSelectedApp] = useState(null)
  const [openFlowId, setOpenFlowId] = useState(null)   // a workflow picked in the Business left pane
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [search, setSearch] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  // App type waiting for the developer to add their first AI key.
  const [keyGateType, setKeyGateType] = useState(null)
  const keyStatus = useProviderStatus(session?.user?.id)
  // Known (server answered) and none saved: the Keys buttons show a warning.
  const noKeys = keyStatus.loaded && !keyStatus.hasKey
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
    return 'marketplace'
  })
  const [userRole, setUserRole] = useState(null)
  const [deletedAppId, setDeletedAppId] = useState(null)
  const [showTypeSelector, setShowTypeSelector] = useState(false)
  const [selectedAppType, setSelectedAppType] = useState('prompt')
  const [showAIBuilder, setShowAIBuilder] = useState(false)
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
  const buildNavigationGuardRef = useRef(null)
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

  // One welcome per new developer: finishing or closing the first-app
  // onboarding also counts as the welcome, so the second popup doesn't follow.
  const dismissAppOnboarding = useCallback(() => {
    localStorage.setItem('aistrix:app_onboarding_done', '1')
    localStorage.setItem('aistrix_welcomed', '1')
    localStorage.setItem('aistrix_onboarding_done', '1')
    setShowAppOnboarding(false)
    setShowOnboarding(false)
  }, [])

  // The starter popups are for end users. A developer (owns an app or has a
  // developer profile) never sees them, on any page or browser. New end users
  // get the first-app onboarding; anyone else not yet welcomed gets the
  // welcome wizard. Never both.
  const pickOnboarding = useCallback(async session => {
    if (!session || !shouldShowStarterOnboarding()) return
    const welcomed = !!localStorage.getItem('aistrix_welcomed')
    const appOnboardingDone = !!localStorage.getItem('aistrix:app_onboarding_done')
    if (welcomed && appOnboardingDone) return
    const userId = session.user.id
    const [apps, profile] = await Promise.all([
      supabase.from('apps').select('id', { count: 'exact', head: true }).eq('created_by', userId),
      supabase.from('developer_profiles').select('user_id').eq('user_id', userId).maybeSingle(),
    ])
    // Unknown (a read failed): show nothing rather than the wrong popup.
    if (apps.error || profile.error) return
    if ((apps.count || 0) > 0 || profile.data) {
      localStorage.setItem('aistrix_welcomed', '1')
      localStorage.setItem('aistrix_onboarding_done', '1')
      localStorage.setItem('aistrix:app_onboarding_done', '1')
      return
    }
    if (!appOnboardingDone) setShowAppOnboarding(true)
    else if (!welcomed) setShowOnboarding(true)
  }, [])

  function openBuilder(type) {
    startTransition(() => {
      setSelectedAppType(type)
      if (type === 'ai_builder') setShowAIBuilder(true)
      else setShowCreate(true)
    })
  }

  // Picking a type opens one popup (guide first, then the build steps) over
  // the type picker; closing it ends the whole flow.
  function closeBuildFlow() {
    setShowTypeSelector(false); setShowCreate(false); setShowAIBuilder(false)
  }

  const handleEscape = useCallback(() => {
    if (showHistory)       { setShowHistory(false);       return }
    if (showSettings)      { setShowSettings(false);      return }
    if (activeView === 'developer' && showTypeSelector) return
    if (showCreate)        { setShowCreate(false);        return }
    if (showOnboarding)    { setShowOnboarding(false);    return }
    if (showMobileSidebar) { setShowMobileSidebar(false); return }
    if (selectedApp)       { setSelectedApp(null);        return }
    if (search)            { setSearch('');               return }
  }, [showHistory, showSettings, showCreate, showOnboarding, showMobileSidebar, selectedApp, search, activeView, showTypeSelector])

  useKeyboard({
    onSearch: () => searchInputRef.current?.focus(),
    onEscape: handleEscape,
  })


  const navigateToView = useCallback((view) => {
    const guard = buildNavigationGuardRef.current
    if (view !== 'developer' && guard && !guard(() => navigateToView(view))) return false
    setActiveView(view)
    if (view === 'flows' || view === 'apps') setBuildMounted(true)
    const path = VIEW_PATH_MAP[view]
    if (path && path !== location.pathname) navigate(path)
    return true
  }, [navigate, location.pathname])

  const changeView = useCallback((view) => {
    // Unsaved Design edits: the guard asks first and continues this change after.
    const guard = buildNavigationGuardRef.current
    if (view !== 'developer' && guard && !guard(() => changeView(view))) return false
    if (!navigateToView(view)) return false
    setSelectedApp(null)
    setShowMobileSidebar(false)
    return true
  }, [navigateToView])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
      if (session) {
        pickOnboarding(session)
        getUserRole(session.user.id).then(setUserRole)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      noteAuthEvent(event)   // an unexpected sign-out = expired session (Auth explains it)
      setSession(session)
      if (session) identify(session.user.id, { email: session.user.email })
      else if (event === 'SIGNED_OUT') resetIdentity()
      if (event === 'SIGNED_IN') pickOnboarding(session)
    })

    return () => subscription.unsubscribe()
  }, [pickOnboarding])

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

  // Keep the workspaces separate: opening Dev Studio (link, bookmark, sign-in)
  // puts you in Developer mode, and Developer mode never renders a business
  // screen — only the Business/Developer switch leaves it.
  useEffect(() => {
    if (activeView === 'developer' && mode !== 'developer') {
      setMode('developer')
      localStorage.setItem('aistrix_mode', 'developer')
      return
    }
    if (mode === 'developer' && BUSINESS_VIEWS.has(activeView)) {
      setActiveView('developer')
      if (location.pathname !== VIEW_PATH_MAP.developer) navigate(VIEW_PATH_MAP.developer, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the mode or screen changes
  }, [mode, activeView])

  // Allow deep components (AppRunner, etc.) to trigger navigation without prop-drilling
  useEffect(() => {
    const handler = e => changeView(e.detail)
    window.addEventListener('aistrix:nav', handler)
    return () => window.removeEventListener('aistrix:nav', handler)
  }, [changeView])

  const PublicPage = PUBLIC_PAGES[location.pathname]
  if (PublicPage) return <Suspense fallback={null}><PublicPage /></Suspense>

  const standalone = standaloneScreen(location.pathname)
  // Visitor embeds do not need a user or workspace bootstrap.
  if (standalone === 'embed') return <WorkspaceRouteContext.Provider value={{ user: session?.user, activeView }}>
    <Suspense fallback={null}>{routeContent || <WorkspaceScreens screen="embed" />}</Suspense>
  </WorkspaceRouteContext.Provider>

  if (loading && activeView === 'developer') return <DeveloperLoading />

  if (loading) return (
    <div className="min-h-screen bg-[#09101F] flex items-center justify-center">
      <div className="text-slate-400 text-sm">Loading...</div>
    </div>
  )

  if (!session) return <Auth developer={activeView === 'developer'} />

  if (standalone) return <WorkspaceRouteContext.Provider value={{ user: session.user, activeView, changeView }}>
    <Suspense fallback={null}>{routeContent || <WorkspaceScreens screen={standalone} user={session.user} />}</Suspense>
  </WorkspaceRouteContext.Provider>

  if (workspaces.loading && activeView === 'developer') return <DeveloperLoading />

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
  const creationFlow = showTypeSelector ? (
            <ErrorBoundary variant={activeView === 'developer' ? 'card' : 'overlay'} title="The app builder couldn't load" onClose={closeBuildFlow}>
            <Suspense fallback={null}>
              <AppTypeSelector
                presentation={activeView === 'developer' ? 'inline' : 'modal'} navigationGuardRef={buildNavigationGuardRef} onLeave={closeBuildFlow}
                hidden={showAIBuilder || showCreate}
                onClose={closeBuildFlow}
                onSelect={async type => {
                  // Building needs the developer's own AI key: ask for one
                  // first (continues into this type once it's saved). If the
                  // key status can't be loaded, don't block building.
                  const providers = await loadProviders().catch(() => null)
                  if (providers && !providers.some(p => p.connected)) { setKeyGateType(type); return }
                  openBuilder(type)
                }}
              />
              {showAIBuilder && (
                <AIAppBuilder
                  presentation={activeView === 'developer' ? 'inline' : 'modal'} navigationGuardRef={buildNavigationGuardRef} onLeave={closeBuildFlow}
                  user={session.user}
                  withGuide
                  onClose={() => setShowAIBuilder(false)}
                  onBack={() => setShowAIBuilder(false)}
                  onCreated={newApp => {
                    closeBuildFlow()
                    track(EVENTS.BUILD_APP_CREATED, { app_id: newApp.id, app_type: newApp.app_type, via: 'build_with_ai' })
                    setCreatedApp(newApp)
                    if (activeView !== 'developer') {
                      navigateToView('apps')
                      setSelectedApp(newApp)
                      setWorkspaceRecoApp(newApp)
                    }
                  }}
                />
              )}
              {showCreate && (
                <CreateAppModal
                  presentation={activeView === 'developer' ? 'inline' : 'modal'} navigationGuardRef={buildNavigationGuardRef} onLeave={closeBuildFlow}
                  user={session.user}
                  initialType={selectedAppType}
                  withGuide
                  onClose={() => setShowCreate(false)}
                  onBack={() => setShowCreate(false)}
                  onCreated={newApp => {
                    closeBuildFlow()
                    track(EVENTS.BUILD_APP_CREATED, { app_id: newApp.id, app_type: newApp.app_type, via: selectedAppType })
                    setCreatedApp(newApp)
                    if (activeView !== 'developer') {
                      navigateToView('apps')
                      setWorkspaceRecoApp(newApp)
                    }
                  }}
                />
              )}
            </Suspense>
            </ErrorBoundary>
  ) : null

  const screenContext = {
    user: session.user, userRole, activeView, changeView, pathname: location.pathname,
    onSelectApp: app => { setSelectedApp(app); navigateToView('apps') },
    onRunEvent: event => { setSelectedApp({ id: event.app_id, name: event.app_name, emoji: event.app_emoji }); navigateToView('apps') },
    developerProps: {
      creationContent: creationFlow, navigationGuardRef: buildNavigationGuardRef,
      onOpenCreate: () => setShowTypeSelector(true), onShowSettings: () => setShowSettings(true),
      onShowProfile: () => setShowProfile(true), noKeys, onNavChange: changeView,
      search, onSearch: setSearch, searchRef: searchInputRef, createdApp,
      onCreatedAppConsumed: () => setCreatedApp(null),
    },
  }
  const activePage = routeContent
    ? <WorkspaceRouteContext.Provider value={screenContext}>{routeContent}</WorkspaceRouteContext.Provider>
    : <WorkspaceScreens {...screenContext} screen={activeView} />

  return (
        // Keyed by workspace: switching remounts the shell so every page
        // reloads its data for the newly active workspace.
        <DeveloperShell active badge={activeView === 'developer' ? 'Developer' : 'Business'} key={workspaces.active?.id || 'no-workspace'} className={`app-shell flex h-dvh overflow-hidden bg-[#09101F] ${activeView !== 'developer' ? 'business-workspace' : ''}`}>

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
                onOpenFlow={id => { setOpenFlowId(id); setShowMobileSidebar(false); navigateToView('flows') }}
                paneRefreshKey={activeView}
                onClose={() => setShowMobileSidebar(false)}
                onShowProfile={() => setShowProfile(true)}
                onShowHistory={() => changeView('history')}
                activeView={activeView}
                onNavChange={changeView}
                mode={mode}
                onModeChange={function switchMode(next) {
                  // Leaving Dev Studio with unsaved Design edits: finish the
                  // whole switch after the developer answers the dialog.
                  const guard = buildNavigationGuardRef.current
                  if (next !== 'developer' && guard && !guard(() => switchMode(next))) return
                  if (!changeView(next === 'developer' ? 'developer' : 'marketplace')) return
                  setMode(next)
                  localStorage.setItem('aistrix_mode', next)
                  if (next === 'developer') {
                    setShowOnboarding(false)
                    setShowAppOnboarding(false)
                  }
                }}
              />
            </div>
          )}

          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            {activeView !== 'developer' && (
              <TopBar
                marketDetail={location.pathname.startsWith('/marketplace/')}
                onShowHistory={() => setShowHistory(true)}
                onShowSettings={() => setShowSettings(true)}
                noKeys={noKeys}
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
            <main className={`relative flex flex-1 overflow-hidden ${activeView === 'developer' ? '' : 'pb-14 md:pb-0'}`} onClick={() => activeView === 'apps' && setSelectedApp(null)}>
              {/* Shared build container — flows + apps stay mounted; only the active layer animates in */}
              {buildMounted && (
                <div data-workspace-route={activeView === 'apps' || activeView === 'flows' ? activeView : undefined} className={`absolute inset-0 flex overflow-hidden ${(activeView === 'flows' || activeView === 'apps') ? '' : 'hidden'}`}>
                  {/* AI Workflows layer */}
                  <div className={activeView === 'flows' ? 'page-layer-active' : 'page-layer-hidden'}>
                    <ErrorBoundary compact title="AI Workflows couldn't load">
                      <Suspense fallback={null}>
                        <FlowsPage search={search} user={session.user} onShowHistory={() => setShowHistory(true)}
                          openFlowId={openFlowId} onOpenedFlow={() => setOpenFlowId(null)} />
                      </Suspense>
                    </ErrorBoundary>
                  </div>
                  {/* AI Apps layer */}
                  <div className={activeView === 'apps' ? 'page-layer-active' : 'page-layer-hidden'}>
                    <ErrorBoundary compact title="AI Apps couldn't load">
                    <AppGrid
                      clientMode
                      onSelectApp={setSelectedApp}
                      selectedApp={selectedApp}
                      user={session.user}
                      search={search}
                      onSearch={setSearch}
                      runCounts={runCounts}
                      deletedAppId={deletedAppId}
                      onOpenCreate={() => changeView('developer')}
                      onNavChange={navigateToView}
                      createdApp={createdApp}
                      onCreatedAppConsumed={() => setCreatedApp(null)}
                    />
                    </ErrorBoundary>
                    {selectedApp && (
                      <ErrorBoundary variant="overlay" title="This app's panel couldn't load" resetKey={selectedApp.id} onClose={() => setSelectedApp(null)}>
                      <DetailPanel
                        app={selectedApp}
                        user={session.user}
                        onClose={() => setSelectedApp(null)}
                        onRun={handleRunComplete}
                        onDeleted={appId => { setDeletedAppId(appId); setSelectedApp(null) }}
                      />
                      </ErrorBoundary>
                    )}
                  </div>
                </div>
              )}
              {/* All other views */}
              {activePage && activeView !== 'flows' && activeView !== 'apps' && (
                <div className="flex flex-1 overflow-hidden">
                  <ErrorBoundary compact title="This page couldn't load" resetKey={activeView}>
                    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Loading...</div>}>
                      {activePage}
                    </Suspense>
                  </ErrorBoundary>
                </div>
              )}
            </main>
          </div>

          {activeView !== 'developer' && creationFlow}
          {workspaceRecoApp && (
            <ErrorBoundary variant="quiet" title="WorkspaceRecommendations"><Suspense fallback={null}>
              <WorkspaceRecommendations
                app={workspaceRecoApp}
                onDismiss={() => setWorkspaceRecoApp(null)}
                onViewWorkspaces={() => { setWorkspaceRecoApp(null); navigateToView('flows') }}
              />
            </Suspense></ErrorBoundary>
          )}
          {/* ── Mobile bottom nav ── */}
          {activeView !== 'developer' && <nav className="app-topbar fixed bottom-0 left-0 right-0 bg-[#121829] border-t border-white/8 flex md:hidden z-40">
            {(mode === 'developer' ? [
              { view: 'developer', Icon: Code2,    label: 'Studio',   action: () => changeView('developer') },
              { view: 'keys',      Icon: Settings, label: 'Keys',     action: () => setShowSettings(true) },
              { view: 'account',   Icon: User,     label: 'Account',  action: () => setShowProfile(true) },
            ] : [
              { view: 'marketplace', Icon: LayoutGrid, label: 'Marketplace' },
              { view: 'apps',      Icon: LayoutGrid, label: 'My apps' },
              { view: 'flows',     Icon: Workflow,   label: 'Workflows' },
              { view: 'history',   Icon: History,    label: 'Activity', action: () => changeView('history') },
            ]).map(({ view, Icon, label, action }) => (
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
          </nav>}

          {showHistory    && <ErrorBoundary variant="overlay" title="Run history couldn't load" onClose={() => setShowHistory(false)}><Suspense fallback={null}><RunHistory     user={session.user} onClose={() => setShowHistory(false)} /></Suspense></ErrorBoundary>}
          {showSettings   && <ErrorBoundary variant="overlay" title="Key settings couldn't load" onClose={() => setShowSettings(false)}><Suspense fallback={null}><ApiKeySettings  user={session.user} onClose={() => setShowSettings(false)}
            {...(noKeys ? { title: 'Add an AI key', subtitle: "You haven't added an AI provider key yet. Add a Claude, OpenAI or Gemini key to build apps — it's checked and stored encrypted." } : {})} /></Suspense></ErrorBoundary>}
          {keyGateType && (
            <ErrorBoundary variant="overlay" title="Key settings couldn't load" onClose={() => setKeyGateType(null)}>
            <Suspense fallback={null}>
              <ApiKeySettings
                title="Add an AI key to start building"
                subtitle="Your apps run on your own AI provider key. Add a Claude, OpenAI or Gemini key — it's checked and stored encrypted."
                onClose={() => setKeyGateType(null)}
                onContinue={() => { const type = keyGateType; setKeyGateType(null); openBuilder(type) }}
              />
            </Suspense>
            </ErrorBoundary>
          )}
          {showProfile    && <ErrorBoundary variant="overlay" title="Your profile couldn't load" onClose={() => setShowProfile(false)}><Suspense fallback={null}><UserProfile     user={session.user} onClose={() => setShowProfile(false)} /></Suspense></ErrorBoundary>}
          {showOnboarding && (
            <ErrorBoundary variant="quiet" title="OnboardingWizard"><Suspense fallback={null}>
              <OnboardingWizard
                user={session.user}
                onDismiss={dismissWelcomeOnboarding}
                onNavChange={changeView}
              />
            </Suspense></ErrorBoundary>
          )}
          {showAppOnboarding && (
            <ErrorBoundary variant="quiet" title="OnboardingModal"><Suspense fallback={null}>
              <OnboardingModal
                onClose={dismissAppOnboarding}
                onComplete={dismissAppOnboarding}
              />
            </Suspense></ErrorBoundary>
          )}
        </DeveloperShell>
  )
}
