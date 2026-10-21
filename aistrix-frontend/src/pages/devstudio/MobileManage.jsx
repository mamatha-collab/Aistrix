import { useState } from 'react'
import PublishedVersions from '../../components/PublishedVersions'
import RevenueDetails from '../../components/RevenueDetails'
import AppSecretsPanel from '../../components/AppSecretsPanel'
import SafeCard from '../../components/SafeCard'

const field = 'w-full min-h-11 rounded-xl border border-white/10 bg-[#0E1424] px-3 text-sm text-white'

export default function MobileManage({ apps, user, onAppUpdated }) {
  const [tab, setTab] = useState('revenue')
  const [appId, setAppId] = useState(apps[0]?.id || '')
  const selected = apps.find(app => app.id === appId) || apps[0]
  return <div className="space-y-5">
    <nav aria-label="Manage sections" className="grid grid-cols-3 gap-1 rounded-xl bg-[#171B33] p-1">
      {[['revenue', 'Revenue'], ['versions', 'Versions'], ['secrets', 'Secrets']].map(([id, label]) => <button key={id} className={`min-h-11 rounded-lg text-xs font-semibold ${tab === id ? 'bg-[#6C5CE7] text-white' : 'text-slate-400'}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {tab !== 'revenue' && <label className="block text-xs text-slate-400">App<select aria-label="App to manage" className={`${field} mt-1`} value={selected?.id || ''} onChange={e => setAppId(e.target.value)}>{!apps.length && <option value="">No apps available</option>}{apps.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label>}
    {tab === 'revenue' && <SafeCard name="Revenue"><RevenueDetails apps={apps} user={user} /></SafeCard>}
    {tab === 'versions' && (selected ? <div className="[&_button]:min-h-11"><SafeCard name="Published versions"><PublishedVersions key={selected.id} app={selected} onAppUpdated={onAppUpdated} /></SafeCard></div> : <p className="text-sm text-slate-400">No apps available.</p>)}
    {tab === 'secrets' && <SafeCard name="App secrets"><AppSecretsPanel key={selected?.id || 'none'} appId={selected?.id} user={user} /></SafeCard>}
  </div>
}
