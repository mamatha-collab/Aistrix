'use client'

import { Suspense } from 'react'
import { useWorkspaceRoute } from '../components/WorkspaceRouteContext'
import WorkspaceScreens from '../components/WorkspaceScreens'
import { STANDALONE_SCREENS } from '../lib/workspaceRoutes'

const loading = <div role="status" className="flex-1 grid place-items-center text-slate-400">Loading workspace page…</div>

// Route-owned screen content receives only the shared shell capabilities it
// needs. The shell keeps modals, workspace switching and builder guards alive.
export default function WorkspaceRoute({ screen }) {
  const context = useWorkspaceRoute()
  if (!STANDALONE_SCREENS.has(screen) && context.activeView !== screen) return loading
  return <section data-workspace-route={screen} className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
    <Suspense fallback={loading}><WorkspaceScreens {...context} screen={screen} /></Suspense>
  </section>
}
