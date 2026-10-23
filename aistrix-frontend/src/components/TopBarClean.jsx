import { useState, useRef, useEffect } from 'react'
import { CirclePlay, KeyRound, LogOut, Menu, Moon, Search, Settings, Sun, X } from 'lucide-react'
import NotificationsPanel from './NotificationsPanel'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import ConfirmDialog from './ConfirmDialog'
import SafeCard from './SafeCard'
import { DeveloperRowSection, useShellFramed } from './DeveloperShell'
import { applyTheme } from '../utils/theme'
import { signOutOnPurpose } from '../lib/session'
import { supabase } from '../supabase'
import '../marketplace.css'

const TITLES = { apps:'Apps', flows:'Workflows', marketplace:'Marketplace', overview:'Overview', history:'Run history', analytics:'Analytics', reports:'Usage & reports', events:'Schedules', goals:'Goals', alerts:'Alerts', profiles:'Profiles', integrations:'Integrations', settings:'Settings', data_sources:'Data sources', knowledge_vault:'Knowledge vault', admin:'Administration', moderator:'Moderation' }

export default function TopBarClean({ onShowHistory, onShowSettings, onToggleSidebar, search='', onSearch, searchRef, user, onNavChange, activeView, marketDetail = false,
  workspaces=[], activeWorkspace, onSwitchWorkspace, onCreateWorkspace, onManageWorkspace }) {
  const framed = useShellFramed()
  const [accountOpen,setAccountOpen]=useState(false)
  const [confirmSignOut,setConfirmSignOut]=useState(false)
  const accountRef=useRef(null)
  useEffect(()=>{
    const outside=event=>{if(!accountRef.current?.contains(event.target))setAccountOpen(false)}
    const escape=event=>{if(event.key==='Escape')setAccountOpen(false)}
    document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[])
  function navigate(view){setAccountOpen(false);onNavChange?.(view)}
  function toggleTheme(){const next=document.documentElement.dataset.theme==='light'?'dark':'light';localStorage.setItem('aistrix_theme',next);applyTheme(next);setAccountOpen(false)}
  const searchable=['apps','flows'].includes(activeView)
  const initial=(user?.user_metadata?.display_name||user?.email||'?')[0].toUpperCase()
  const signOutDialog=confirmSignOut&&<ConfirmDialog title="Sign out?" subtitle={user?.email} confirmLabel="Sign out" danger onCancel={()=>setConfirmSignOut(false)} onConfirm={()=>signOutOnPurpose(supabase)}>Finish or save any work before signing out.</ConfirmDialog>

  // Desktop: the same frame as Developer (top row, second row, left pane).
  if (framed) {
    const menuItem='w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors'
    return <>
      <div className="sticky top-0 z-30 pointer-events-none">
        <DeveloperRowSection side="header">
          <div className="pointer-events-auto hidden md:flex h-[71px] items-center justify-end gap-4">
            <span className="mr-auto text-sm font-semibold text-white">{activeView === 'marketplace' ? 'Market' : TITLES[activeView] || 'Workspace'}</span>
            <div className="flex items-center gap-1">
              {user&&<SafeCard name="Notifications" quiet><NotificationsPanel user={user} onNavChange={onNavChange}/></SafeCard>}
            </div>
            <div ref={accountRef} className="relative shrink-0">
              <button onClick={()=>setAccountOpen(v=>!v)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={accountOpen}
                className="w-9 h-9 rounded-full bg-[#6C5CE7]/15 text-[#A29BFE] text-sm font-semibold flex items-center justify-center hover:bg-[#6C5CE7]/25 transition-colors"
                style={{ background: user?.user_metadata?.avatar_color || undefined }}>{initial}</button>
              {accountOpen&&(
                <div role="menu" className="absolute right-0 top-full mt-2 w-56 rounded-2xl bg-[#111827] border border-white/10 shadow-2xl z-50">
                  <div className="px-3 py-3 border-b border-white/5">
                    <p className="text-white text-sm font-semibold truncate">{user?.user_metadata?.display_name||user?.email?.split('@')[0]||'Account'}</p>
                    <p className="text-slate-500 text-[11px] truncate">{user?.email}</p>
                  </div>
                  <button role="menuitem" className={menuItem} onClick={()=>navigate('settings')}><Settings size={15}/>Account settings</button>
                  <button role="menuitem" className={menuItem} onClick={()=>navigate('profiles')}>Profiles</button>
                  <button role="menuitem" className={menuItem} onClick={()=>{setAccountOpen(false);onShowSettings?.()}}><KeyRound size={15}/>Personal AI keys</button>
                  <button role="menuitem" className={menuItem} onClick={toggleTheme}><Sun size={15}/>Change theme</button>
                  <div className="px-3 py-2 border-t border-white/5"><WorkspaceSwitcher workspaces={workspaces} active={activeWorkspace} onSwitch={onSwitchWorkspace} onCreate={onCreateWorkspace} onManage={onManageWorkspace}/></div>
                  <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/10 hover:text-red-200 transition-colors" onClick={()=>{setAccountOpen(false);setConfirmSignOut(true)}}><LogOut size={15}/>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </DeveloperRowSection>
        <DeveloperRowSection side="content">
          {(activeView !== 'marketplace' || marketDetail) && <div className="market-context-toolbar">
            {marketDetail ? <button onClick={()=>onNavChange?.('marketplace')} className="text-sm text-violet-300">← Back to Market</button> : searchable ? <div className="market-search-field"><Search size={16} aria-hidden="true" />
              <input type="search" value={search} onChange={event=>onSearch?.(event.target.value)} ref={searchRef} aria-label={activeView==='flows'?'Search workflows':'Search apps'} placeholder={activeView==='flows'?'Search workflows…':'Search your apps…'} />
              {search && <button onClick={()=>onSearch?.('')} aria-label="Clear search"><X size={14}/></button>}
            </div> : <span className="text-sm text-slate-300">{TITLES[activeView] || 'Workspace'}</span>}
          </div>}
        </DeveloperRowSection>
      </div>
      {signOutDialog}
    </>
  }

  return <header className="business-topbar shrink-0" aria-label="Business header">
    <div className="business-header-main">
      <button onClick={onToggleSidebar} className="business-icon-button md:hidden" aria-label="Toggle menu"><Menu size={20}/></button>
      <span className={`business-page-context ${activeView==='marketplace'?'':'hidden sm:block'}`}>{activeView==='marketplace'?'Market':TITLES[activeView]||'Workspace'}</span>
      {searchable && <div className="business-search"><Search size={16} aria-hidden="true"/><input type="search" value={search} onChange={event=>onSearch?.(event.target.value)} ref={searchRef} aria-label={activeView==='flows'?'Search workflows':'Search apps'} placeholder={activeView==='flows'?'Search your workflows…':'Find an app for your next task…'}/>{search&&<button onClick={()=>onSearch?.('')} aria-label="Clear search"><X size={15}/></button>}</div>}
      <div className="business-header-actions">
        <button onClick={onShowHistory} className="business-header-action" aria-label="Run history"><CirclePlay size={17}/><span className="hidden lg:inline">Runs</span></button>
        {user&&<SafeCard name="Notifications" quiet><NotificationsPanel user={user} onNavChange={onNavChange}/></SafeCard>}
        <div ref={accountRef} className="relative">
          <button className="business-avatar" aria-label="Account menu" aria-expanded={accountOpen} aria-haspopup="menu" onClick={()=>setAccountOpen(value=>!value)}>{initial}</button>
          {accountOpen&&<div role="menu" className="business-account-menu">
            <p className="truncate px-3 py-3 text-xs text-slate-400 border-b border-white/10">{user?.email}</p>
            <button role="menuitem" onClick={()=>navigate('settings')}><Settings size={16}/>Account settings</button>
            <button role="menuitem" onClick={()=>navigate('profiles')}>Profiles</button>
            <button role="menuitem" onClick={()=>{setAccountOpen(false);onShowSettings?.()}}><KeyRound size={16}/>Personal AI keys</button>
            <button role="menuitem" onClick={toggleTheme}><Sun size={16}/><Moon size={16}/>Change theme</button>
            <button role="menuitem" onClick={()=>navigate('developer')}>Open Developer workspace</button>
            <button role="menuitem" onClick={()=>{setAccountOpen(false);setConfirmSignOut(true)}}><LogOut size={16}/>Sign out</button>
          </div>}
        </div>
      </div>
    </div>
    {activeView !== 'marketplace' && <div className="business-header-secondary">
      <nav aria-label="Business shortcuts" className="business-shortcuts">
        {[['marketplace','Marketplace'],['apps','My apps'],['flows','Workflows']].map(([view,label])=><button key={view} onClick={()=>onNavChange?.(view)} aria-current={activeView===view?'page':undefined}>{label}</button>)}
      </nav>
      <SafeCard name="Workspace switcher" quiet><WorkspaceSwitcher workspaces={workspaces} active={activeWorkspace} onSwitch={onSwitchWorkspace} onCreate={onCreateWorkspace} onManage={onManageWorkspace}/></SafeCard>
    </div>}
    {signOutDialog}
  </header>
}
