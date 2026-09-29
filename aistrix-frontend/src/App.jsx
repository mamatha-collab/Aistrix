import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { supabase } from './supabase'
import Sidebar from './components/SidebarClean'
import TopBar from './components/TopBarClean'
import AppGrid from './components/AppGrid'
import DetailPanel from './components/DetailPanel'
import Auth from './components/Auth'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { getUserRole, isAdmin, isModerator } from './utils/roles'
import { useKeyboard } from './hooks/useKeyboard'
import { useMediaQuery } from './hooks/useMediaQuery'
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
const PrivacyPage     = lazy(() => import('./pages/LegalPages').then(m => ({ default: m.PrivacyPage })))
const TermsPage       = lazy(() => import('./pages/LegalPages').then(m => ({ default: m.TermsPage })))

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
  '/api': 'developer', '/usage': 'analytics',
  '/knowledge': 'knowledge_vault', '/knowledge-base': 'knowledge_vault',
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
  const [activeView, setActiveView] = useState(() => PATH_VIEW_MAP[window.location.pathname] || 'flows')
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
  // Mount build section once and keep alive — enables cross-fade between flows/apps with no remount
  const [buildMounted, setBuildMounted] = useState(() => ['flows', 'apps'].includes(PATH_VIEW_MAP[window.location.pathname] || 'flows'))
  const searchInputRef = useRef(null)
  const isDesktopNav = useMediaQuery('(min-width: 768px)')
  const navigate = useNavigate()
  const location = useLocation()

  const handleRunComplete = useCallback((appId) => {
    const id = String(appId)
    setRunCounts(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }))
  }, [])

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
        if (!localStorage.getItem('aistrix_welcomed')) setShowOnboarding(true)
        getUserRole(session.user.id).then(setUserRole)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session && !localStorage.getItem('aistrix_welcomed')) setShowOnboarding(true)
      if (session && !localStorage.getItem('aistrix:app_onboarding_done')) {
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
    if (!mapped) return
    if (mapped !== activeView) setActiveView(mapped)
    // Redirect alias paths to their canonical URL so bookmarks self-correct
    const canonical = VIEW_PATH_MAP[mapped]
    if (canonical && canonical !== location.pathname) navigate(canonical, { replace: true })
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

  if (loading) return (
    <div className="min-h-screen bg-[#09101F] flex items-center justify-center">
      <div className="text-slate-400 text-sm">Loading...</div>
    </div>
  )

  if (!session) return <Auth />

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
    developer:   <DevStudioPage user={session.user} onOpenCreate={() => setShowTypeSelector(true)} />,
    data_sources:<DataSourcesPage user={session.user} />,
    integrations:<IntegrationsPage user={session.user} />,
    admin:          isAdmin(userRole)     ? <AdminPage          user={session.user} /> : null,
    moderator:      isModerator(userRole) ? <ModeratorPage      user={session.user} userRole={userRole} /> : null,
    knowledge_vault: <KnowledgeVaultPage user={session.user} />,
  }

  const activePage = viewMap[activeView]

  return (
    <Routes>
      <Route path="/app/:id" element={<Suspense fallback={null}><AppPage /></Suspense>} />
      <Route path="/app/:id/docs" element={<Suspense fallback={null}><AppDocsPage /></Suspense>} />
      <Route path="/embed/:id" element={<Suspense fallback={null}><AppEmbedPage /></Suspense>} />
      <Route path="/gallery" element={<Suspense fallback={null}><Gallery /></Suspense>} />
      <Route path="/*" element={
        <div className="app-shell flex h-screen overflow-hidden bg-[#09101F]">

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
              />
            </div>
          )}

          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
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
            />
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
                      initialAppType={selectedAppType}
                      showCreate={showCreate}
                      onOpenCreate={() => setShowTypeSelector(true)}
                      onCloseCreate={() => setShowCreate(false)}
                      onBackToTypeSelector={() => { setShowCreate(false); setShowTypeSelector(true) }}
                      onNavChange={navigateToView}
                      createdApp={createdApp}
                      onCreatedAppConsumed={() => setCreatedApp(null)}
                      websitePrefilledApp={websitePrefilledApp}
                      onAppCreated={newApp => { setWorkspaceRecoApp(newApp); setWebsitePrefilledApp(null) }}
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
                  setShowTypeSelector(false)
                  if (type === 'ai_builder') { setShowAIBuilder(true) }
                  else if (type === 'workspace') { navigateToView('flows') }
                  else if (type === 'website') { setShowWebsiteBuilder(true) }
                  else {
                    setSelectedAppType(type)
                    setShowTypeGuide(true)
                  }
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
                  setShowTypeGuide(false)
                  navigateToView('apps')
                  setShowCreate(true)
                }}
              />
            </Suspense>
          )}
          {showWebsiteBuilder && (
            <Suspense fallback={null}>
              <CreateFromWebsiteModal
                user={session.user}
                onClose={() => setShowWebsiteBuilder(false)}
                onGenerated={prefilled => {
                  setShowWebsiteBuilder(false)
                  setWebsitePrefilledApp(prefilled)
                  navigateToView('apps')
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
                onClose={() => setShowAIBuilder(false)}
                onBack={() => { setShowAIBuilder(false); setShowTypeSelector(true) }}
                onCreated={newApp => {
                  setShowAIBuilder(false)
                  navigateToView('apps')
                  setCreatedApp(newApp)
                  setSelectedApp(newApp)
                  setWorkspaceRecoApp(newApp)
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
                onDismiss={() => setShowOnboarding(false)}
                onNavChange={changeView}
              />
            </Suspense>
          )}
          {showAppOnboarding && (
            <Suspense fallback={null}>
              <OnboardingModal
                onComplete={() => {
                  localStorage.setItem('aistrix:app_onboarding_done', '1')
                  setShowAppOnboarding(false)
                }}
              />
            </Suspense>
          )}
        </div>
      } />
    </Routes>
  )
}
