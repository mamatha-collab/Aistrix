import AistrixWordmark from './AistrixWordmark'
import { DeveloperRowSection, DeveloperSidebarBrand, DeveloperSidebarSlot, useDeveloperSidebar, useShellFramed } from './DeveloperShell'
import BusinessPane from './BusinessPane'
import { useState, useEffect } from 'react'
import {
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  CodeXml,
  Box,
  ChartColumn,
  ChevronDown,
  CircleDot,
  Database,
  History,
  Link,
  Settings,
  Shield,
  ShoppingBag,
  User,
  Workflow,
  X,
  Zap,
} from 'lucide-react'

import { BRAND } from '../lib/brand'

const DEVELOPER_NAV = []

const BUSINESS_NAV = [
  { label: 'WORKSPACE', alwaysOpen: true, items: [
    { icon: ShoppingBag, label: 'Marketplace', view: 'marketplace' },
    { icon: Box,          label: 'My apps',         view: 'apps' },
    { icon: Workflow,     label: 'Workflows',    view: 'flows' },
  ]},
  { label: 'SETTINGS & TOOLS', items: [
    { icon: Settings, label: 'Account & workspace', view: 'settings' },
    { icon: BookOpen, label: 'Knowledge Vault', view: 'knowledge_vault' },
    { icon: CircleDot, label: 'Overview',  view: 'overview' },
    { icon: History,   label: 'History',   view: 'history' },
    { icon: BarChart3, label: 'Analytics', view: 'analytics' },
    { icon: Bell,      label: 'Alerts',    view: 'alerts' },
    { icon: Database, label: 'Data Sources', view: 'data_sources' },
    { icon: Link,     label: 'Integrations', view: 'integrations' },
    { icon: User,        label: 'Profiles', view: 'profiles' },
    { icon: ChartColumn, label: 'Usage',    view: 'reports' },
  ]},
]

