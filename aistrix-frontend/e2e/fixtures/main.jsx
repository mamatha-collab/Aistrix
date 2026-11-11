import BusinessFixture from './BusinessFixture'
import './supabase'
import MemoryNavigation from './memoryNavigation'
import { MarketplacePage, MarketplaceAppPage } from '../../src/screens/MarketplacePage'
import DeveloperProfilePage from '../../src/screens/DeveloperProfilePage'
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DevStudioPage from '../../src/screens/DevStudioPage'
import CreateAppModal from '../../src/components/CreateAppModal'
import CreateCodeApp from '../../src/components/CreateCodeApp'
import AIAppBuilder from '../../src/components/AIAppBuilder'
import AppTypeSelector from '../../src/components/AppTypeSelector'
import Auth from '../../src/components/Auth'
import DeveloperShell, { DeveloperLoading } from '../../src/components/DeveloperShell'
import Sidebar from '../../src/components/SidebarClean'
import { ToastProvider } from '../../src/components/Toast'
import '../../src/index.css'
import { initTheme } from '../../src/utils/theme'

initTheme()   // apply the saved light/dark choice on load, as the app does

function Fixture() {
  const [chromeLoading, setChromeLoading] = useState(new URLSearchParams(location.search).has('loading'))
  useEffect(() => {
    const ready = () => setChromeLoading(false)
    window.addEventListener('fixture-ready', ready)
    return () => window.removeEventListener('fixture-ready', ready)
  }, [])
  const [showCreate, setShowCreate] = useState(false)
  const [createType, setCreateType] = useState('prompt')
  const inline = new URLSearchParams(location.search).get('scenario') === 'inline-creation'
  // The production layout (shared sidebar row): App.jsx always mounts DeveloperShell active.
  const sharedRow = inline || new URLSearchParams(location.search).get('scenario') === 'shared-row' || new URLSearchParams(location.search).has('shell')
  const [choosing, setChoosing] = useState(false)
  const [inlineType, setInlineType] = useState(null)
  const navigationGuardRef = useRef(null)
  const [createdApp, setCreatedApp] = useState(null)
  const [search, setSearch] = useState('')
  const [showAIBuilder, setShowAIBuilder] = useState(new URLSearchParams(location.search).get('scenario') === 'ai-builder')
  const user = { id: 'fixture-user', email: 'fixture@example.invalid' }
  const closeInline = () => { setChoosing(false); setInlineType(null) }
  const createdInline = app => { closeInline(); setCreatedApp(app) }
  // As App.jsx: Dev Studio's chooser asks for a specific type, which opens
  // that type's builder directly (inline in the workspace, or the dialog).
  const openCreate = type => {
    const picked = typeof type === 'string' ? type : null
    if (inline) { setChoosing(true); setInlineType(picked); return }
    if (picked === 'ai_builder') { setShowAIBuilder(true); return }
    setCreateType(picked || 'prompt'); setShowCreate(true)
  }
  const ManualCreator = inlineType === 'code_job' ? CreateCodeApp : CreateAppModal
  const inlineContent = inline && choosing ? <>
    <AppTypeSelector presentation="inline" navigationGuardRef={navigationGuardRef} onLeave={closeInline} hidden={!!inlineType} onClose={closeInline} onSelect={setInlineType} />
    {inlineType && (inlineType === 'ai_builder'
      ? <AIAppBuilder presentation="inline" navigationGuardRef={navigationGuardRef} onLeave={closeInline} user={user} onClose={() => setInlineType(null)} onBack={() => setInlineType(null)} onCreated={createdInline} />
      : <ManualCreator presentation="inline" navigationGuardRef={navigationGuardRef} onLeave={closeInline} user={user} initialType={inlineType} onClose={() => setInlineType(null)} onBack={() => setInlineType(null)} onCreated={createdInline} />)}
  </> : null
  if (new URLSearchParams(location.search).get('scenario')?.startsWith('market-customer')) return <MemoryNavigation initialPath="/marketplace">{({ pathname }) =>
    pathname === '/marketplace' ? <MarketplacePage />
      : /^\/marketplace\/[^/]+$/.test(pathname) ? <MarketplaceAppPage />
      : /^\/dev\/[^/]+$/.test(pathname) ? <DeveloperProfilePage />
      : /^\/app\/[^/]+$/.test(pathname) ? <p>Shared app runner destination</p>
      : null
  }</MemoryNavigation>
  if (new URLSearchParams(location.search).get('scenario') === 'business') return <BusinessFixture />
  if (chromeLoading) return <DeveloperLoading />
  if (new URLSearchParams(location.search).get('scenario') === 'signed-out') return <Auth developer />
  // The real app mounts Dev Studio inside its navigation provider (links in
  // the capability chooser need it).
  return <MemoryNavigation initialPath="/developer"><ToastProvider>
    <DeveloperShell active={sharedRow} className="h-screen flex bg-[#09101F]">
      {sharedRow && <div className="hidden md:flex"><Sidebar user={user} mode="developer" activeView="developer" /></div>}
      <DevStudioPage user={user} search={search} onSearch={setSearch} navigationGuardRef={inline ? navigationGuardRef : undefined} creationContent={inlineContent} onOpenCreate={openCreate} createdApp={createdApp} onCreatedAppConsumed={() => setCreatedApp(null)} />
    </DeveloperShell>
    {showCreate && <CreateAppModal user={user} initialType={createType} onClose={() => setShowCreate(false)} onCreated={setCreatedApp} />}
    {showAIBuilder && <AIAppBuilder user={user} onClose={() => setShowAIBuilder(false)} onCreated={setCreatedApp} />}
  </ToastProvider></MemoryNavigation>
}

createRoot(document.getElementById('root')).render(
  new URLSearchParams(location.search).has('strict') ? <React.StrictMode><Fixture /></React.StrictMode> : <Fixture />,
)
