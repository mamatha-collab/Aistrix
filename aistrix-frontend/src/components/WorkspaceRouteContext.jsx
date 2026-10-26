import { createContext, useContext } from 'react'

export const WorkspaceRouteContext = createContext(null)

export function useWorkspaceRoute() {
  const context = useContext(WorkspaceRouteContext)
  if (!context) throw new Error('Workspace pages require the authenticated workspace shell.')
  return context
}
