import { createContext, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import AistrixWordmark from './AistrixWordmark'
import { useMediaQuery } from '../hooks/useMediaQuery'
import '../developer-light.css'

const RowContext = createContext(null)
const SidebarContext = createContext({ collapsed: false, setCollapsed: () => {} })
const COLLAPSED_KEY = 'aistrix_dev_sidebar_collapsed'

function savedCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
}

// The Developer sidebar (app list) can shrink to a slim icon rail, leaving
// the room to Design and the other tabs. Remembered per browser.
export function useDeveloperSidebar() {
  return useContext(SidebarContext)
}

// The desktop frame shared by Developer and Business: top row (brand,
// search, actions), second row (mode switch, section ribbon, workspace) and
// the left pane. Each mode fills the slots with its own content.
export default function DeveloperShell({ active, badge = 'Developer', children, ...props }) {
  const desktop = useMediaQuery('(min-width: 768px)')
  const [left, setLeft] = useState(null)
  const [content, setContent] = useState(null)
  const [header, setHeader] = useState(null)
  const [stats, setStats] = useState(null)
  const [sidebar, setSidebar] = useState(null)
  const [collapsedPref, setCollapsedPref] = useState(savedCollapsed)
  const shared = active && desktop
  const collapsed = shared && collapsedPref
  const business = badge === 'Business'
  const navHeight = 93
  const setCollapsed = next => {
    setCollapsedPref(next)
    try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch { /* not remembered */ }
  }

  return <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
  <RowContext.Provider value={shared ? { left, content, header, stats, sidebar, setSidebar, navHeight } : null}>
    <div {...props} className={`${props.className || ''}${active ? ' developer-workspace' : ''}`} style={{ ...props.style, position: 'relative', paddingTop: shared ? 72 + navHeight : undefined }}>
      {shared && <>
        <header className="absolute inset-x-0 top-0 z-40 h-[72px] flex items-center gap-4 px-4 bg-[#111827] border-b border-white/5" aria-label={`${badge} header`} data-frame-header>
          <div className="flex items-center gap-1 shrink-0 text-white">
            <img src="/aistrix-logo.svg" alt="" className="w-7 h-7" />
            <span className="font-bold text-lg"><AistrixWordmark /></span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[#00D4AA]/10 border border-[#00D4AA]/20 text-[#00D4AA] text-[8px] font-bold uppercase">{badge}</span>
          </div>
          <div ref={setHeader} className="flex-1 min-w-0 flex justify-end" />
        </header>
        <div data-frame-nav style={{ height: navHeight }} className={`absolute inset-x-0 top-[72px] z-30 grid ${collapsed ? `grid-cols-[56px_minmax(0,1fr)] ${business ? '' : 'xl:grid-cols-[56px_minmax(0,1fr)_150px]'}` : `grid-cols-[224px_minmax(0,1fr)] ${business ? '' : 'xl:grid-cols-[224px_minmax(0,1fr)_150px]'}`} bg-[#1A2038] border-b border-white/5`} aria-label={`${badge} navigation`}>
          <div ref={setLeft} data-section="mode" className={`min-w-0 flex items-center ${collapsed ? 'px-1.5' : 'px-3'} border-r border-white/5`} />
          <div ref={setContent} data-section="lifecycle" className="min-w-0 overflow-hidden" />
          {!business && <div ref={setStats} data-section="stats" className="hidden xl:block min-w-0 border-l border-white/5" />}
        </div>
      </>}
      {children}
    </div>
  </RowContext.Provider>
  </SidebarContext.Provider>
}

// True inside the shared desktop frame (false on phones and logged-out pages).
export function useShellFramed() {
  return !!useContext(RowContext)
}

export function DeveloperSidebarSlot() {
  const row = useContext(RowContext)
  return row ? <div ref={row.setSidebar} className="min-h-0 flex-1" /> : null
}

export function DeveloperAppList({ children }) {
  const row = useContext(RowContext)
  return row ? (row.sidebar ? createPortal(children, row.sidebar) : null) : <div className="hidden md:block w-56 shrink-0 order-first overflow-y-auto border-r border-white/8">{children}</div>
}

export function DeveloperRowSection({ side, children }) {
  const row = useContext(RowContext)
  if (!row) return children
  return <>
    {row[side] && createPortal(children, row[side])}
  </>
}

// The shell reserves both desktop rows once, independently of which page
// fills their portals. Switching modes cannot collapse their layout space.
export function DeveloperRowPortal({ side, children }) {
  const row = useContext(RowContext)
  return row ? (row[side] ? createPortal(children, row[side]) : null) : children
}

export function DeveloperSidebarBrand({ children }) {
  const row = useContext(RowContext)
  return row ? null : children
}

export function DeveloperLoading() {
  const phone = useMediaQuery('(max-width: 767px)')
  if (phone) return <div className="h-dvh flex flex-col bg-[#09101F]">
    <div className="h-16 shrink-0 bg-[#111827] border-b border-white/8 flex items-center gap-1.5 px-4"><img src="/aistrix-logo.svg" alt="" className="h-7 w-7" /><span className="font-bold text-white text-lg"><AistrixWordmark /></span></div>
    <div role="status" className="flex-1 p-4 space-y-3 text-sm text-slate-400"><p>Loading app activity…</p>{[0, 1, 2].map(i => <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />)}</div>
    <div aria-hidden="true" className="h-16 shrink-0 border-t border-white/8 bg-[#111827]" />
  </div>
  return <DeveloperShell active className="app-shell flex h-dvh overflow-hidden bg-[#09101F]">
    <div className="hidden md:block w-56 shrink-0" />
    <div role="status" className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading your workspace…</div>
  </DeveloperShell>
}
