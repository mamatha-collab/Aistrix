import { useState } from 'react'
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { BUSINESS_NAV, ENTITIES } from '../lib/entities'
const Settings = ENTITIES.settings.Icon
import { useDeveloperSidebar } from './DeveloperShell'

const BUSINESS_PRIMARY = BUSINESS_NAV[0].items
const BUSINESS_SETTINGS = BUSINESS_NAV[1].items

export default function BusinessPane({ activeView, onNavChange }) {
  const { collapsed, setCollapsed } = useDeveloperSidebar()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsActive = BUSINESS_SETTINGS.some(({ view }) => view === activeView)
  const expanded = settingsOpen || settingsActive
  return <div className={`market-navigation ${collapsed ? 'is-collapsed' : ''}`}>
    <div className="market-navigation-heading">
      {!collapsed && <span>WORKSPACE</span>}
      <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand the side panel' : 'Collapse the side panel'} title={collapsed ? 'Expand the side panel' : 'Collapse the side panel'}>
        {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
    </div>
    <nav aria-label="Business sections" className="space-y-1">
      {BUSINESS_PRIMARY.map(({ view, label, icon: Icon }) => <button key={view} onClick={() => onNavChange?.(view)} aria-label={label} title={collapsed ? label : undefined} aria-current={activeView === view ? 'page' : undefined} className="market-navigation-item">
        <Icon size={18} />{!collapsed && <span>{label}</span>}
      </button>)}
    </nav>
    <div className="market-navigation-settings">
      <button onClick={() => collapsed ? onNavChange?.('settings') : setSettingsOpen(!expanded)} className="market-navigation-item" aria-label="Workspace settings" aria-expanded={collapsed ? undefined : expanded} title={collapsed ? 'Settings' : undefined}>
        <Settings size={17} />{!collapsed && <><span>Settings & tools</span><ChevronDown size={13} className={expanded ? 'rotate-180' : ''} /></>}
      </button>
      {!collapsed && expanded && <nav aria-label="Settings and tools" className="market-settings-list">
        {BUSINESS_SETTINGS.map(({ view, label, icon: Icon }) => <button key={view} onClick={() => onNavChange?.(view)} aria-current={activeView === view ? 'page' : undefined}>
          <Icon size={14} /><span>{label}</span>
        </button>)}
      </nav>}
    </div>
  </div>
}
