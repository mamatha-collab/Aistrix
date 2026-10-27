'use client'

import { lazy, Suspense, useEffect, useState } from 'react'
import DeveloperShell from './DeveloperShell'
import Sidebar from './SidebarClean'
import TopBar from './TopBarClean'
import ErrorBoundary from './ErrorBoundary'
import { ToastProvider } from './Toast'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useLocation, useNavigate } from '../navigation'
import { WORKSPACE_ROUTES } from '../lib/workspaceRoutes'
import { getUserRole } from '../utils/roles'
import '../business-workspace.css'

const Keys = lazy(() => import('./ApiKeySettings'))
const WorkspaceSettings = lazy(() => import('./WorkspaceSettingsModal'))
const viewPaths = Object.fromEntries(Object.entries(WORKSPACE_ROUTES).map(([path, route]) => [route.screen, path]))

// Public discovery uses the same console frame as Business and Dev Studio.
// Catalog data still arrives from anonymous server reads; session state controls
// account actions only, never access to the public catalog.
export default function MarketplaceConsole({ user, sessionReady, children, detail = false }) {
  const [drawer, setDrawer] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [userRole, setUserRole] = useState(null)
  const desktop = useMediaQuery('(min-width: 768px)')
  const navigate = useNavigate()
  const location = useLocation()
  const workspaces = useWorkspaces(user)
  const userId = user?.id
  useEffect(() => {
    let live = true
    setUserRole(null)
    if (userId) getUserRole(userId).then(role => { if (live) setUserRole(role) })
    return () => { live = false }
  }, [userId])
  function go(view) {
    const path = view === 'marketplace' ? '/marketplace' : viewPaths[view]
    if (!path) return
    localStorage.setItem('aistrix_mode', view === 'developer' ? 'developer' : 'business')
    setDrawer(false)
    navigate(path)
  }
  const signIn = () => navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
  return <ToastProvider>
    <DeveloperShell active badge="Business" onHome={() => go(user ? 'overview' : 'marketplace')} className="app-shell marketplace-console business-workspace flex h-dvh overflow-hidden bg-[#09101F]">
      {drawer && <button aria-label="Close navigation backdrop" className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDrawer(false)} />}
      {(desktop || drawer) && <div className={`fixed inset-y-0 left-0 z-40 md:relative md:z-auto md:flex ${drawer ? '' : 'md:translate-x-0'}`}>
        <Sidebar user={user} userRole={userRole} mode="business" activeView="marketplace" onClose={() => setDrawer(false)} onNavChange={go} onHome={() => go(user ? 'overview' : 'marketplace')}
          onModeChange={mode => go(mode === 'developer' ? 'developer' : 'marketplace')} />
      </div>}
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <TopBar user={user} activeView="marketplace" marketDetail={detail}
          sessionLoading={!sessionReady} onSignIn={signIn} onNavChange={go}
          onToggleSidebar={() => setDrawer(value => !value)} onShowHistory={() => go('history')}
          onShowSettings={() => setKeysOpen(true)} workspaces={workspaces.workspaces} activeWorkspace={workspaces.active}
          onSwitchWorkspace={workspaces.switchTo}
          onCreateWorkspace={async name => { const id = await workspaces.createTeam(name); workspaces.switchTo(id) }}
          onManageWorkspace={() => setWorkspaceOpen(true)} />
        <main aria-label="Marketplace" className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
          {detail ? <div key={location.pathname} className="flex-1 min-w-0 overflow-y-auto">{children}</div> : children}
        </main>
      </div>
      {keysOpen && user && <ErrorBoundary variant="overlay" title="Key settings couldn't load" onClose={() => setKeysOpen(false)}>
        <Suspense fallback={null}><Keys user={user} onClose={() => setKeysOpen(false)} /></Suspense>
      </ErrorBoundary>}
      {workspaceOpen && user && workspaces.active && <Suspense fallback={null}>
        <WorkspaceSettings workspace={workspaces.active} user={user} onClose={() => setWorkspaceOpen(false)}
          onChanged={() => workspaces.refresh(workspaces.active.id)} onLeft={() => { setWorkspaceOpen(false); workspaces.refresh() }} />
      </Suspense>}
    </DeveloperShell>
  </ToastProvider>
}
