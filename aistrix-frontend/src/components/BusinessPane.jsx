import { useState } from 'react'
import { BarChart3, Bell, BookOpen, Box, ChartColumn, ChevronDown, CircleDot, Database, History, Link, PanelLeftClose, PanelLeftOpen, Settings, ShoppingBag, User, Workflow } from 'lucide-react'
import { useDeveloperSidebar } from './DeveloperShell'

const BUSINESS_PRIMARY = [
  ['marketplace', 'Market', ShoppingBag], ['apps', 'My apps', Box], ['flows', 'Workflows', Workflow],
]
const BUSINESS_SETTINGS = [
  ['settings', 'Account & workspace', Settings], ['profiles', 'Profiles', User],
  ['knowledge_vault', 'Knowledge vault', BookOpen], ['data_sources', 'Data sources', Database],
  ['integrations', 'Integrations', Link], ['history', 'Run history', History],
  ['overview', 'Overview', CircleDot], ['analytics', 'Analytics', BarChart3],
  ['alerts', 'Alerts', Bell], ['reports', 'Usage & billing', ChartColumn],
]

export default function BusinessPane({ activeView, onNavChange }) {
  const { collapsed, setCollapsed } = useDeveloperSidebar()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsActive = BUSINESS_SETTINGS.some(([view]) => view === activeView)
  const expanded = settingsOpen || settingsActive
  return <div className={`market-navigation ${collapsed ? 'is-collapsed' : ''}`}>
    <div className="market-navigation-heading">
      {!collapsed && <span>WORKSPACE</span>}
      <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand the side panel' : 'Collapse the side panel'} title={collapsed ? 'Expand the side panel' : 'Collapse the side panel'}>
        {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
    </div>
    <nav aria-label="Business sections" className="space-y-1">
      {BUSINESS_PRIMARY.map(([view, label, Icon]) => <button key={view} onClick={() => onNavChange?.(view)} aria-label={label} title={collapsed ? label : undefined} aria-current={activeView === view ? 'page' : undefined} className="market-navigation-item">
        <Icon size={18} />{!collapsed && <span>{label}</span>}
      </button>)}
    </nav>
    <div className="market-navigation-settings">
      <button onClick={() => collapsed ? onNavChange?.('settings') : setSettingsOpen(!expanded)} className="market-navigation-item" aria-label="Workspace settings" aria-expanded={collapsed ? undefined : expanded} title={collapsed ? 'Settings' : undefined}>
        <Settings size={17} />{!collapsed && <><span>Settings & tools</span><ChevronDown size={13} className={expanded ? 'rotate-180' : ''} /></>}
      </button>
      {!collapsed && expanded && <nav aria-label="Settings and tools" className="market-settings-list">
        {BUSINESS_SETTINGS.map(([view, label, Icon]) => <button key={view} onClick={() => onNavChange?.(view)} aria-current={activeView === view ? 'page' : undefined}>
          <Icon size={14} /><span>{label}</span>
        </button>)}
      </nav>}
    </div>
  </div>
}
