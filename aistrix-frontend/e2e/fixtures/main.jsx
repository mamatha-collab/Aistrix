import './supabase'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MarketplacePage, MarketplaceAppPage } from '../../src/pages/MarketplacePage'
import DeveloperProfilePage from '../../src/pages/DeveloperProfilePage'
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DevStudioPage from '../../src/pages/DevStudioPage'
import CreateAppModal from '../../src/components/CreateAppModal'
import AIAppBuilder from '../../src/components/AIAppBuilder'
import AppTypeSelector from '../../src/components/AppTypeSelector'
import Auth from '../../src/components/Auth'
import DeveloperShell, { DeveloperLoading } from '../../src/components/DeveloperShell'
import Sidebar from '../../src/components/SidebarClean'
import { ToastProvider } from '../../src/components/Toast'
import '../../src/index.css'
import { initTheme } from '../../src/utils/theme.js'

initTheme()   // same as src/main.jsx: apply the saved light/dark choice on load

function Fixture() {
  const [chromeLoading, setChromeLoading] = useState(new URLSearchParams(location.search).has('loading'))
  useEffect(() => {
    const ready = () => setChromeLoading(false)
    window.addEventListener('fixture-ready', ready)
    return () => window.removeEventListener('fixture-ready', ready)
  }, [])
  const [showCreate, setShowCreate] = useState(false)
  const inline = new URLSearchParams(location.search).get('scenario') === 'inline-creation'
  const [choosing, setChoosing] = useState(false)
  const [inlineType, setInlineType] = useState(null)
  const navigationGuardRef = useRef(null)
  const [createdApp, setCreatedApp] = useState(null)
  const [search, setSearch] = useState('')
  const [showAIBuilder, setShowAIBuilder] = useState(new URLSearchParams(location.search).get('scenario') === 'ai-builder')
  const user = { id: 'fixture-user', email: 'fixture@example.invalid' }
  const closeInline = () => { setChoosing(false); setInlineType(null) }
  const createdInline = app => { closeInline(); setCreatedApp(app) }
  const inlineContent = inline && choosing ? <>
    <AppTypeSelector presentation="inline" navigationGuardRef={navigationGuardRef} onLeave={closeInline} hidden={!!inlineType} onClose={closeInline} onSelect={setInlineType} />
    {inlineType && (inlineType === 'ai_builder'
      ? <AIAppBuilder presentation="inline" navigationGuardRef={navigationGuardRef} onLeave={closeInline} user={user} onClose={() => setInlineType(null)} onBack={() => setInlineType(null)} onCreated={createdInline} />
      : <CreateAppModal presentation="inline" navigationGuardRef={navigationGuardRef} onLeave={closeInline} user={user} initialType={inlineType} onClose={() => setInlineType(null)} onBack={() => setInlineType(null)} onCreated={createdInline} />)}
  </> : null
  if (new URLSearchParams(location.search).get('scenario')?.startsWith('market-customer')) return <MemoryRouter initialEntries={['/marketplace']}><Routes>
    <Route path="/marketplace" element={<MarketplacePage />} />
    <Route path="/marketplace/:id" element={<MarketplaceAppPage />} />
    <Route path="/dev/:userId" element={<DeveloperProfilePage />} />
    <Route path="/app/:id" element={<p>Shared app runner destination</p>} />
  </Routes></MemoryRouter>
  if (chromeLoading) return <DeveloperLoading />
  if (new URLSearchParams(location.search).get('scenario') === 'signed-out') return <Auth developer />
  return <ToastProvider>
    <DeveloperShell active={inline || new URLSearchParams(location.search).get('scenario') === 'shared-row'} className="h-screen flex bg-[#09101F]">
      {(inline || new URLSearchParams(location.search).get('scenario') === 'shared-row') && <div className="hidden md:flex"><Sidebar user={user} mode="developer" activeView="developer" /></div>}
      <DevStudioPage user={user} search={search} onSearch={setSearch} navigationGuardRef={inline ? navigationGuardRef : undefined} creationContent={inlineContent} onOpenCreate={() => inline ? setChoosing(true) : setShowCreate(true)} createdApp={createdApp} onCreatedAppConsumed={() => setCreatedApp(null)} />
    </DeveloperShell>
    {showCreate && <CreateAppModal user={user} onClose={() => setShowCreate(false)} onCreated={setCreatedApp} />}
    {showAIBuilder && <AIAppBuilder user={user} onClose={() => setShowAIBuilder(false)} onCreated={setCreatedApp} />}
  </ToastProvider>
}

createRoot(document.getElementById('root')).render(<Fixture />)
