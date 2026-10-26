import { BarChart3, Bell, BookOpen, Box, ChartColumn, CircleDot, Database, History, Link, Network, Settings, ShoppingBag, User } from 'lucide-react'

// Object identity and presentation are shared; routes may differ by role.
export const ENTITIES = Object.freeze({
  apps: { label: 'My apps', Icon: Box, table: 'apps' },
  workflows: { label: 'Workflows', Icon: Network, table: 'flows' },
  marketplace: { label: 'Marketplace', short: 'Market', Icon: ShoppingBag },
  settings: { label: 'Account & workspace', Icon: Settings },
  profiles: { label: 'Profiles', Icon: User },
  knowledge_vault: { label: 'Knowledge vault', Icon: BookOpen },
  data_sources: { label: 'Data sources', Icon: Database },
  integrations: { label: 'Integrations', Icon: Link },
  history: { label: 'Run history', Icon: History, table: 'run_history' },
  overview: { label: 'Overview', Icon: CircleDot },
  analytics: { label: 'Analytics', Icon: BarChart3 },
  alerts: { label: 'Alerts', Icon: Bell },
  reports: { label: 'Usage & billing', Icon: ChartColumn },
})
export const entityForView = view => ENTITIES[view === 'flows' ? 'workflows' : view]
const item = view => { const e = entityForView(view); return { view, label: e.label, icon: e.Icon } }
export const BUSINESS_NAV = [
  { label: 'WORKSPACE', alwaysOpen: true, items: ['marketplace', 'apps', 'flows'].map(item) },
  { label: 'SETTINGS & TOOLS', items: ['settings', 'profiles', 'knowledge_vault', 'data_sources', 'integrations', 'history', 'overview', 'analytics', 'alerts', 'reports'].map(item) },
]
