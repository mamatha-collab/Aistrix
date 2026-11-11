import type { User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export interface WorkspaceContext {
  user?: User
  activeView: string
  changeView?: (view: string) => void
  onSelectApp?: (app: { id: string; name?: string }) => void
  onRunEvent?: (event: { app_id: string; app_name: string; app_emoji?: string }) => void
  pathname?: string
  userRole?: string | null
  developerProps?: Record<string, unknown>
}
export const WorkspaceRouteContext = createContext<WorkspaceContext | null>(null)

export function useWorkspaceRoute() {
  const context = useContext(WorkspaceRouteContext)
  if (!context) throw new Error('Workspace pages require the authenticated workspace shell.')
  return context
}
