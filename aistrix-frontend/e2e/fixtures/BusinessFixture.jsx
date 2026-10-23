import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import TopBar from '../../src/components/TopBarClean'
import Sidebar from '../../src/components/SidebarClean'
import AppGrid from '../../src/components/AppGrid'
import { MarketplacePage } from '../../src/pages/MarketplacePage'
import FlowsPage from '../../src/pages/FlowsPage'
import DevStudioPage from '../../src/pages/DevStudioPage'
import { ToastProvider } from '../../src/components/Toast'
import DeveloperShell from '../../src/components/DeveloperShell'
import '../../src/business-workspace.css'
import '../../src/developer-light.css'

export default function BusinessFixture() {
  const [view,setView]=useState('marketplace'), [search,setSearch]=useState(''), [selected,setSelected]=useState(null), [drawer,setDrawer]=useState(false)
  const user={id:'fixture-user',email:'client@example.invalid'}
  const workspace={id:'personal',name:'My workspace',is_personal:true}
  const developer=view==='developer'
  // Same frame as the real app: on desktop Business shares Developer's top
  // row, second row and left pane.
  return <MemoryRouter><ToastProvider><DeveloperShell active badge={developer?'Developer':'Business'} className={`${developer?'app-shell':'business-workspace'} flex h-dvh overflow-hidden`}>
    <div className={`${drawer?'fixed inset-y-0 left-0 z-40':'hidden'} md:block w-56 md:w-auto shrink-0`}><Sidebar user={user} mode={developer?'developer':'business'} activeView={view} onClose={()=>setDrawer(false)} onModeChange={mode=>setView(mode==='developer'?'developer':'marketplace')} onNavChange={next=>{setView(next);setSearch('');setDrawer(false)}}/></div>
    <div className="min-w-0 flex-1 flex flex-col">{!developer&&<TopBar user={user} activeView={view} search={search} onSearch={setSearch} onNavChange={setView} onShowHistory={()=>setView('history')} onShowSettings={()=>setView('keys')} onToggleSidebar={()=>setDrawer(value=>!value)} workspaces={[workspace]} activeWorkspace={workspace}/>}
      <main className="flex flex-1 min-h-0 overflow-hidden">
        {developer?<DevStudioPage user={user} search={search} onSearch={setSearch}/>:view==='marketplace'?<MarketplacePage user={user}/>:view==='apps'?<AppGrid clientMode user={user} search={search} onSearch={setSearch} selectedApp={selected} onSelectApp={setSelected} onNavChange={setView} onOpenCreate={()=>setView('developer')}/>:view==='flows'?<FlowsPage user={user} search={search}/>:<div className="p-6"><h1>{view}</h1></div>}
      </main>
      {selected&&<div role="status">Opened {selected.name}</div>}
    </div>
  </DeveloperShell></ToastProvider></MemoryRouter>
}
