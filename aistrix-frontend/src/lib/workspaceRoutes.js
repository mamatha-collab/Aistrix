import { safeReturnPath } from './authPaths'

export const WORKSPACE_ROUTES = {
  '/dashboard': { screen: 'overview', title: 'Dashboard' },
  '/apps': { screen: 'apps', title: 'My Apps' },
  '/flows': { screen: 'flows', title: 'Workflows' },
  '/settings': { screen: 'settings', title: 'Settings' },
  '/profiles': { screen: 'profiles', title: 'Shared Profiles' },
  '/history': { screen: 'history', title: 'Run History' },
  '/goals': { screen: 'goals', title: 'Goals' },
  '/events': { screen: 'events', title: 'Schedules' },
  '/analytics': { screen: 'analytics', title: 'Analytics' },
  '/reports': { screen: 'reports', title: 'Usage and Billing' },
  '/alerts': { screen: 'alerts', title: 'Alerts' },
  '/developer': { screen: 'developer', title: 'Dev Studio' },
  '/data-sources': { screen: 'data_sources', title: 'Data Sources' },
  '/integrations': { screen: 'integrations', title: 'Integrations' },
  '/knowledge-vault': { screen: 'knowledge_vault', title: 'Knowledge Vault' },
  '/admin': { screen: 'admin', title: 'Administration' },
  '/moderator': { screen: 'moderator', title: 'Moderation' },
}

export { WORKSPACE_ALIASES } from '../../config/route-aliases.mjs'

export const STANDALONE_SCREENS = new Set(['app', 'docs', 'embed', 'gallery', 'invite', 'developer_profile'])

export function standaloneScreen(pathname) {
  if (/^\/app\/[^/]+\/docs$/.test(pathname)) return 'docs'
  if (/^\/app\/[^/]+$/.test(pathname)) return 'app'
  if (/^\/embed\/[^/]+$/.test(pathname)) return 'embed'
  if (/^\/invite\/[^/]+$/.test(pathname)) return 'invite'
  if (/^\/dev\/[^/]+$/.test(pathname)) return 'developer_profile'
  if (pathname === '/gallery') return 'gallery'
  return null
}

export function isNativeWorkspacePath(pathname) {
  return Object.hasOwn(WORKSPACE_ROUTES, pathname) || !!standaloneScreen(pathname)
}

export function requiresWorkspaceSession(pathname) {
  if (['/', '/login', '/privacy', '/terms', '/reset-password', '/auth/callback', '/marketplace', '/robots.txt', '/sitemap.xml'].includes(pathname)) return false
  return !['/marketplace/', '/dev/', '/embed/', '/_next/'].some(prefix => pathname.startsWith(prefix))
}

export function workspaceReturnPath(segments = [], query = {}) {
  const search = new URLSearchParams()
  for (const [key, values] of Object.entries(query)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      if (value != null) search.append(key, value)
    }
  }
  const path = `/${segments.map(segment => encodeURIComponent(segment)).join('/')}`
  return safeReturnPath(path + (search.size ? `?${search}` : ''))
}
