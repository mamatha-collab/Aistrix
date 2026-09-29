import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { track, EVENTS } from '../lib/analytics'

const CATEGORY_ICONS = {
  'Productivity':        '⚡',
  'Writing & Content':   '✍️',
  'Data & Analysis':     '📊',
  'Customer Support':    '💬',
  'HR & Recruiting':     '👥',
  'Sales & Marketing':   '📈',
  'Legal & Compliance':  '⚖️',
  'Engineering':         '🔧',
  'Education':           '🎓',
  'Other':               '🔮',
}

// ─── Marketplace listing grid ─────────────────────────────────────────────────
export function MarketplacePage() {
  const [listings, setListings]     = useState(null)
  const [category, setCategory]     = useState('All')
  const [search, setSearch]         = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    load()
    track(EVENTS.MARKETPLACE_VIEWED)
  }, [])

  async function load() {
    // Primary: formal marketplace listings
    const { data: listingRows } = await supabase
      .from('marketplace_listings')
      .select('*, apps(name, description, ai_model, ai_provider, price_per_run, is_paid), developer_profiles(display_name)')
      .eq('status', 'live')
      .order('updated_at', { ascending: false })

    if (listingRows && listingRows.length > 0) {
      setListings(listingRows)
      return
    }

    // Fallback: any published app without a formal listing
    const { data: appRows } = await supabase
      .from('apps')
      .select('id, name, description, ai_model, ai_provider, price_per_run, is_paid, app_type, created_at, updated_at')
      .eq('is_published', true)
      .order('updated_at', { ascending: false })

    const synthetic = (appRows || []).map(a => ({
      id: a.id,
      app_id: a.id,
      title: a.name,
      tagline: a.description || '',
      description: a.description || '',
      category: null,
      tags: [],
      status: 'live',
      updated_at: a.updated_at,
      apps: { name: a.name, description: a.description, ai_model: a.ai_model, ai_provider: a.ai_provider, price_per_run: a.price_per_run, is_paid: a.is_paid },
      developer_profiles: null,
    }))
    setListings(synthetic)
  }

  const categories = listings
    ? ['All', ...Array.from(new Set(listings.map(l => l.category).filter(Boolean)))]
    : ['All']

  const filtered = (listings || []).filter(l => {
    if (category !== 'All' && l.category !== category) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        l.title?.toLowerCase().includes(q) ||
        l.tagline?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.tags?.some(t => t.toLowerCase().includes(q))
      )
    }
    return true
  })

  return (
    <div className="min-h-screen bg-[#09101F] text-white">
      {/* Header */}
      <div className="border-b border-white/5 bg-[#0E1424]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="text-[#A29BFE] text-sm font-semibold hover:text-white transition-colors">
            ← Aistrix
          </Link>
          <h1 className="text-base font-bold text-white">Marketplace</h1>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search apps…"
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/50 w-56"
          />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Hero */}
        <div className="text-center space-y-2 py-4">
          <h2 className="text-3xl font-bold text-white">AI Apps for every workflow</h2>
          <p className="text-slate-400 text-sm">Discover and launch AI apps built on Aistrix</p>
        </div>

        {/* Category filter */}
        <div className="flex flex-wrap gap-2 justify-center">
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                category === c
                  ? 'bg-[#6C5CE7] border-[#6C5CE7] text-white'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/20'
              }`}>
              {c !== 'All' && (CATEGORY_ICONS[c] ?? '🔮')} {c}
            </button>
          ))}
        </div>

        {/* Grid */}
        {listings === null ? (
          <div className="text-center text-slate-500 py-20 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-slate-500 py-20 text-sm">
            {search ? `No results for "${search}"` : 'No apps listed yet.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(l => <ListingCard key={l.id} listing={l} onClick={() => { track(EVENTS.MARKETPLACE_APP_CLICKED, { app_id: l.app_id, title: l.title, category: l.category }); navigate(`/marketplace/${l.app_id}`) }} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function ListingCard({ listing: l, onClick }) {
  const app = l.apps
  const isPaid = app?.is_paid
  const price = app?.price_per_run

  return (
    <button onClick={onClick}
      className="text-left bg-[#0E1424] border border-white/5 hover:border-[#6C5CE7]/30 rounded-2xl p-5 space-y-3 transition-all hover:shadow-lg hover:shadow-[#6C5CE7]/5 group">
      <div className="flex items-start justify-between gap-2">
        <div className="w-10 h-10 rounded-xl bg-[#6C5CE7]/20 flex items-center justify-center text-lg shrink-0">
          {CATEGORY_ICONS[l.category] ?? '🔮'}
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isPaid ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
          {isPaid ? (price ? `$${price}/run` : 'Paid') : 'Free'}
        </span>
      </div>

      <div>
        <p className="text-sm font-bold text-white group-hover:text-[#A29BFE] transition-colors">{l.title}</p>
        {l.tagline && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{l.tagline}</p>}
      </div>

      {l.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {l.tags.slice(0, 3).map(t => (
            <span key={t} className="text-[10px] bg-white/5 text-slate-500 px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        {l.category && <p className="text-[10px] text-slate-600">{l.category}</p>}
        {l.developer_profiles?.display_name && (
          <Link to={`/dev/${l.user_id}`} onClick={e => e.stopPropagation()}
            className="text-[10px] text-slate-600 hover:text-[#A29BFE] transition-colors">
            by {l.developer_profiles.display_name}
          </Link>
        )}
      </div>
    </button>
  )
}

// ─── Single app detail + launch ───────────────────────────────────────────────
export function MarketplaceAppPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [listing, setListing]   = useState(null)
  const [app, setApp]           = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [input, setInput]       = useState('')
  const [output, setOutput]     = useState('')
  const [running, setRunning]   = useState(false)
  const [error, setError]       = useState(null)

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

  useEffect(() => { load() }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const { data } = await supabase
      .from('marketplace_listings')
      .select('*, apps(*), developer_profiles(display_name, bio, avatar_url)')
      .eq('app_id', id)
      .eq('status', 'live')
      .single()
    if (!data) { setNotFound(true); return }
    setListing(data)
    setApp(data.apps)
    track(EVENTS.MARKETPLACE_APP_VIEWED, { app_id: id, title: data.title, category: data.category })
  }

  async function runApp() {
    if (!input.trim() || !app) return
    setRunning(true)
    setOutput('')
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          input: input.trim(),
          system_prompt: app.system_prompt,
          ai_provider: app.ai_provider || 'claude',
          ai_model: app.ai_model || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Backend error' }))
        throw new Error(err.detail || err.error || 'Backend error')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const d = JSON.parse(line.slice(6))
            if (d.token) setOutput(p => p + d.token)
            if (d.error) throw new Error(d.error)
          } catch (e) { if (e.message !== 'Unexpected end of JSON input') throw e }
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  if (notFound) return (
    <div className="min-h-screen bg-[#09101F] flex flex-col items-center justify-center text-center gap-4">
      <p className="text-slate-400 text-sm">This app isn't available in the marketplace.</p>
      <button onClick={() => navigate('/marketplace')} className="text-xs text-[#A29BFE] hover:underline">← Back to Marketplace</button>
    </div>
  )

  if (!listing) return (
    <div className="min-h-screen bg-[#09101F] flex items-center justify-center">
      <p className="text-slate-500 text-sm">Loading…</p>
    </div>
  )

  const isPaid = app?.is_paid
  const price  = app?.price_per_run

  return (
    <div className="min-h-screen bg-[#09101F] text-white">
      {/* Header */}
      <div className="border-b border-white/5 bg-[#0E1424]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/marketplace')} className="text-[#A29BFE] text-sm font-semibold hover:text-white transition-colors">
            ← Marketplace
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        {/* App header */}
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-[#6C5CE7]/20 flex items-center justify-center text-3xl shrink-0">
            {CATEGORY_ICONS[listing.category] ?? '🔮'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white">{listing.title}</h1>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isPaid ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                {isPaid ? (price ? `$${price}/run` : 'Paid') : 'Free'}
              </span>
            </div>
            {listing.tagline && <p className="text-slate-400 text-sm mt-1">{listing.tagline}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {listing.category && (
                <span className="text-xs bg-[#6C5CE7]/10 text-[#A29BFE] px-2 py-0.5 rounded-full">
                  {CATEGORY_ICONS[listing.category]} {listing.category}
                </span>
              )}
              {listing.tags?.map(t => (
                <span key={t} className="text-xs bg-white/5 text-slate-500 px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
            {listing.developer_profiles?.display_name && (
              <Link to={`/dev/${listing.user_id}`} className="text-xs text-slate-500 hover:text-[#A29BFE] transition-colors mt-1 inline-block">
                by {listing.developer_profiles.display_name}
              </Link>
            )}
          </div>
        </div>

        {/* Description */}
        {listing.description && (
          <div className="bg-[#0E1424] border border-white/5 rounded-2xl p-5">
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{listing.description}</p>
          </div>
        )}

        {/* Try it */}
        <div className="bg-[#0E1424] border border-white/5 rounded-2xl p-5 space-y-4">
          <p className="text-sm font-semibold text-white">Try it</p>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Enter your input…"
            rows={4}
            className="w-full bg-[#171B33] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 resize-none"
          />
          <div className="flex justify-end">
            <button
              onClick={runApp}
              disabled={running || !input.trim()}
              className="text-sm font-semibold px-5 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
              {running ? 'Running…' : 'Run'}
            </button>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400">{error}</div>
          )}

          {(output || running) && (
            <div className="bg-[#171B33] border border-white/5 rounded-xl px-4 py-3 min-h-[80px]">
              <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                {output}
                {running && <span className="inline-block w-1.5 h-4 bg-[#A29BFE] ml-0.5 animate-pulse align-middle" />}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
