import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = '#6C5CE7', icon }) {
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        <div className="h-1.5 w-12 rounded-full" style={{ background: color }} />
      </div>
      <p className="text-3xl font-bold text-white mb-1">{value ?? '—'}</p>
      <p className="text-xs text-slate-400">{label}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Apps tab ─────────────────────────────────────────────────────────────────
function AppsTab({ toast }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => { loadApps() }, [])

  async function loadApps() {
    const { data } = await supabase.from('apps')
      .select('id, name, emoji, app_type, status, is_published, is_featured, is_verified, is_trending, is_top_rated, is_new, total_runs, created_by, created_at, domain_id')
      .order('created_at', { ascending: false })
    setApps(data || [])
    setLoading(false)
  }

  async function update(id, changes) {
    const { error } = await supabase.from('apps').update(changes).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setApps(prev => prev.map(a => a.id === id ? { ...a, ...changes } : a))
    toast('App updated', 'success', 2000)
  }

  async function deleteApp(id, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('apps').delete().eq('id', id)
    if (error) { toast(`Couldn't delete "${name}": ${error.message}`, 'error'); return }
    setApps(prev => prev.filter(a => a.id !== id))
    toast(`"${name}" deleted`, 'info')
  }

  const filtered = apps.filter(a => {
    const matchStatus = filter === 'all' || a.status === filter || (filter === 'featured' && a.is_featured)
    const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const BADGE_TOGGLES = [
    { key: 'is_verified', label: '✓', title: 'Verified' },
    { key: 'is_trending', label: '🔥', title: 'Trending' },
    { key: 'is_top_rated', label: '⭐', title: 'Top Rated' },
    { key: 'is_new', label: '🆕', title: 'New' },
    { key: 'is_featured', label: '📌', title: 'Featured' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2 flex-1">
          <span className="text-slate-500">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search apps..." className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none" />
        </div>
        <div className="flex gap-1">
          {['all', 'approved', 'pending', 'flagged', 'rejected', 'featured'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-3 py-2 rounded-lg capitalize transition-colors ${filter === f ? 'bg-[#6C5CE7] text-white' : 'bg-[#1F2444] text-slate-400 hover:text-white'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500">{filtered.length} apps</p>

      <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#1F2444] border-b border-white/5">
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-3">App</th>
              <th className="text-left text-xs text-slate-400 font-medium px-3 py-3 hidden md:table-cell">Type</th>
              <th className="text-left text-xs text-slate-400 font-medium px-3 py-3 hidden lg:table-cell">Status</th>
              <th className="text-left text-xs text-slate-400 font-medium px-3 py-3 hidden lg:table-cell">Runs</th>
              <th className="text-left text-xs text-slate-400 font-medium px-3 py-3">Badges</th>
              <th className="text-left text-xs text-slate-400 font-medium px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-white/5">
                  {[...Array(6)].map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.map(app => (
              <tr key={app.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{app.emoji}</span>
                    <div>
                      <p className="text-white text-xs font-medium">{app.name}</p>
                      <p className="text-[10px] text-slate-500">{timeAgo(app.created_at)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 hidden md:table-cell">
                  <span className="text-[10px] bg-[#1F2444] text-slate-400 px-2 py-0.5 rounded capitalize">{app.app_type || 'prompt'}</span>
                </td>
                <td className="px-3 py-3 hidden lg:table-cell">
                  <select value={app.status || 'approved'} onChange={e => update(app.id, { status: e.target.value })}
                    className="text-[10px] bg-[#1F2444] border border-white/10 text-slate-300 rounded-lg px-2 py-1 focus:outline-none">
                    <option value="approved">Approved</option>
                    <option value="pending">Pending</option>
                    <option value="flagged">Flagged</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </td>
                <td className="px-3 py-3 hidden lg:table-cell">
                  <span className="text-xs text-slate-400">{app.total_runs || 0}</span>
                </td>
                <td className="px-3 py-3">
                  <div className="flex gap-1">
                    {BADGE_TOGGLES.map(b => (
                      <button key={b.key} onClick={() => update(app.id, { [b.key]: !app[b.key] })}
                        title={b.title}
                        className={`text-sm px-1 py-0.5 rounded transition-all ${app[b.key] ? 'opacity-100' : 'opacity-20 hover:opacity-60'}`}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => update(app.id, { is_published: !app.is_published })}
                      className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${app.is_published ? 'bg-green-400/10 text-green-400 hover:bg-red-400/10 hover:text-red-400' : 'bg-[#1F2444] text-slate-500 hover:text-white'}`}>
                      {app.is_published ? 'Live' : 'Draft'}
                    </button>
                    <button onClick={() => deleteApp(app.id, app.name)}
                      className="text-[10px] text-slate-600 hover:text-red-400 px-2 py-1 rounded-lg transition-colors">🗑</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-8">No apps match this filter</p>
        )}
      </div>
    </div>
  )
}

// ─── Domains tab ──────────────────────────────────────────────────────────────
function DomainsTab({ toast }) {
  const [domains, setDomains] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    supabase.from('domains').select('*').order('order_index')
      .then(({ data }) => setDomains(data || []))
  }, [])

  async function saveDomain() {
    if (!form.name?.trim()) return
    if (editing) {
      const { error } = await supabase.from('domains').update(form).eq('id', editing)
      if (error) { toast(error.message, 'error'); return }
      setDomains(prev => prev.map(d => d.id === editing ? { ...d, ...form } : d))
      toast('Domain updated', 'success', 2000)
    } else {
      const { data, error } = await supabase.from('domains').insert({
        ...form, order_index: Math.max(...domains.map(d => d.order_index), 0) + 1,
      }).select().single()
      if (error) { toast(error.message, 'error'); return }
      if (data) setDomains(prev => [...prev, data])
      toast('Domain created', 'success')
    }
    setEditing(null); setForm({}); setShowNew(false)
  }

  async function deleteDomain(id, name) {
    if (!window.confirm(`Delete "${name}"? Apps in this domain will be uncategorized.`)) return
    const { error } = await supabase.from('domains').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setDomains(prev => prev.filter(d => d.id !== id))
    toast(`"${name}" deleted`, 'info')
  }

  const inCls = 'bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  const DomainForm = () => (
    <div className="bg-[#1F2444] border border-[#6C5CE7]/30 rounded-2xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Name</label>
          <input className={inCls} placeholder="Career" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Slug</label>
          <input className={inCls} placeholder="career" value={form.slug || ''} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
        </div>
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Emoji</label>
          <input className={inCls} placeholder="💼" value={form.emoji || ''} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))} />
        </div>
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Color (hex)</label>
          <input className={inCls} placeholder="#6C5CE7" value={form.color || ''} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-slate-400 block mb-1">Description</label>
        <input className={`${inCls} w-full`} placeholder="Brief description of this category" value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>
      <div className="flex gap-2">
        <button onClick={saveDomain} className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-xs px-4 py-2 rounded-lg font-medium transition-colors">
          {editing ? 'Save changes' : 'Create domain'}
        </button>
        <button onClick={() => { setEditing(null); setForm({}); setShowNew(false) }}
          className="bg-[#171B33] text-slate-400 text-xs px-3 py-2 rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">{domains.length} categories</p>
        <button onClick={() => { setShowNew(true); setEditing(null); setForm({}) }}
          className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors">
          + New category
        </button>
      </div>

      {(showNew && !editing) && <DomainForm />}

      <div className="space-y-2">
        {domains.map(d => (
          <div key={d.id}>
            {editing === d.id ? <DomainForm /> : (
              <div className="bg-[#171B33] border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl" style={{ background: d.color + '22' }}>{d.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{d.name}</p>
                  <p className="text-[10px] text-slate-500">{d.description}</p>
                </div>
                <span className="text-[10px] text-slate-600 font-mono hidden sm:block">{d.slug}</span>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditing(d.id); setForm({ name: d.name, slug: d.slug, emoji: d.emoji, color: d.color, description: d.description }); setShowNew(false) }}
                    className="text-slate-500 hover:text-white text-xs p-1.5 transition-colors">✏️</button>
                  <button onClick={() => deleteDomain(d.id, d.name)}
                    className="text-slate-500 hover:text-red-400 text-xs p-1.5 transition-colors">🗑</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Roles tab ────────────────────────────────────────────────────────────────
function RolesTab({ toast }) {
  const [roles, setRoles] = useState([])
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('moderator')

  useEffect(() => {
    supabase.from('user_roles').select('*').order('granted_at', { ascending: false })
      .then(({ data }) => setRoles(data || []))
  }, [])

  async function grantRole() {
    if (!userId.trim()) return
    const { error } = await supabase.from('user_roles').upsert({ user_id: userId.trim(), role }, { onConflict: 'user_id' })
    if (error) { toast(error.message, 'error'); return }
    setRoles(prev => {
      const existing = prev.find(r => r.user_id === userId.trim())
      return existing ? prev.map(r => r.user_id === userId.trim() ? { ...r, role } : r) : [...prev, { user_id: userId.trim(), role, granted_at: new Date().toISOString() }]
    })
    setUserId('')
    toast(`${role} role granted`, 'success')
  }

  async function revokeRole(uid) {
    const { error } = await supabase.from('user_roles').delete().eq('user_id', uid)
    if (error) { toast(error.message, 'error'); return }
    setRoles(prev => prev.filter(r => r.user_id !== uid))
    toast('Role revoked', 'info', 2000)
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <p className="text-white font-medium text-sm">Grant role</p>
        <p className="text-xs text-slate-400">Find user UUIDs in Supabase → Authentication → Users</p>
        <div className="flex gap-2">
          <input className="flex-1 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors font-mono text-xs"
            placeholder="User UUID (e.g. a1b2c3d4-...)" value={userId} onChange={e => setUserId(e.target.value)} />
          <select className="bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7] transition-colors"
            value={role} onChange={e => setRole(e.target.value)}>
            <option value="moderator">Moderator</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button onClick={grantRole} disabled={!userId.trim()}
          className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-4 py-2 rounded-xl font-medium transition-colors">
          Grant role
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500 uppercase">{roles.length} role assignments</p>
        {roles.map(r => (
          <div key={r.user_id} className="bg-[#171B33] border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.role === 'admin' ? 'bg-red-400/15 text-red-400' : 'bg-blue-400/15 text-blue-400'}`}>
              {r.role}
            </div>
            <p className="text-xs text-slate-300 font-mono flex-1 truncate">{r.user_id}</p>
            <p className="text-[10px] text-slate-600 hidden sm:block">{timeAgo(r.granted_at)}</p>
            <button onClick={() => revokeRole(r.user_id)} className="text-slate-600 hover:text-red-400 text-xs transition-colors">Revoke</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const [tab, setTab] = useState('overview')
  const [stats, setStats] = useState(null)
  const toast = useToast()

  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    const [
      { count: totalApps },
      { count: publishedApps },
      { count: totalRuns },
      { count: featuredApps },
      { data: topApps },
    ] = await Promise.all([
      supabase.from('apps').select('id', { count: 'exact', head: true }),
      supabase.from('apps').select('id', { count: 'exact', head: true }).eq('is_published', true),
      supabase.from('run_history').select('id', { count: 'exact', head: true }),
      supabase.from('apps').select('id', { count: 'exact', head: true }).eq('is_featured', true),
      supabase.from('apps').select('name, emoji, total_runs').eq('is_published', true).order('total_runs', { ascending: false }).limit(5),
    ])

    const { data: userCounts } = await supabase.from('run_history').select('user_id').limit(1000)
    const uniqueUsers = new Set(userCounts?.map(r => r.user_id)).size

    setStats({ totalApps, publishedApps, totalRuns, featuredApps, uniqueUsers, topApps: topApps || [] })
  }

  const TABS = [
    { id: 'overview', label: '⊞ Overview' },
    { id: 'apps',     label: '🧩 Apps' },
    { id: 'domains',  label: '🗂 Categories' },
    { id: 'roles',    label: '🔑 Roles' },
  ]

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-white text-xl font-semibold">Admin Dashboard</h1>
            <span className="text-[10px] bg-red-400/15 text-red-400 px-2 py-0.5 rounded-full font-bold">ADMIN</span>
          </div>
          <p className="text-slate-400 text-sm">Full platform control and moderation.</p>
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

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Total apps" value={stats?.totalApps} sub="all time" color="#6C5CE7" icon="🧩" />
            <StatCard label="Published" value={stats?.publishedApps} color="#00B894" icon="✅" />
            <StatCard label="Total runs" value={stats?.totalRuns} color="#E84393" icon="▶" />
            <StatCard label="Unique users" value={stats?.uniqueUsers} color="#FDCB6E" icon="👥" />
            <StatCard label="Featured apps" value={stats?.featuredApps} color="#74B9FF" icon="📌" />
          </div>

          {stats?.topApps?.length > 0 && (
            <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
              <p className="text-white font-semibold mb-4">Top apps by runs</p>
              <div className="space-y-3">
                {stats.topApps.map((app, i) => {
                  const max = stats.topApps[0]?.total_runs || 1
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-600 w-4">{i + 1}</span>
                      <span className="text-base">{app.emoji}</span>
                      <span className="text-xs text-slate-300 w-44 truncate">{app.name}</span>
                      <div className="flex-1 bg-[#1F2444] rounded-full h-1.5">
                        <div className="h-full bg-[#6C5CE7] rounded-full" style={{ width: `${(app.total_runs / max) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-500 w-12 text-right">{app.total_runs}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'apps'    && <AppsTab    toast={toast} />}
      {tab === 'domains' && <DomainsTab toast={toast} />}
      {tab === 'roles'   && <RolesTab   toast={toast} />}
    </div>
  )
}
