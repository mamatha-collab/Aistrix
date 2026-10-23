import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { getStoredWorkspaceId, setActiveWorkspaceId } from '../lib/workspace'

function slugFor(name) {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36)
  return `${base || 'team'}-${Math.random().toString(36).slice(2, 7)}`
}

// Loads the user's workspaces, restores the last active one (if they're
// still a member) and keeps lib/workspace.js in sync.
export function useWorkspaces(user) {
  const userId = user?.id
  const [state, setState] = useState({ loading: true, workspaces: [], active: null, error: null })

  const load = useCallback(async (preferId) => {
    if (!userId) { setState({ loading: false, workspaces: [], active: null, error: null }); return }
    const { data, error } = await supabase
      .from('workspace_members')
      .select('role, workspace:workspaces(id, name, slug, is_personal, plan)')
      .eq('user_id', userId)
    if (error) {
      // Workspaces not migrated (or unreachable): run as before, unscoped.
      setActiveWorkspaceId(null)
      setState({ loading: false, workspaces: [], active: null, error: error.message })
      return
    }
    const list = (data || [])
      .filter(r => r.workspace)
      .map(r => ({ ...r.workspace, role: r.role }))
      .sort((a, b) => (b.is_personal - a.is_personal) || a.name.localeCompare(b.name))
    const want = preferId || getStoredWorkspaceId()
    const active = list.find(w => w.id === want) || list.find(w => w.is_personal) || list[0] || null
    setActiveWorkspaceId(active?.id || null)
    setState({ loading: false, workspaces: list, active, error: null })
  }, [userId])   // not [user]: token refreshes create a new user object

  useEffect(() => { load() }, [load])

  const switchTo = useCallback(id => {
    setState(s => {
      const next = s.workspaces.find(w => w.id === id)
      if (!next) return s
      setActiveWorkspaceId(next.id)
      return { ...s, active: next }
    })
  }, [])

  const createTeam = useCallback(async name => {
    const clean = name.trim()
    if (!clean) throw new Error('Give the workspace a name')
    const { data, error } = await supabase
      .from('workspaces')
      .insert({ name: clean.slice(0, 80), slug: slugFor(clean), created_by: userId })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    await load(data.id)       // creator was added as owner by a database trigger
    return data.id
  }, [userId, load])

  return { ...state, refresh: load, switchTo, createTeam }
}

export const ROLE_LABELS = {
  owner: 'Owner', admin: 'Admin', developer: 'Developer', member: 'Member', billing: 'Billing',
}
export const canManage = ws => ['owner', 'admin'].includes(ws?.role)
export const canBuild = ws => ['owner', 'admin', 'developer'].includes(ws?.role)
