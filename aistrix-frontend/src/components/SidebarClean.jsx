import AistrixWordmark from './AistrixWordmark'
import { signOutOnPurpose } from '../lib/session'
import { useState, useEffect } from 'react'
import ConfirmDialog from './ConfirmDialog'
import {
  BarChart3,
  Bell,
  BookOpen,
  Box,
  ChartColumn,
  ChevronDown,
  CircleDot,
  Database,
  History,
  Link,
  LogOut,
  Moon,
  Settings,
  Shield,
  ShoppingBag,
  Sun,
  User,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import { supabase } from '../supabase'
import { applyTheme } from '../utils/theme'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const DEVELOPER_NAV = []

const BUSINESS_NAV = [
  { label: 'BUILD', alwaysOpen: true, items: [
    { icon: Workflow,     label: 'AI Workflows',    view: 'flows' },
    { icon: Box,          label: 'AI Apps',         view: 'apps' },
    { icon: ShoppingBag,  label: 'Marketplace',     view: 'marketplace' },
    { icon: BookOpen,     label: 'Knowledge Vault', view: 'knowledge_vault' },
  ]},
  { label: 'OPERATE', items: [
    { icon: CircleDot, label: 'Overview',  view: 'overview' },
    { icon: History,   label: 'History',   view: 'history' },
    { icon: BarChart3, label: 'Analytics', view: 'analytics' },
    { icon: Bell,      label: 'Alerts',    view: 'alerts' },
  ]},
  { label: 'CONNECT', items: [
    { icon: Database, label: 'Data Sources', view: 'data_sources' },
    { icon: Link,     label: 'Integrations', view: 'integrations' },
  ]},
  { label: 'MANAGE', items: [
    { icon: User,        label: 'Profiles', view: 'profiles' },
    { icon: Settings,    label: 'Settings', view: 'settings' },
    { icon: ChartColumn, label: 'Usage',    view: 'reports' },
  ]},
]

export default function SidebarClean({ user, userRole, onClose, onShowProfile, activeView, onNavChange, mode, onModeChange }) {
  const [usage, setUsage] = useState({ today: 0, limit: 50 })
  const [theme, setTheme] = useState(() => localStorage.getItem('aistrix_theme') || 'dark')

  const navGroups = mode === 'developer' ? DEVELOPER_NAV : BUSINESS_NAV
  const isDeveloperMode = mode === 'developer'

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

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.add('theme-transitioning')
    setTheme(next)
    localStorage.setItem('aistrix_theme', next)
    applyTheme(next)
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350)
  }

  // Today's runs against the free allowance, as the server counts them (runs
  // on the user's own AI keys don't use it up).
  useEffect(() => {
    if (!user) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return
      return fetch(`${API_URL}/v1/usage`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(u => { if (u?.daily) setUsage({ today: u.daily.used, limit: u.daily.limit }) })
    }).catch(() => {})
  }, [user])

  // Signing out drops unsaved edits in any open editor: ask first.
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  async function signOut() { await signOutOnPurpose(supabase) }

  return (
    <aside className={`app-sidebar ${isDeveloperMode ? 'w-60 !border-r-0' : 'w-52'} bg-[#0E1424] flex flex-col shrink-0 h-full relative`}>
      {isDeveloperMode && <div aria-hidden="true" className="pointer-events-none absolute right-0 top-[72px] bottom-0 border-r border-white/5" />}
      {onClose && (
        <button aria-label="Close" onClick={onClose}
          className="md:hidden absolute top-4 right-4 text-slate-300 hover:text-white z-10">
          <X size={16} />
        </button>
      )}

      {!isDeveloperMode && (
        <button
          onClick={() => onNavChange?.('flows')}
          className="px-5 pt-5 pb-3 flex flex-col gap-0.5 hover:opacity-80 transition-opacity w-full text-left"
        >
          <div className="flex items-center gap-1">
            <img src="/aistrix-logo.svg" alt="" className="w-7 h-7 shrink-0" />
            <span className="font-semibold text-white text-base"><AistrixWordmark /></span>
          </div>
          <p className="text-[10px] text-slate-500 pl-8 leading-tight">
            AI workflows for your business
          </p>
        </button>
      )}

      {/* Mode switcher */}
      <div className={isDeveloperMode
        ? 'h-[72px] px-4 flex items-center border-b border-white/5 bg-[#111827]'
        : 'px-3 pb-3'}>
        {isDeveloperMode ? (
        <button
          onClick={() => onNavChange?.('developer')}
          className="flex items-center gap-1 min-w-0 w-full text-left hover:opacity-85 transition-opacity"
        >
          <img src="/aistrix-logo.svg" alt="" className="w-7 h-7 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
              <span className="text-white font-bold text-lg leading-tight shrink-0"><AistrixWordmark /></span>
              <span className="px-1.5 py-0.5 rounded-full bg-[#00D4AA]/10 border border-[#00D4AA]/20 text-[#00D4AA] text-[8px] font-bold uppercase tracking-wide shrink-0">Developer</span>
            </span>
          </span>
        </button>
        ) : (
        <div className="flex bg-[#09101F] rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => onModeChange?.('business')}
            className={`flex-1 text-[10px] font-semibold py-1.5 rounded-md transition-all ${mode === 'business' ? 'bg-[#1A2038] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Business
          </button>
          <button
            onClick={() => onModeChange?.('developer')}
            className={`flex-1 text-[10px] font-semibold py-1.5 rounded-md transition-all ${mode === 'developer' ? 'bg-[#6C5CE7] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Developer
          </button>
        </div>
        )}
      </div>

      {(userRole === 'admin' || userRole === 'moderator') && (
        <div className="px-3 pb-2 space-y-0.5">
          <div className="h-px bg-white/5 mx-2 mb-2" />
          {userRole === 'admin' && (
            <button onClick={() => onNavChange?.('admin')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeView === 'admin' ? 'bg-red-500/20 text-red-400' : 'text-slate-300 hover:bg-[#1A2038] hover:text-red-400'}`}>
              <Zap size={16} /><span>Admin</span>
              <span className="ml-auto text-[9px] bg-red-400/15 text-red-400 px-1.5 py-0.5 rounded-full font-bold">ADMIN</span>
            </button>
          )}
          <button onClick={() => onNavChange?.('moderator')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeView === 'moderator' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-300 hover:bg-[#1A2038] hover:text-blue-400'}`}>
            <Shield size={16} /><span>Moderator</span>
          </button>
        </div>
      )}

      <nav className={`flex-1 px-3 overflow-y-auto pb-2 ${isDeveloperMode ? 'pt-3' : 'pt-1'}`}>
        {isDeveloperMode && (
          <div className="flex bg-[#09101F] rounded-lg p-0.5 gap-0.5">
            {['business', 'developer'].map(next => (
              <button key={next} onClick={() => onModeChange?.(next)}
                className={`flex-1 text-[10px] font-semibold py-1.5 rounded-md transition-all ${mode === next ? 'bg-[#6C5CE7] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
                {next === 'business' ? 'Business' : 'Developer'}
              </button>
            ))}
          </div>
        )}
        {navGroups.map(({ label, items, alwaysOpen }) => {
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

      <div className="px-4 pb-4 border-t border-white/8 pt-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-[#09101F] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${usage.today / usage.limit > 0.8 ? 'bg-orange-500' : 'bg-[#6C5CE7]'}`}
              style={{ width: `${Math.min((usage.today / usage.limit) * 100, 100)}%` }}
            />
          </div>
          <span className={`text-[10px] shrink-0 ${usage.today >= usage.limit ? 'text-orange-400' : 'text-slate-500'}`}>
            {usage.today}/{usage.limit} runs
          </span>
        </div>

        {!isDeveloperMode ? (
        <div className="flex items-center gap-2">
          <button onClick={onShowProfile}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs text-white shrink-0 hover:opacity-80 transition-opacity"
            style={{ background: user?.user_metadata?.avatar_color || '#6C5CE7' }}
            title="Edit profile" aria-label="Edit profile">
            {(user?.user_metadata?.display_name || user?.email || '?')[0].toUpperCase()}
          </button>
          <p className="text-xs text-white truncate flex-1 min-w-0">
            {user?.user_metadata?.display_name || user?.email?.split('@')[0]}
          </p>
          <button onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="text-slate-500 hover:text-white transition-colors p-1">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={() => setConfirmSignOut(true)} title="Sign out" aria-label="Sign out"
            className="text-slate-500 hover:text-red-400 transition-colors p-1">
            <LogOut size={14} />
          </button>
        </div>
        ) : null}
      </div>
      {confirmSignOut && (
        <ConfirmDialog title="Sign out of Aistrix?" subtitle={user?.email}
          confirmLabel="Sign out" busyLabel="Signing out…" danger
          onCancel={() => setConfirmSignOut(false)} onConfirm={signOut}>
          Any unsaved changes in open editors (Design, Prompt Studio, tests) will be lost. Runs and saved work are kept.
        </ConfirmDialog>
      )}
    </aside>
  )
}
