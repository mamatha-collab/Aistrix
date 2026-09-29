import { useState, useEffect, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'

// Lazy-loaded — all of these are gated behind a toggle/modal/portal and are
// never needed for the panel's initial render, so there's no reason for them
// to sit in the main bundle. DetailPanel itself is statically imported from
// App.jsx, so anything imported statically here rides along in the main
// chunk regardless of whether it's ever opened.
const AppRunner = lazy(() => import('./AppRunner'))
const MultiPageRunner = lazy(() => import('./MultiPageRunner'))
const AgentRunner = lazy(() => import('./AgentRunner'))
const ConversationThread = lazy(() => import('./ConversationThread'))
const ApiAppRunner = lazy(() => import('./ApiAppRunner'))
const DataAppRunner = lazy(() => import('./DataAppRunner'))
const KnowledgeBaseEditor = lazy(() => import('./KnowledgeBaseEditor'))
const CreateAppModal = lazy(() => import('./CreateAppModal'))
const ToolsEditor = lazy(() => import('./ToolsEditor'))
const VersionHistoryPanel = lazy(() => import('./VersionHistoryPanel'))
const AccessControlPanel = lazy(() => import('./AccessControlPanel'))
const AppRecordsViewer = lazy(() => import('./AppRecordsViewer'))
const EmbedCodeModal = lazy(() => import('./EmbedCodeModal'))

function AnalyticsView({ app, user, onClose }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: runs } = await supabase
        .from('run_history')
        .select('created_at, rating, result')
        .eq('app_id', app.id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (!runs) return

      const dayCounts = {}
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i)
        const key = d.toLocaleDateString('en-US', { weekday: 'short' })
        dayCounts[key] = 0
      }
      runs.forEach(r => {
        const key = new Date(r.created_at).toLocaleDateString('en-US', { weekday: 'short' })
        if (key in dayCounts) dayCounts[key]++
      })

      const rated    = runs.filter(r => r.rating !== null && r.rating !== undefined)
      const thumbsUp = rated.filter(r => r.rating === 1).length
      const failed   = runs.filter(r => !r.result || r.result.startsWith('Error')).length

      setData({ runs, dayCounts, rated, thumbsUp, failed })
    }
    load()
  }, [app.id, user.id])

  const maxCount = data ? Math.max(...Object.values(data.dayCounts), 1) : 1

  return (
    <div className="px-4 pb-4 border-t border-white/5 pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 uppercase">Analytics</p>
        <button onClick={onClose} className="text-[10px] text-slate-500 hover:text-slate-300">Close</button>
      </div>
      {!data ? (
        <p className="text-xs text-slate-500">Loading...</p>
      ) : (
        <>
          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#1F2444] rounded-xl p-3 text-center">
              <p className="text-white font-bold text-lg">{data.runs.length}</p>
              <p className="text-[10px] text-slate-400">Total Runs</p>
            </div>
            <div className="bg-[#1F2444] rounded-xl p-3 text-center">
              <p className="text-white font-bold text-lg">
                {Object.values(data.dayCounts).reduce((a, b) => a + b, 0)}
              </p>
              <p className="text-[10px] text-slate-400">Last 7 Days</p>
            </div>
            <div className="bg-[#1F2444] rounded-xl p-3 text-center">
              <p className="font-bold text-lg" style={{ color: data.failed > 0 ? '#E17055' : '#00B894' }}>
                {data.runs.length > 0 ? `${Math.round(((data.runs.length - data.failed) / data.runs.length) * 100)}%` : '—'}
              </p>
              <p className="text-[10px] text-slate-400">Success Rate</p>
            </div>
            <div className="bg-[#1F2444] rounded-xl p-3 text-center">
              <p className="font-bold text-lg" style={{ color: data.rated.length > 0 ? '#FDCB6E' : '#475569' }}>
                {data.rated.length > 0 ? `${Math.round((data.thumbsUp / data.rated.length) * 100)}%` : '—'}
              </p>
              <p className="text-[10px] text-slate-400">
                👍 Rating {data.rated.length > 0 ? `(${data.rated.length})` : ''}
              </p>
            </div>
          </div>

          {/* Sparkline */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase mb-2">Runs per day (last 7 days)</p>
            <div className="flex items-end gap-1 h-16">
              {Object.entries(data.dayCounts).map(([day, count]) => (
                <div key={day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-[#6C5CE7]/70 rounded-t transition-all"
                    style={{ height: `${(count / maxCount) * 48}px`, minHeight: count > 0 ? 4 : 0 }} />
                  <span className="text-[9px] text-slate-500">{day}</span>
                </div>
              ))}
            </div>
          </div>

          {data.failed > 0 && (
            <div className="bg-[#E17055]/10 border border-[#E17055]/20 rounded-xl px-3 py-2">
              <p className="text-[11px] text-[#E17055]">⚠ {data.failed} run{data.failed > 1 ? 's' : ''} returned an error or empty result. Check your system prompt.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function DetailPanel({ app, user, onClose, onRun, onDeleted }) {
  const [running, setRunning] = useState(!!app._runNow)
  const [directRun, setDirectRun] = useState(!!app._runNow)
  const [copied, setCopied] = useState(false)
  const [stats, setStats] = useState(null)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [localTotalRuns, setLocalTotalRuns] = useState(null)
  const [editing, setEditing] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [showRecords, setShowRecords] = useState(false)
  const [showEmbedModal, setShowEmbedModal] = useState(false)
  const [showKB, setShowKB] = useState(false)
  const [currentApp, setCurrentApp] = useState(app)
  const [keyStatus, setKeyStatus] = useState(null) // null | 'ready' | 'demo'
  const [myRole, setMyRole] = useState(null) // null | 'viewer' | 'editor' (from app_members, when not the owner)
  const navigate = useNavigate()
  const toast = useToast()

  const isOwner = app.created_by === user?.id
  const isEditor = isOwner || myRole === 'editor'
  const displayTotalRuns = localTotalRuns ?? app.total_runs ?? 0

  useEffect(() => {
    if (isOwner || !user || !app?.id) { setMyRole(null); return }
    supabase.from('app_members').select('role')
      .eq('app_id', app.id).or(`user_id.eq.${user.id},invited_email.eq.${user.email}`)
      .maybeSingle()
      .then(({ data }) => setMyRole(data?.role || null))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the app or user changes
  }, [app?.id, user?.id, isOwner])

  useEffect(() => {
    setCurrentApp(app)
    setRunning(!!app._runNow)
    setDirectRun(!!app._runNow)
    if (app && user) {
      fetchStats()
      checkKeyStatus(app)
    }
    setShowAnalytics(false)
    setConfirmDelete(false)
    setLocalTotalRuns(null)
    setEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when app.id or user changes
  }, [app.id, user])

  function handleRunnerClose() {
    if (directRun) {
      onClose()
      return
    }
    setRunning(false)
  }

  async function checkKeyStatus(a) {
    const provider = a.ai_provider || 'claude'
    const { data } = await supabase.from('user_api_keys')
      .select('id').eq('user_id', user.id).eq('provider', provider).eq('is_active', true).limit(1)
    setKeyStatus(data?.length > 0 ? 'ready' : 'demo')
  }

  async function fetchStats() {
    if (!user || !app) return

    const [{ data: runs }, { data: favs }] = await Promise.all([
      supabase
        .from('run_history')
        .select('created_at, input')
        .eq('app_id', app.id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('favorites')
        .select('app_id')
        .eq('app_id', app.id)
        .eq('user_id', user.id),
    ])

    setStats({
      totalRuns: runs?.length ?? 0,
      favorited: favs?.length > 0,
      lastUsed: runs?.length > 0 ? timeAgo(runs[0].created_at) : 'Never',
      recentRuns: runs?.slice(0, 3) ?? [],
    })
  }

  async function handleDelete() {
    setDeleting(true)
    const { error } = await supabase.from('apps').delete().eq('id', app.id)
    setDeleting(false)
    if (!error) {
      toast(`"${currentApp.name}" deleted`, 'success')
      onDeleted?.(app.id)
      onClose()
    } else {
      toast('Failed to delete app', 'error')
    }
  }

  const runnerPortal = running ? createPortal(
    <Suspense fallback={null}>
      {currentApp.app_type === 'agent'
        ? <AgentRunner    app={currentApp} user={user} onClose={handleRunnerClose} onRun={() => { fetchStats(); setLocalTotalRuns(p => (p ?? currentApp.total_runs ?? 0) + 1); onRun?.(currentApp.id) }} />
        : currentApp.app_type === 'api'
        ? <ApiAppRunner   app={currentApp} user={user} onClose={handleRunnerClose} onRun={() => { fetchStats(); setLocalTotalRuns(p => (p ?? currentApp.total_runs ?? 0) + 1); onRun?.(currentApp.id) }} />
        : currentApp.app_type === 'data'
        ? <DataAppRunner  app={currentApp} user={user} onClose={handleRunnerClose} onRun={() => { fetchStats(); setLocalTotalRuns(p => (p ?? currentApp.total_runs ?? 0) + 1); onRun?.(currentApp.id) }} />
        : currentApp.has_memory
        ? <ConversationThread app={currentApp} user={user} onClose={handleRunnerClose} />
        : currentApp.pages?.length > 0
        ? <MultiPageRunner app={currentApp} user={user} onClose={handleRunnerClose} onRun={() => { fetchStats(); setLocalTotalRuns(prev => (prev ?? currentApp.total_runs ?? 0) + 1); onRun?.(currentApp.id) }} />
        : <AppRunner
        app={currentApp}
        user={user}
        onClose={handleRunnerClose}
        onRun={() => {
          fetchStats()
          setLocalTotalRuns(prev => (prev ?? currentApp.total_runs ?? 0) + 1)
          onRun?.(currentApp.id)
        }}
      />}
    </Suspense>,
    document.body
  ) : null

  if (directRun && running) {
    return runnerPortal
  }

  return (
    <aside className="w-72 bg-[#171B33] border-l border-white/5 flex flex-col shrink-0 overflow-y-auto animate-slide-in" onClick={e => e.stopPropagation()}>
      {editing && (
        <Suspense fallback={null}>
          <CreateAppModal
            user={user}
            existingApp={currentApp}
            onClose={() => setEditing(false)}
            onUpdated={updated => { setCurrentApp(updated); setEditing(false) }}
          />
        </Suspense>
      )}


      {showEmbedModal && createPortal(
        <Suspense fallback={null}>
          <EmbedCodeModal app={currentApp} onClose={() => setShowEmbedModal(false)} />
        </Suspense>,
        document.body
      )}

      {runnerPortal}

      <div className="p-4 border-b border-white/5 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: (currentApp.color || '#6C5CE7') + '33' }}>{currentApp.emoji}</div>
          <div>
            <p className="text-white text-sm font-medium">{currentApp.name}</p>
            <span className="text-[10px] text-green-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Active
              {isOwner && <span className="ml-1 text-[#6C5CE7]">· Yours</span>}
              {!isOwner && myRole && <span className="ml-1 text-[#6C5CE7]">· Shared ({myRole})</span>}
              {currentApp.app_type === 'agent' && <span className="ml-1 text-purple-400">◈ Agent</span>}
              {currentApp.has_memory && <span className="ml-1 text-blue-400">💬 Memory</span>}
            </span>
            <div className="flex gap-1 mt-0.5 flex-wrap">
              {currentApp.is_verified  && <span className="text-[9px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full">✓ Verified</span>}
              {currentApp.is_top_rated && <span className="text-[9px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-full">⭐ Top Rated</span>}
              {currentApp.is_trending  && <span className="text-[9px] text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded-full">🔥 Trending</span>}
              {currentApp.is_new       && <span className="text-[9px] text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-full">🆕 New</span>}
            </div>
          </div>
        </div>
        <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-xs text-slate-400 line-clamp-2 min-h-[2.5rem]">{currentApp.description}</p>

        {/* API key status */}
        {keyStatus === 'ready' && (
          <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 inline-block" />
            Ready to run · your API key active
          </div>
        )}
        {keyStatus === 'demo' && (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/8 border border-amber-400/20 rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 inline-block" />
            Demo mode — add key in Settings → Keys for unlimited runs
          </div>
        )}

        <button
          onClick={() => setRunning(true)}
          className="w-full bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm py-2 rounded-lg font-medium transition-colors"
        >
          Open App ↗
        </button>
        {isEditor && (
          <button
            onClick={() => setEditing(true)}
            className="w-full bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm py-2 rounded-lg transition-colors"
          >
            ✏️ Edit App
          </button>
        )}
        <button
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/app/${currentApp.id}`)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className="w-full bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm py-2 rounded-lg transition-colors"
        >
          {copied ? '✓ Link copied!' : '🔗 Copy Share Link'}
        </button>
        <button
          onClick={() => setShowEmbedModal(true)}
          className="w-full bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm py-2 rounded-lg transition-colors"
        >
          ⬡ Embed this app
        </button>
        <button
          onClick={() => setShowAnalytics(v => !v)}
          className={`w-full text-sm py-2 rounded-lg transition-colors ${showAnalytics ? 'bg-[#6C5CE7]/20 text-[#6C5CE7]' : 'bg-[#1F2444] hover:bg-[#272C52] text-slate-300'}`}
        >
          📊 {showAnalytics ? 'Hide Analytics' : 'View Analytics'}
        </button>
      </div>

      {showAnalytics && <AnalyticsView app={currentApp} user={user} onClose={() => setShowAnalytics(false)} />}

      <div className="px-4 pb-4 border-t border-white/5 pt-4 min-h-[11rem]">
        <p className="text-xs text-slate-500 uppercase mb-3">Overview</p>
        {[
          ["Your runs", stats ? stats.totalRuns : '...'],
          ["Total runs (all users)", displayTotalRuns],
          ["Favorited", stats ? (stats.favorited ? 'Yes ★' : 'No') : '...'],
          ["Last used", stats ? stats.lastUsed : '...'],
          ["AI provider", currentApp.ai_provider === 'openai' ? '🟢 OpenAI' : '🟣 Claude'],
          ["Model", currentApp.ai_model || (currentApp.ai_provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-6')],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs py-1.5 border-b border-white/5">
            <span className="text-slate-400">{k}</span>
            <span className="text-white">{v}</span>
          </div>
        ))}
      </div>

      <div className="px-4 pb-4 border-t border-white/5 pt-4">
        <p className="text-xs text-slate-500 uppercase mb-3">Recent Activity</p>
        {stats?.recentRuns?.length > 0 ? (
          stats.recentRuns.map((run, i) => {
            const activities = [
              { icon: "📄", label: "New report generated" },
              { icon: "🔗", label: "Data source connected" },
              { icon: "🎯", label: "Goal completed" },
            ]
            const activity = activities[i % activities.length]
            return (
              <div key={i} className="flex justify-between items-center text-xs py-1.5">
                <span className="text-slate-300">{activity.icon} {activity.label}</span>
                <span className="text-slate-500">{timeAgo(run.created_at)}</span>
              </div>
            )
          })
        ) : (
          <p className="text-xs text-slate-500">No activity yet — run this app to get started!</p>
        )}
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-6">
          <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-sm p-6 text-center">
            <div className="text-3xl mb-3">⚠️</div>
            <p className="text-white font-semibold mb-1">Delete "{currentApp.name}"?</p>
            <p className="text-slate-400 text-sm mb-6 leading-relaxed">
              This will permanently remove the app and all its tools.<br />
              Run history will be kept. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(false)}
                className="flex-1 bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm py-2.5 rounded-xl transition-colors font-medium">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl transition-colors font-medium">
                {deleting ? 'Deleting...' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isOwner && (
        <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-4">
          <p className="text-[10px] text-slate-500 uppercase mb-1">Developer</p>
          <button onClick={() => navigate(`/app/${currentApp.id}/docs`)}
            className="w-full bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm py-2 rounded-lg transition-colors flex items-center justify-between px-3">
            <span>📖 API Documentation</span><span className="text-slate-500 text-xs">↗</span>
          </button>
          <button onClick={() => setShowTools(v => !v)}
            className={`w-full text-sm py-2 rounded-lg transition-colors px-3 text-left ${showTools ? 'bg-[#6C5CE7]/20 text-[#6C5CE7]' : 'bg-[#1F2444] hover:bg-[#272C52] text-slate-300'}`}>
            🔧 {showTools ? 'Hide tools' : 'Manage tools'}
          </button>
          {showTools && <div className="pb-1"><Suspense fallback={null}><ToolsEditor appId={currentApp.id} /></Suspense></div>}
          <button onClick={() => setShowAccess(v => !v)}
            className={`w-full text-sm py-2 rounded-lg transition-colors px-3 text-left ${showAccess ? 'bg-[#6C5CE7]/20 text-[#6C5CE7]' : 'bg-[#1F2444] hover:bg-[#272C52] text-slate-300'}`}>
            {currentApp.visibility === 'private' ? '🔒' : currentApp.visibility === 'invite' ? '✉️' : '🌐'} Access: {currentApp.visibility || 'public'}
          </button>
          {showAccess && <div className="pb-1"><Suspense fallback={null}><AccessControlPanel app={currentApp} onVisibilityChange={v => setCurrentApp(a => ({ ...a, visibility: v }))} /></Suspense></div>}
          <button onClick={() => setShowVersions(v => !v)}
            className={`w-full text-sm py-2 rounded-lg transition-colors px-3 text-left ${showVersions ? 'bg-[#6C5CE7]/20 text-[#6C5CE7]' : 'bg-[#1F2444] hover:bg-[#272C52] text-slate-300'}`}>
            🕐 {showVersions ? 'Hide versions' : 'Version history'}
          </button>
          {showVersions && <div className="pb-1"><Suspense fallback={null}><VersionHistoryPanel app={currentApp} onRestored={() => setShowVersions(false)} /></Suspense></div>}

          {/* Knowledge Base */}
          <button onClick={() => setShowKB(v => !v)}
            className={`w-full text-sm py-2 rounded-lg transition-colors px-3 text-left ${showKB ? 'bg-[#6C5CE7]/20 text-[#6C5CE7]' : 'bg-[#1F2444] hover:bg-[#272C52] text-slate-300'}`}>
            🧠 {showKB ? 'Hide knowledge base' : 'Knowledge base'}
          </button>
          {showKB && <div className="pb-1"><Suspense fallback={null}><KnowledgeBaseEditor appId={currentApp.id} /></Suspense></div>}

          {/* Records */}
          {currentApp.output_type && currentApp.output_type !== 'markdown' && (
            <>
              <button onClick={() => setShowRecords(v => !v)}
                className={`w-full text-sm py-2 rounded-lg transition-colors px-3 text-left ${showRecords ? 'bg-[#6C5CE7]/20 text-[#6C5CE7]' : 'bg-[#1F2444] hover:bg-[#272C52] text-slate-300'}`}>
                🗂 {showRecords ? 'Hide records' : 'Saved records'}
              </button>
              {showRecords && <div className="pb-1"><Suspense fallback={null}><AppRecordsViewer app={currentApp} user={user} /></Suspense></div>}
            </>
          )}

          {/* Embed — now handled by the modal button in the main actions section */}

          <button onClick={() => setConfirmDelete(true)}
            className="w-full border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm py-2 rounded-lg transition-colors mt-2">
            Delete App
          </button>
        </div>
      )}
    </aside>
  )
}
