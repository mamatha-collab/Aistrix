import 'server-only'
import { notFound } from 'next/navigation'
import { requireWorkspaceSession } from './workspaceSession'
import { createSessionClient } from './supabase'
import { WORKSPACE_ROUTES } from '../lib/workspaceRoutes'
import WorkspaceRoute from '../app/workspace-route'

export function workspaceMetadata(path) {
  return { title: `${WORKSPACE_ROUTES[path].title} | Aistrix` }
}

export function makeWorkspacePage(path) {
  const { screen } = WORKSPACE_ROUTES[path]
  return async function WorkspacePage({ searchParams }) {
    const user = await requireWorkspaceSession(path.slice(1).split('/'), searchParams)
    if (screen === 'admin' || screen === 'moderator') {
      const client = await createSessionClient()
      const { data, error } = await client.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
      const allowed = screen === 'admin' ? data?.role === 'admin' : ['admin', 'moderator'].includes(data?.role)
      if (error || !allowed) notFound()
    }
    return <WorkspaceRoute screen={screen} />
  }
}

export function makeStandalonePage(screen, segments) {
  return async function StandalonePage({ params, searchParams }) {
    const values = await params
    const path = segments.map(segment => segment.startsWith(':') ? values[segment.slice(1)] : segment)
    if (screen !== 'embed') await requireWorkspaceSession(path, searchParams)
    return <WorkspaceRoute screen={screen} />
  }
}
