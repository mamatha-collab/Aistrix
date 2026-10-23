// Active workspace for this browser tab.
//
// Every request to the Aistrix backend and to Supabase's REST API carries it
// as `X-Workspace-Id`: the backend checks membership and scopes runs,
// purchases, keys and batches to it; the database files new rows (apps,
// flows, run history…) under it. List queries use scopeToWorkspace().
//
// activeId stays null until useWorkspaces() has confirmed the user is a
// member of the stored workspace, so a stale id (e.g. after being removed
// from a team) is never sent.

const STORAGE_KEY = 'aistrix_active_workspace'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

let activeId = null

export function getStoredWorkspaceId() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

export function getActiveWorkspaceId() {
  return activeId
}

export function setActiveWorkspaceId(id) {
  activeId = id || null
  try {
    if (activeId) localStorage.setItem(STORAGE_KEY, activeId)
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* private mode: workspace just won't be remembered */ }
}

// "Mine" lists: everything in the active workspace. Falls back to the
// signed-in user's own rows before workspaces have loaded.
export function scopeToWorkspace(query, user, ownerColumn = 'user_id') {
  return activeId ? query.eq('workspace_id', activeId) : query.eq(ownerColumn, user.id)
}

function withHeader(input, init) {
  if (!activeId) return init
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  if (!headers.has('X-Workspace-Id')) headers.set('X-Workspace-Id', activeId)
  return { ...init, headers }
}

function urlOf(input) {
  return typeof input === 'string' ? input : input?.url || String(input)
}

// Supabase client fetch (see supabase.js): only PostgREST calls get the header.
export function supabaseWorkspaceFetch(input, init) {
  return fetch(input, urlOf(input).includes('/rest/v1/') ? withHeader(input, init) : init)
}

// Backend calls are plain fetch() in many components, so the header is added
// once here for any request to the Aistrix API.
let installed = false
export function installApiWorkspaceHeader() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) =>
    nativeFetch(input, urlOf(input).startsWith(API_URL) ? withHeader(input, init) : init)
}
