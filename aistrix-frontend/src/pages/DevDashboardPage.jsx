import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'
import ToolsEditor from '../components/ToolsEditor'

// ─── API Key Management ───────────────────────────────────────────────────────
function ApiKeySection({ user }) {
  const [keys, setKeys] = useState([])
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)
  const [revealed, setRevealed] = useState(null) // key id to show once
  const toast = useToast()

  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  useEffect(() => { loadKeys() }, [])

  async function loadKeys() {
    const { data } = await supabase.from('developer_api_keys')
      .select('id, name, api_key, is_active, last_used_at, total_calls, created_at')
      .eq('user_id', user.id).order('created_at', { ascending: false })
    if (data) setKeys(data)
  }

  async function createKey() {
    if (!newKeyName.trim()) return
    setCreating(true)
    const raw = 'ak_live_' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    const { data, error } = await supabase.from('developer_api_keys').insert({
      user_id: user.id, api_key: raw, name: newKeyName.trim(),
    }).select().single()
    setCreating(false)
    if (error) { toast(error.message, 'error'); return }
    setKeys(prev => [data, ...prev])
    setNewKeyName('')
    setRevealed(data.id)
    toast('API key created — copy it now, it won\'t be shown again', 'info', 6000)
  }

  async function revokeKey(id) {
    await supabase.from('developer_api_keys').update({ is_active: false }).eq('id', id)
    setKeys(prev => prev.map(k => k.id === id ? { ...k, is_active: false } : k))
    toast('Key revoked', 'info')
  }

  async function deleteKey(id) {
    await supabase.from('developer_api_keys').delete().eq('id', id)
    setKeys(prev => prev.filter(k => k.id !== id))
    toast('Key deleted', 'info')
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="flex-1 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
          placeholder="Key name, e.g. Production App"
          value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createKey()}
        />
        <button onClick={createKey} disabled={creating || !newKeyName.trim()}
          className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-4 py-2 rounded-xl font-medium transition-colors shrink-0">
          {creating ? '...' : '+ Generate key'}
        </button>
      </div>

      {keys.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-4">No API keys yet. Generate one to start calling your apps externally.</p>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k.id} className={`bg-[#1F2444] border rounded-xl p-4 ${k.is_active ? 'border-white/5' : 'border-white/5 opacity-50'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white text-sm font-medium">{k.name}</p>
                    {!k.is_active && <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">Revoked</span>}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Created {timeAgo(k.created_at)}
                    {k.last_used_at && ` · Last used ${timeAgo(k.last_used_at)}`}
                    {k.total_calls > 0 && ` · ${k.total_calls} calls`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {k.is_active && <button onClick={() => revokeKey(k.id)} className="text-[10px] text-slate-500 hover:text-orange-400 transition-colors">Revoke</button>}
                  <button onClick={() => deleteKey(k.id)} className="text-[10px] text-slate-500 hover:text-red-400 transition-colors">Delete</button>
                </div>
              </div>
              {revealed === k.id ? (
                <div className="flex items-center gap-2 bg-[#0F1225] border border-[#6C5CE7]/30 rounded-lg px-3 py-2">
                  <code className="text-xs text-[#6C5CE7] flex-1 break-all font-mono">{k.api_key}</code>
                  <button onClick={() => { navigator.clipboard.writeText(k.api_key); toast('Copied!', 'success', 2000) }}
                    className="text-slate-400 hover:text-white text-xs shrink-0">📋</button>
                </div>
              ) : (
                <code className="text-xs text-slate-600 font-mono">{k.api_key.slice(0, 16)}{'•'.repeat(20)}</code>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-[#1F2444] border border-white/5 rounded-xl p-4 space-y-2">
        <p className="text-xs text-slate-400 font-medium">Using your API key</p>
        <pre className="text-[11px] text-slate-400 bg-[#0F1225] rounded-lg p-3 overflow-x-auto leading-relaxed">{`POST https://api.aistrix.com/v1/apps/{app_id}/run
Authorization: Bearer ak_live_xxxxx
Content-Type: application/json

{
  "input": "Your prompt here",
  "inject_context": ["career_profile", "memory"]
}`}</pre>
        <p className="text-[10px] text-slate-500">User context and profiles are automatically injected when specified — no extra setup needed.</p>
      </div>
    </div>
  )
}

// ─── App Stats Card ───────────────────────────────────────────────────────────
function AppStatCard({ app, stats, expanded, onToggle }) {
  const satisfaction = stats.rated > 0 ? Math.round((stats.thumbsUp / stats.rated) * 100) : null

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: (app.color || '#6C5CE7') + '33' }}>
            {app.emoji}
          </div>
          <div>
            <p className="text-white text-sm font-medium">{app.name}</p>
            <div className="flex gap-1 mt-0.5 flex-wrap">
              {app.is_verified  && <span className="text-[9px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full">✓ Verified</span>}
              {app.is_trending  && <span className="text-[9px] text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded-full">🔥 Trending</span>}
              {app.is_top_rated && <span className="text-[9px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-full">⭐ Top Rated</span>}
            </div>
          </div>
        </div>
        <span className="text-[10px] text-slate-500">{app.ai_provider === 'openai' ? '🟢 GPT' : '🟣 Claude'}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Total runs', value: app.total_runs || 0 },
          { label: 'Unique users', value: stats.uniqueUsers },
          { label: 'Satisfaction', value: satisfaction !== null ? `${satisfaction}%` : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#1F2444] rounded-xl p-3 text-center">
            <p className="text-white font-bold text-lg">{value}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* 7-day sparkline */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase mb-2">Last 7 days</p>
        <div className="flex items-end gap-1 h-8">
          {stats.daily.map((count, i) => {
            const max = Math.max(...stats.daily, 1)
            return (
              <div key={i} className="flex-1 bg-[#6C5CE7] rounded-t opacity-70"
                style={{ height: `${Math.max((count / max) * 28, count > 0 ? 3 : 0)}px` }} />
            )
          })}
        </div>
      </div>

      {app.required_context?.length > 0 && (
        <div className="mt-3 flex gap-1 flex-wrap">
          <span className="text-[10px] text-slate-500">Uses:</span>
          {app.required_context.map(c => (
            <span key={c} className="text-[9px] text-[#6C5CE7] bg-[#6C5CE7]/10 px-1.5 py-0.5 rounded-full capitalize">
              {c.replace('_', ' ')}
            </span>
          ))}
        </div>
      )}

      <button onClick={onToggle}
        className="mt-3 w-full text-xs text-slate-500 hover:text-white bg-[#1F2444] py-1.5 rounded-lg transition-colors">
        {expanded ? '▲ Hide tools' : '🔧 Manage tools'}
      </button>

      {expanded && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <ToolsEditor appId={app.id} />
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DevDashboardPage({ user }) {
  const [apps, setApps] = useState([])
  const [appStats, setAppStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('apps')
  const [expandedApp, setExpandedApp] = useState(null)
  const [refreshingBadges, setRefreshingBadges] = useState(false)

  async function refreshBadges() {
    setRefreshingBadges(true)
    const { error } = await supabase.rpc('update_app_badges')
    setRefreshingBadges(false)
    if (error) toast(error.message, 'error')
    else { toast('Trust badges updated', 'success'); load() }
  }
  const [totalStats, setTotalStats] = useState({ runs: 0, users: 0, satisfaction: null })

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when user.id changes
  useEffect(() => { load() }, [user.id])

  async function load() {
    const { data: myApps } = await supabase.from('apps')
      .select('*').eq('created_by', user.id).eq('is_published', true).order('total_runs', { ascending: false })
    if (!myApps?.length) { setLoading(false); return }
    setApps(myApps)

    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const { data: runs } = await supabase.from('run_history')
      .select('app_id, user_id, created_at, rating')
      .in('app_id', myApps.map(a => a.id))

    const statsMap = {}
    const appIds = myApps.map(a => a.id)

    appIds.forEach(id => {
      const appRuns = runs?.filter(r => r.app_id === id) || []
      const recent = appRuns.filter(r => new Date(r.created_at) >= sevenDaysAgo)
      const daily = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0,0,0,0)
        const next = new Date(d); next.setDate(next.getDate() + 1)
        return recent.filter(r => new Date(r.created_at) >= d && new Date(r.created_at) < next).length
      })
      const rated = appRuns.filter(r => r.rating != null)
      statsMap[id] = {
        uniqueUsers: new Set(appRuns.map(r => r.user_id)).size,
        thumbsUp: rated.filter(r => r.rating === 1).length,
        rated: rated.length,
        daily,
      }
    })

    setAppStats(statsMap)

    const allRuns = runs || []
    const allRated = allRuns.filter(r => r.rating != null)
    setTotalStats({
      runs: allRuns.length,
      users: new Set(allRuns.map(r => r.user_id)).size,
      satisfaction: allRated.length > 0 ? Math.round((allRated.filter(r => r.rating === 1).length / allRated.length) * 100) : null,
    })
    setLoading(false)
  }

  const estimatedRevenue = apps.reduce((sum, app) => {
    if (!app.is_paid || !app.price_per_run) return sum
    return sum + ((appStats[app.id]?.uniqueUsers || 0) * Number(app.price_per_run))
  }, 0)

  const TABS = [
    { id: 'apps',    label: '🧩 My Apps' },
    { id: 'api',     label: '🔑 API Keys' },
    { id: 'docs',    label: '📖 Docs' },
  ]

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-white text-xl font-semibold">Developer Dashboard</h1>
        <p className="text-slate-400 text-sm mt-0.5">Build, publish, and monitor your AI apps on Aistrix.</p>
      </div>

      {/* Summary stats */}
      {!loading && apps.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total runs', value: totalStats.runs, color: '#6C5CE7' },
            { label: 'Unique users', value: totalStats.users, color: '#00B894' },
            { label: 'Satisfaction', value: totalStats.satisfaction !== null ? `${totalStats.satisfaction}%` : '—', color: '#FDCB6E' },
            { label: 'Est. revenue', value: estimatedRevenue > 0 ? `$${estimatedRevenue.toFixed(2)}` : '—', color: '#E84393' },
          ].map(s => (
            <div key={s.label} className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
              <p className="text-3xl font-bold text-white mb-1">{s.value}</p>
              <p className="text-xs text-slate-400">{s.label}</p>
              <div className="h-0.5 w-8 rounded-full mt-3" style={{ background: s.color }} />
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[#1F2444] p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${tab === t.id ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* My Apps */}
      {tab === 'apps' && (
        loading ? <p className="text-slate-500 text-sm">Loading...</p> :
        !loading && apps.length > 0 ? (
          <div className="flex justify-end mb-2">
            <button onClick={refreshBadges} disabled={refreshingBadges}
              className="text-xs text-slate-400 hover:text-white bg-[#1F2444] hover:bg-[#272C52] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40">
              {refreshingBadges ? '⟳ Refreshing...' : '🏆 Refresh trust badges'}
            </button>
          </div>
        ) : null
      )}
      {tab === 'apps' && (
        loading ? null :
        apps.length === 0 ? (
          <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
            <div className="text-4xl mb-3">🧩</div>
            <p className="text-white font-medium mb-1">No published apps yet</p>
            <p className="text-slate-400 text-sm mb-5">Create an app using the + Create App button in the Apps view. Once published, it appears here with analytics.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {apps.map(app => (
              <AppStatCard key={app.id} app={app}
                stats={appStats[app.id] || { uniqueUsers: 0, thumbsUp: 0, rated: 0, daily: new Array(7).fill(0) }}
                expanded={expandedApp === app.id}
                onToggle={() => setExpandedApp(prev => prev === app.id ? null : app.id)}
              />
            ))}
          </div>
        )
      )}

      {/* API Keys */}
      {tab === 'api' && (
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-6">
          <p className="text-white font-medium mb-1">API Keys</p>
          <p className="text-xs text-slate-400 mb-5">Use API keys to call your apps programmatically from any codebase, Zapier, n8n, or custom scripts.</p>
          <ApiKeySection user={user} />
        </div>
      )}

      {/* Docs */}
      {tab === 'docs' && (
        <div className="space-y-4">
          {[
            {
              title: '1. Context-as-a-Service',
              desc: 'When you set required_context on your app, Aistrix automatically injects the user\'s career profile, business profile, or AI memory into every run. Users fill their profile once — your app gets it every time.',
              code: `// In your app settings, set required_context to:
["career_profile"]        // user's resume, skills, experience
["business_profile"]     // company name, brand voice, audience
["memory"]               // preferred tone, language, custom facts
["career_profile", "memory"]  // combine multiple`,
            },
            {
              title: '2. Calling your app via API',
              desc: 'Every published app has a stable API endpoint. Call it with your API key and get streaming or full responses.',
              code: `curl -X POST https://api.aistrix.com/v1/apps/{app_id}/run \\
  -H "Authorization: Bearer ak_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": "Write a cover letter for a Senior Engineer role",
    "inject_context": ["career_profile"],
    "stream": false
  }'

// Response:
{
  "result": "Dear Hiring Manager...",
  "provider": "claude",
  "model": "claude-sonnet-4-6",
  "run_id": "uuid"
}`,
            },
            {
              title: '3. App Composition',
              desc: 'Set next_app_id and compose_hint on your app so it becomes a building block in other developers\' Workspaces. Users see "Next: Your App →" after running a related app.',
              code: `// In Supabase, set on your app:
next_app_id: "uuid-of-the-next-logical-app"
compose_hint: "Use this output as the job description for the next step"

// Aistrix will:
// 1. Show your app as a "Next step" recommendation
// 2. Pre-fill its output as the next app's input
// 3. Include your app in relevant Workspace suggestions`,
            },
          ].map(section => (
            <div key={section.title} className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
              <p className="text-white font-medium mb-1">{section.title}</p>
              <p className="text-slate-400 text-sm mb-3 leading-relaxed">{section.desc}</p>
              <pre className="text-[11px] text-slate-400 bg-[#0F1225] rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap">{section.code}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