export default function SidebarClean({ user, userRole, onClose, activeView, onNavChange, mode, onModeChange, onSelectApp, onOpenFlow, paneRefreshKey }) {

  const navGroups = mode === 'developer' ? DEVELOPER_NAV : BUSINESS_NAV
  const isDeveloperMode = mode === 'developer'
  const { collapsed: railCollapsed } = useDeveloperSidebar()
  // Desktop: Developer and Business share one frame (top row, second row,
  // left pane). Phones keep Business's own drawer with its section list.
  const framed = useShellFramed()
  const rail = framed && railCollapsed

  const [expanded, setExpanded] = useState(() => {
    const active = new Set()
    for (const group of navGroups) {
      if (!group.alwaysOpen && group.items.some(item => item.view === activeView)) active.add(group.label)
    }
    return active
  })

  function toggleSection(label) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  useEffect(() => {
    for (const group of navGroups) {
      if (!group.alwaysOpen && group.items.some(item => item.view === activeView)) {
        setExpanded(prev => { const next = new Set(prev); next.add(group.label); return next })
      }
    }
  }, [activeView, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const roleNavigation = (userRole === 'admin' || userRole === 'moderator') && (
        <div className={`${rail ? 'px-1.5' : 'px-3'} pb-2 space-y-0.5`}>
          <div className="h-px bg-white/5 mx-2 mb-2" />
          {userRole === 'admin' && (
            <button onClick={() => onNavChange?.('admin')} title={rail ? 'Admin' : undefined} aria-label={rail ? 'Admin' : undefined}
              className={`w-full flex items-center ${rail ? 'justify-center' : ''} gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeView === 'admin' ? 'bg-red-500/20 text-red-400' : 'text-slate-300 hover:bg-[#1A2038] hover:text-red-400'}`}>
              <Zap size={16} className="shrink-0" />{!rail && <><span>Admin</span>
              <span className="ml-auto text-[9px] bg-red-400/15 text-red-400 px-1.5 py-0.5 rounded-full font-bold">ADMIN</span></>}
            </button>
          )}
          <button onClick={() => onNavChange?.('moderator')} title={rail ? 'Moderator' : undefined} aria-label={rail ? 'Moderator' : undefined}
            className={`w-full flex items-center ${rail ? 'justify-center' : ''} gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeView === 'moderator' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-300 hover:bg-[#1A2038] hover:text-blue-400'}`}>
            <Shield size={16} className="shrink-0" />{!rail && <span>Moderator</span>}
          </button>
        </div>
      )

  return (
    <aside className={`app-sidebar ${framed || isDeveloperMode ? `app-sidebar-developer ${rail ? 'w-14' : 'w-56'}` : 'app-sidebar-business w-56'} bg-[#0E1424] flex flex-col shrink-0 h-full relative`}>
      {(framed || isDeveloperMode) && <div aria-hidden="true" className={`pointer-events-none absolute right-0 ${framed ? 'top-0' : 'top-[72px]'} bottom-0 border-r border-white/5`} />}
      {onClose && (
        <button aria-label="Close" onClick={onClose}
          className="md:hidden absolute top-4 right-4 text-slate-300 hover:text-white z-10">
          <X size={16} />
        </button>
      )}

      {!isDeveloperMode && !framed && (
        <button
          onClick={() => onNavChange?.('marketplace')}
          className="business-sidebar-brand flex items-center gap-1 hover:opacity-80 transition-opacity w-full text-left"
        >
          <div className="flex items-center gap-1">
            <img src="/aistrix-logo.svg" alt="" className="w-7 h-7 shrink-0" />
            <span className="font-semibold text-white text-base"><AistrixWordmark /></span>
          </div>
          <span className="business-mode-badge">Business</span>
        </button>
      )}

      {/* Mode switcher */}
      <DeveloperSidebarBrand>
      <div className={isDeveloperMode
        ? `h-[72px] shrink-0 ${rail ? 'px-3.5' : 'px-4'} flex items-center border-b border-white/5 bg-[#111827]`
        : 'business-mode-switch'}>
        {isDeveloperMode ? (
        <button
          onClick={() => onNavChange?.('developer')}
          className="flex items-center gap-1 min-w-0 w-full text-left hover:opacity-85 transition-opacity"
        >
          <img src="/aistrix-logo.svg" alt={rail ? BRAND : ''} className="w-7 h-7 shrink-0" />
          {!rail && <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
              <span className="text-white font-bold text-lg leading-tight shrink-0"><AistrixWordmark /></span>
              <span className="px-1.5 py-0.5 rounded-full bg-[#00D4AA]/10 border border-[#00D4AA]/20 text-[#00D4AA] text-[8px] font-bold uppercase tracking-wide shrink-0">Developer</span>
            </span>
          </span>}
        </button>
        ) : (
        <div className="flex bg-[#09101F] rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => onModeChange?.('business')}
            className={`flex-1 text-xs font-semibold py-2 rounded-md transition-all ${mode === 'business' ? 'bg-[#1A2038] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Business
          </button>
          <button
            onClick={() => onModeChange?.('developer')}
            className={`flex-1 text-xs font-semibold py-2 rounded-md transition-all ${mode === 'developer' ? 'bg-[#6C5CE7] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Developer
          </button>
        </div>
        )}
      </div>

      </DeveloperSidebarBrand>

      {!isDeveloperMode && !framed && roleNavigation}

      {(isDeveloperMode || framed) && (
        <DeveloperRowSection side="left">
        <div className="w-full py-3 flex items-center bg-[#1A2038]">
          <div className={`flex ${rail ? 'flex-col' : ''} w-full bg-[#0E1424] border border-white/10 rounded-lg p-1 gap-1`}>
            {['business', 'developer'].map(next => {
              const name = next === 'business' ? 'Business' : 'Developer'
              const Icon = next === 'business' ? Briefcase : CodeXml
              return (
                <button key={next} onClick={() => onModeChange?.(next)} aria-pressed={mode === next}
                  title={rail ? name : undefined} aria-label={rail ? name : undefined}
                  className={`flex-1 flex items-center justify-center text-xs py-2 rounded-md transition-colors ${mode === next ? 'bg-[#6C5CE7]/25 text-white font-semibold' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}`}>
                  {rail ? <Icon size={14} aria-hidden="true" /> : name}
                </button>
              )
            })}
          </div>
        </div>
        </DeveloperRowSection>
      )}
      <nav className={`flex-1 ${rail ? 'px-1.5' : 'px-3'} overflow-y-auto pb-2 ${isDeveloperMode ? 'pt-0' : 'pt-1'}`}>
        {isDeveloperMode && <DeveloperSidebarSlot />}
        {framed && !isDeveloperMode && (
          <BusinessPane activeView={activeView} onNavChange={onNavChange} />
        )}
        {!framed && navGroups.map(({ label, items, alwaysOpen }) => {
          const isOpen = alwaysOpen || expanded.has(label)
          const hasActive = items.some(item => item.view === activeView)

          return (
            <div key={label} className="mb-1">
              {alwaysOpen ? (
                <p className="text-[9px] font-bold tracking-widest text-slate-500 px-3 pt-2 pb-1">{label}</p>
              ) : (
                <button
                  onClick={() => toggleSection(label)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-white/4 group"
                >
                  <p className="text-[9px] font-bold tracking-widest text-slate-500 group-hover:text-slate-400 transition-colors flex-1 text-left">{label}</p>
                  {hasActive && !isOpen && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] shrink-0" />
                  )}
                  <ChevronDown size={12} className={`text-slate-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
              )}

              {isOpen && (
                <div className="space-y-0.5">
                  {items.map(({ icon: Icon, label: itemLabel, view }) => {
                    const isActive = activeView === view
                    return (
                      <button key={`${view}-${itemLabel}`}
                        onClick={() => onNavChange?.(view)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                          ${isActive ? 'nav-item-active bg-[#6C5CE7] text-white' : 'text-slate-300 hover:bg-[#1A2038] hover:text-white'}`}>
                        <Icon size={16} className="shrink-0" />
                        <span className="flex-1 text-left">{itemLabel}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {(isDeveloperMode || framed) && roleNavigation}
    </aside>
  )
}
