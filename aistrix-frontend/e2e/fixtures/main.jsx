import './supabase'
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import DevStudioPage from '../../src/pages/DevStudioPage'
import CreateAppModal from '../../src/components/CreateAppModal'
import { ToastProvider } from '../../src/components/Toast'
import '../../src/index.css'

function Fixture() {
  const [showCreate, setShowCreate] = useState(false)
  const [createdApp, setCreatedApp] = useState(null)
  const user = { id: 'fixture-user', email: 'fixture@example.invalid' }
  return <ToastProvider>
    <div className="h-screen flex bg-[#09101F]">
      <DevStudioPage user={user} onOpenCreate={() => setShowCreate(true)} createdApp={createdApp} onCreatedAppConsumed={() => setCreatedApp(null)} />
    </div>
    {showCreate && <CreateAppModal user={user} onClose={() => setShowCreate(false)} onCreated={setCreatedApp} />}
  </ToastProvider>
}

createRoot(document.getElementById('root')).render(<Fixture />)
