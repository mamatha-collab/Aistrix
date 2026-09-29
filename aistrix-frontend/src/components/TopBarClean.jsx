import { useState, useRef, useEffect } from 'react'
import { Box, Clock, KeyRound, LayoutGrid, Menu, Search, Sparkles, Workflow, X } from 'lucide-react'
import NotificationsPanel from './NotificationsPanel'

const VIEW_META = {
  apps:        { title: 'AI Apps',        subtitle: 'Build and run AI-powered apps', icon: LayoutGrid, label: 'AI APPS', buildView: true },
  flows:       { title: 'AI Workflows',   subtitle: 'Ready-to-run workflows - install and run in seconds', icon: Workflow, label: 'AI WORKFLOWS', buildView: true },
  overview:    { title: 'Overview',        subtitle: 'Aistrix designs, runs, and improves AI workflows from your business goal.' },
  analytics:   { title: 'Analytics',       subtitle: 'Usage trends and performance' },
  reports:     { title: 'Reports',         subtitle: 'Scheduled and on-demand reports' },
  events:      { title: 'Events',          subtitle: 'Scheduled and triggered runs' },
  goals:       { title: 'Goals',           subtitle: 'Track progress toward targets' },
  alerts:      { title: 'Alerts',          subtitle: 'Notifications and thresholds' },
  profiles:    { title: 'Profiles',        subtitle: 'User and team profiles' },
  integrations:{ title: 'Integrations',    subtitle: 'Connect external services' },
  settings:    { title: 'Settings',        subtitle: 'Account and preferences' },
  developer:   { title: 'Developer',       subtitle: 'API keys and developer tools' },
  data_sources:{ title: 'Data Sources',    subtitle: 'Manage your data connections' },
  admin:       { title: 'Admin',           subtitle: 'Platform administration' },
  moderator:   { title: 'Moderator',       subtitle: 'Content moderation tools' },
  marketplace: { title: 'Marketplace',     subtitle: 'Discover AI apps built on Aistrix' },
}

export default function TopBarClean({ onShowHistory, onShowSettings, onToggleSidebar, onShowCreate, onShowWorkspace, search, onSearch, searchRef, user, onNavChange, activeView }) {
  const [buildOpen, setBuildOpen] = useState(false)
  const buildRef = useRef(null)

  useEffect(() => {
    if (!buildOpen) return
    const handler = e => { if (!buildRef.current?.contains(e.target)) setBuildOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [buildOpen])

  const meta = VIEW_META[activeView] || VIEW_META.apps
  const HeaderIcon = meta.icon || Sparkles

  return (
    <header className="app-topbar relative min-h-[72px] bg-[#121829] border-b border-white/18 flex items-center px-3 sm:px-4 md:px-6 py-3 gap-3 shrink-0">
      <button
        onClick={onToggleSidebar}
        className="md:hidden text-slate-400 hover:text-white shrink-0 w-9 h-9 flex items-center justify-center -ml-1"
        aria-label="Toggle menu"
      >
        <Menu size={20} strokeWidth={2} />
      </button>

      <div className="header-title flex-1 min-w-0 hidden sm:flex items-center gap-3">
        <div className="header-title-icon w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
          <HeaderIcon size={22} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={meta.buildView ? 'header-build-title' : 'header-kicker hidden lg:inline-flex'}>{meta.label || 'Aistrix'}</span>
            {!meta.buildView && <h1 className="header-title-text truncate">{meta.title}</h1>}
          </div>
          <p className="text-xs text-slate-300 truncate mt-0.5">{meta.subtitle}</p>
        </div>
      </div>

      <div className="header-actions flex items-center justify-end gap-2 flex-1 sm:flex-none min-w-0">
        <div className="app-field flex items-center gap-2 bg-[#1A2038] border border-white/18 rounded-lg px-2.5 sm:px-3 h-9 text-sm text-slate-300 min-w-0 w-full sm:w-48 lg:w-56 transition-colors">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search apps, workflows, history…"
            aria-label="Global search"
            ref={searchRef}
            className="flex-1 min-w-0 w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          {search && (
            <button onClick={() => onSearch('')} aria-label="Clear search" className="text-slate-400 hover:text-white shrink-0">
              <X size={14} />
            </button>
          )}
        </div>

        {user && <NotificationsPanel user={user} onNavChange={onNavChange} />}
        <button
          onClick={onShowHistory}
          aria-label="Run history"
          className="app-chrome-button flex items-center justify-center gap-1 bg-[#1A2038] hover:bg-[#222840] text-slate-200 text-sm h-9 w-9 md:w-[86px] rounded-lg border border-transparent transition-colors shrink-0"
        >
          <Clock size={15} /> <span className="hidden md:inline">History</span>
        </button>
        <button
          onClick={onShowSettings}
          aria-label="API key settings"
          className="app-chrome-button flex items-center justify-center gap-1 bg-[#1A2038] hover:bg-[#222840] text-slate-200 text-sm h-9 w-9 md:w-[70px] rounded-lg border border-transparent transition-colors shrink-0"
        >
          <KeyRound size={15} /> <span className="hidden md:inline">Keys</span>
        </button>
        {activeView === 'apps' || activeView === 'flows' ? (
          <button
            onClick={activeView === 'apps'
              ? onShowCreate
              : () => window.dispatchEvent(new CustomEvent('aistrix:new-workflow'))}
            className="header-build-button flex items-center justify-center gap-1.5 text-sm font-semibold h-9 w-11 md:w-40 rounded-lg transition-all shrink-0"
          >
            <Sparkles size={16} /> <span className="hidden md:inline">{activeView === 'apps' ? 'Build AI App' : 'Build AI Workflow'}</span>
          </button>
        ) : (
          <div ref={buildRef} className="relative shrink-0">
            <button
              onClick={() => setBuildOpen(v => !v)}
              aria-label="Aistrix BUILD - open build menu"
              aria-haspopup="true"
              aria-expanded={buildOpen}
              className="flex items-center gap-1.5 text-white text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#6C5CE7] bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 transition-all"
            >
              <Sparkles size={14} /> <span className="hidden md:inline">Aistrix <span className="font-bold tracking-widest uppercase">BUILD</span></span>
            </button>
            {buildOpen && (
              <div className="app-build-menu absolute right-0 top-full mt-2 w-52 bg-[#1A2038] border border-white/20 rounded-xl shadow-xl overflow-hidden z-50">
                <button
                  onClick={() => { setBuildOpen(false); onShowCreate() }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors group"
                >
                  <span className="w-8 h-8 rounded-lg bg-[#A29BFE]/15 flex items-center justify-center shrink-0">
                    <Box size={16} className="text-[#A29BFE]" />
                  </span>
                  <div>
                    <p className="text-white text-sm font-semibold leading-tight">AI App</p>
                    <p className="text-slate-300 text-[10px]">Build a standalone app</p>
                  </div>
                </button>
                <div className="border-t border-white/10" />
                <button
                  onClick={() => { setBuildOpen(false); onShowWorkspace?.() }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors group"
                >
                  <span className="w-8 h-8 rounded-lg bg-[#6C5CE7]/15 flex items-center justify-center shrink-0">
                    <Workflow size={16} className="text-[#A29BFE]" />
                  </span>
                  <div>
                    <p className="text-white text-sm font-semibold leading-tight">AI Workflow</p>
                    <p className="text-slate-300 text-[10px]">Chain apps into a workflow</p>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
