import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'

const BADGE_KEYS = [
  { key: 'is_verified',  label: '✓ Verified',  cls: 'text-blue-400',   active: 'bg-blue-400/15 border-blue-400/30' },
  { key: 'is_top_rated', label: '⭐ Top Rated', cls: 'text-yellow-400', active: 'bg-yellow-400/15 border-yellow-400/30' },
  { key: 'is_trending',  label: '🔥 Trending',  cls: 'text-orange-400', active: 'bg-orange-400/15 border-orange-400/30' },
  { key: 'is_new',       label: '🆕 New',       cls: 'text-green-400',  active: 'bg-green-400/15 border-green-400/30' },
  { key: 'is_featured',  label: '📌 Featured',  cls: 'text-purple-400', active: 'bg-purple-400/15 border-purple-400/30' },
]

// ─── Review Queue tab ─────────────────────────────────────────────────────────
function ReviewQueue({ toast }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [notes, setNotes] = useState({})

  useEffect(() => {
    supabase.from('apps')
      .select('id, name, emoji, color, description, system_prompt, app_type, status, review_notes, created_at, total_runs')
      .in('status', ['pending', 'flagged'])
      .order('created_at', { ascending: false })
      .then(({ data }) => { setApps(data || []); setLoading(false) })
  }, [])

  async function setStatus(id, status) {
    const note = notes[id] || ''
    await supabase.from('apps').update({ status, review_notes: note, is_published: status === 'approved' }).eq('id', id)
    setApps(prev => prev.filter(a => a.id !== id))
    toast(`App ${status}`, status === 'approved' ? 'success' : 'info')
  }

  if (loading) return <p className="text-slate-500 text-sm">Loading review queue...</p>

  if (apps.length === 0) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <div className="text-4xl mb-3">✅</div>
      <p className="text-white font-medium mb-1">Queue is clear</p>
      <p className="text-slate-400 text-sm">No apps pending review or flagged for moderation.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{apps.length} apps awaiting review</p>
      {apps.map(app => (
        <div key={app.id} className={`bg-[#171B33] border rounded-2xl overflow-hidden ${app.status === 'flagged' ? 'border-orange-400/30' : 'border-white/5'}`}>
          <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpanded(expanded === app.id ? null : app.id)}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: (app.color || '#6C5CE7') + '22' }}>
              {app.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-white font-medium text-sm">{app.name}</p>
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${app.status === 'flagged' ? 'bg-orange-400/15 text-orange-400' : 'bg-yellow-400/15 text-yellow-400'}`}>
                  {app.status}
                </span>
                <span className="text-[10px] text-slate-500 bg-[#1F2444] px-1.5 py-0.5 rounded capitalize">{app.app_type || 'prompt'}</span>
              </div>
              <p className="text-xs text-slate-400 line-clamp-1">{app.description}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">Submitted {timeAgo(app.created_at)}</p>
            </div>
            <span className="text-slate-500 text-xs">{expanded === app.id ? '▲' : '▼'}</span>
          </div>

          {expanded === app.id && (
            <div className="px-4 pb-4 border-t border-white/5 pt-4 space-y-3">
              <div>
                <p className="text-[10px] text-slate-500 uppercase mb-1">System Prompt</p>
                <div className="bg-[#0F1225] rounded-xl p-3 text-xs text-slate-400 leading-relaxed max-h-32 overflow-y-auto font-mono">
                  {app.system_prompt || 'No system prompt'}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Review notes (optional)</label>
                <textarea className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors"
                  rows={2} placeholder="Reason for rejection or notes for the developer..."
                  value={notes[app.id] || ''}
                  onChange={e => setNotes(prev => ({ ...prev, [app.id]: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStatus(app.id, 'approved')}
                  className="flex-1 bg-green-500/20 border border-green-500/30 hover:bg-green-500/30 text-green-400 text-xs py-2 rounded-xl font-medium transition-colors">
                  ✓ Approve
                </button>
                <button onClick={() => setStatus(app.id, 'rejected')}
                  className="flex-1 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-xs py-2 rounded-xl transition-colors">
                  ✕ Reject
                </button>
                <button onClick={() => setStatus(app.id, 'flagged')}
                  className="bg-orange-400/10 border border-orange-400/20 hover:bg-orange-400/20 text-orange-400 text-xs px-3 py-2 rounded-xl transition-colors">
                  🚩 Flag
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Badge Manager tab ────────────────────────────────────────────────────────
function BadgeManager({ toast }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.from('apps').select('id, name, emoji, total_runs, is_verified, is_top_rated, is_trending, is_new, is_featured')
      .eq('is_published', true).order('total_runs', { ascending: false })
      .then(({ data }) => { setApps(data || []); setLoading(false) })
  }, [])

  async function toggleBadge(id, key, current) {
    await supabase.from('apps').update({ [key]: !current }).eq('id', id)
    setApps(prev => prev.map(a => a.id === id ? { ...a, [key]: !current } : a))
    toast('Badge updated', 'success', 1500)
  }

  const filtered = search ? apps.filter(a => a.name.toLowerCase().includes(search.toLowerCase())) : apps

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2 max-w-sm">
        <span className="text-slate-500">🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search apps..." className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none" />
      </div>

      <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#1F2444] border-b border-white/5">
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-3">App</th>
              <th className="text-xs text-slate-400 font-medium px-3 py-3 hidden sm:table-cell">Runs</th>
              {BADGE_KEYS.map(b => (
                <th key={b.key} className="text-xs px-2 py-3 hidden md:table-cell" title={b.label}>
                  <span className={b.cls}>{b.label.split(' ')[0]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? [...Array(5)].map((_, i) => (
              <tr key={i} className="border-b border-white/5">
                <td className="px-4 py-3"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>
              </tr>
            )) : filtered.map(app => (
              <tr key={app.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span>{app.emoji}</span>
                    <span className="text-xs text-white">{app.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-slate-500 hidden sm:table-cell">{app.total_runs || 0}</td>
                {BADGE_KEYS.map(b => (
                  <td key={b.key} className="px-2 py-3 text-center hidden md:table-cell">
                    <button onClick={() => toggleBadge(app.id, b.key, app[b.key])}
                      className={`text-xs px-2 py-1 rounded-lg border transition-all ${app[b.key] ? `${b.active} ${b.cls}` : 'border-white/5 text-slate-700 hover:text-slate-400'}`}>
                      {app[b.key] ? '●' : '○'}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main Moderator Page ──────────────────────────────────────────────────────
export default function ModeratorPage({ userRole }) {
  const [tab, setTab] = useState('queue')
  const toast = useToast()

  const TABS = [
    { id: 'queue',  label: '📋 Review Queue' },
    { id: 'badges', label: '🏆 Badge Manager' },
  ]

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-white text-xl font-semibold">Moderation</h1>
            <span className="text-[10px] bg-blue-400/15 text-blue-400 px-2 py-0.5 rounded-full font-bold uppercase">{userRole}</span>
          </div>
          <p className="text-slate-400 text-sm">Review apps, manage quality, and award trust badges.</p>
        </div>
      </div>

      <div className="flex gap-1 bg-[#1F2444] p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${tab === t.id ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'queue'  && <ReviewQueue  toast={toast} />}
      {tab === 'badges' && <BadgeManager toast={toast} />}
    </div>
  )
}
