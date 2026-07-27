import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useNavigate } from 'react-router-dom'

export default function Gallery() {
  const [apps, setApps] = useState([])
  const [domains, setDomains] = useState([])
  const [activeDomain, setActiveDomain] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      supabase.from('apps').select('*, domains(name, emoji, color)').eq('is_published', true).order('total_runs', { ascending: false }),
      supabase.from('domains').select('*').order('order_index'),
    ]).then(([{ data: appData }, { data: domainData }]) => {
      if (appData) setApps(appData)
      if (domainData) setDomains(domainData)
      setLoading(false)
    })
  }, [])

  const filtered = apps.filter(a => {
    const matchesDomain = activeDomain === 'all' || a.domain_id === activeDomain
    const q = search.toLowerCase()
    const matchesSearch = !q || a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)
    return matchesDomain && matchesSearch
  })

  return (
    <div className="min-h-screen bg-[#0F1225]">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#171B33]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#6C5CE7] flex items-center justify-center text-white font-bold text-sm">A</div>
            <span className="text-white font-semibold">Aistrix</span>
            <span className="text-slate-600 mx-2">/</span>
            <span className="text-slate-400 text-sm">App Gallery</span>
          </div>
          <button
            onClick={() => navigate('/')}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-4 py-1.5 rounded-lg transition-colors font-medium"
          >
            Sign in →
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-3">AI App Gallery</h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Browse {apps.length} pre-built AI apps for writing, analytics, marketing, and more. No code required.
          </p>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 bg-[#171B33] border border-white/10 rounded-xl px-4 py-2.5 mb-6 max-w-lg mx-auto">
          <span className="text-slate-500">🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search apps..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
        </div>

        {/* Domain filters */}
        <div className="flex gap-2 mb-8 flex-wrap justify-center">
          <button
            onClick={() => setActiveDomain('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeDomain === 'all' ? 'bg-[#6C5CE7] text-white' : 'bg-[#171B33] text-slate-400 hover:text-white'}`}
          >
            All <span className="opacity-60 ml-1">{apps.length}</span>
          </button>
          {domains.map(d => (
            <button key={d.id} onClick={() => setActiveDomain(d.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeDomain === d.id ? 'bg-[#6C5CE7] text-white' : 'bg-[#171B33] text-slate-400 hover:text-white'}`}>
              {d.emoji} {d.name}
            </button>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-[#171B33] border border-white/5 rounded-xl p-4 animate-pulse h-36" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(app => (
              <div
                key={app.id}
                onClick={() => navigate(`/app/${app.id}`)}
                className="bg-[#171B33] border border-white/5 hover:border-[#6C5CE7]/50 rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-0.5 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                    style={{ background: (app.color || app.domains?.color || '#6C5CE7') + '33' }}>
                    {app.emoji || '🤖'}
                  </div>
                  <span className="text-[10px] text-slate-500">{app.total_runs || 0} runs</span>
                </div>
                <p className="text-white text-sm font-medium mb-1 group-hover:text-[#a89af7] transition-colors">{app.name}</p>
                <p className="text-xs text-slate-400 line-clamp-2 mb-3">{app.description}</p>
                <div className="flex gap-1 flex-wrap">
                  {(app.tags || []).slice(0, 3).map(t => (
                    <span key={t} className="text-[10px] bg-[#1F2444] text-slate-400 px-2 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="text-slate-400">No apps found for "{search}"</p>
          </div>
        )}

        {/* CTA */}
        <div className="mt-16 text-center bg-[#171B33] border border-white/10 rounded-2xl p-10">
          <h2 className="text-white text-2xl font-semibold mb-2">Ready to run these apps?</h2>
          <p className="text-slate-400 text-sm mb-6">Sign up free — no credit card required. Use your own API key for unlimited runs.</p>
          <button
            onClick={() => navigate('/')}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white px-8 py-3 rounded-xl font-medium transition-colors"
          >
            Get started free →
          </button>
        </div>
      </div>
    </div>
  )
}
