import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import FlowRunner from '../flows/FlowRunner'
import FlowBuilderModal from '../flows/FlowBuilderModal'
import { ShareModal, WebhookModal, ScheduleModal } from '../flows/FlowModals'
import WorkspaceCard, { WorkflowTab } from '../flows/WorkspaceCard'
import QuickStartTemplates, { PACK_COLORS, PACK_ICONS } from '../flows/QuickStartTemplates'
import { GoalLauncher, WorkflowSuggestionsPanel } from '../flows/GoalLauncher'
import { TEMPLATE_PACKS } from '../flows/flowConstants'

export default function FlowsPage({ user, onShowHistory }) {
  const [flows, setFlows] = useState([])
  const [apps, setApps] = useState([])
  const [domains, setDomains] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState(null)
  const [editingFlow, setEditingFlow] = useState(null)
  const [runningFlow, setRunningFlow] = useState(null)
  const [runningFlowCallback, setRunningFlowCallback] = useState(null)
  const [deletedFlowId, setDeletedFlowId] = useState(null)
  const [tab, setTab] = useState('mine')
  const [flowSearch, setFlowSearch] = useState('')
  const [flowViewMode, setFlowViewMode] = useState(() => localStorage.getItem('aistrix:flowViewMode') || 'cards')
  const [activePack, setActivePack] = useState('General')
  const [publicFlows, setPublicFlows] = useState([])
  const [loadingPublic, setLoadingPublic] = useState(false)
  const [sharedFlows, setSharedFlows] = useState([])
  const [sharedRoles, setSharedRoles] = useState({})
  const [loadingShared, setLoadingShared] = useState(false)
  const [sharingFlow, setSharingFlow] = useState(null)
  const [schedulingFlow, setSchedulingFlow] = useState(null)
  const [webhookFlow, setWebhookFlow] = useState(null)
  const [schedules, setSchedules] = useState({})
  const [prefillStep, setPrefillStep] = useState(null)
  const toast = useToast()

  useEffect(() => {
    const handler = () => { setMode('create'); setEditingFlow(null); setPrefillStep(null) }
    window.addEventListener('aistrix:new-workflow', handler)
    return () => window.removeEventListener('aistrix:new-workflow', handler)
  }, [])

  useEffect(() => {
    const handler = e => {
      const app = e.detail
      setMode('create'); setEditingFlow(null)
      setPrefillStep(app ? { app_id: app.id, app_name: app.name, app_emoji: app.emoji } : null)
    }
    window.addEventListener('aistrix:workflow-from-app', handler)
    return () => window.removeEventListener('aistrix:workflow-from-app', handler)
  }, [])

  useEffect(() => {
    supabase.from('flow_schedules').select('*').eq('user_id', user.id)
      .then(({ data }) => setSchedules(Object.fromEntries((data || []).map(s => [s.flow_id, s]))))
  }, [user.id])

  const [flowLastRuns, setFlowLastRuns] = useState({})

  useEffect(() => {
    Promise.all([
      supabase.from('flows').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('apps').select('id, name, emoji, color, domain_id, domains(id, name, emoji)').order('name'),
      supabase.from('domains').select('id, name, emoji, color').order('name'),
    ]).then(async ([{ data: f }, { data: a }, { data: d }]) => {
      setFlows(f ?? []); setApps(a ?? []); setDomains(d ?? []); setLoading(false)
      if (f?.length) {
        const flowIds = f.map(fl => fl.id)
        const { data: runs } = await supabase.from('run_history')
          .select('flow_id, created_at, app_name')
          .eq('user_id', user.id)
          .in('flow_id', flowIds)
          .order('created_at', { ascending: false })
        if (runs) {
          const map = {}
          for (const r of runs) {
            if (!map[r.flow_id]) map[r.flow_id] = r
          }
          setFlowLastRuns(map)
        }
      }
    })
  }, [user.id])

  async function loadShared() {
    setLoadingShared(true)
    const { data: memberships } = await supabase.from('flow_members').select('flow_id, role')
      .or(`user_id.eq.${user.id},invited_email.eq.${user.email}`)
    const ids = [...new Set((memberships || []).map(m => m.flow_id))]
    const roles = {}
    for (const m of memberships || []) roles[m.flow_id] = m.role
    setSharedRoles(roles)
    if (!ids.length) { setSharedFlows([]); setLoadingShared(false); return }
    const { data } = await supabase.from('flows').select('*').in('id', ids)
    setSharedFlows(data || [])
    setLoadingShared(false)
  }

  async function saveFlow(data) {
    if (editingFlow) {
      const { data: row, error } = await supabase.from('flows').update(data).eq('id', editingFlow.id).select().single()
      if (error) { toast(error.message, 'error'); return }
      setFlows(p => p.map(f => f.id === editingFlow.id ? row : f))
      setSharedFlows(p => p.map(f => f.id === editingFlow.id ? row : f))
      toast('Workflow updated', 'success')
    } else {
      const { data: row, error } = await supabase.from('flows').insert({ ...data, user_id: user.id }).select().single()
      if (error) { toast(error.message, 'error'); return }
      setFlows(p => [row, ...p])
      toast('Workflow created', 'success')
    }
    setMode(null); setEditingFlow(null); setPrefillStep(null)
  }

  async function deleteFlow(id) {
    if (!confirm('Delete this workflow?')) return
    const { error } = await supabase.from('flows').delete().eq('id', id)
    if (error) { toast(`Couldn't delete workflow: ${error.message}`, 'error'); return }
    setFlows(p => p.filter(f => f.id !== id))
    setDeletedFlowId(id)
    toast('Workflow deleted', 'info', 2000)
  }

  async function loadMarketplace() {
    setLoadingPublic(true)
    const { data } = await supabase.from('flows').select('*').eq('is_published', true).order('install_count', { ascending: false }).limit(20)
    setPublicFlows(data || []); setLoadingPublic(false)
  }

  async function installWorkspace(flow) {
    const { error } = await supabase.from('flows').insert({
      user_id: user.id, name: flow.name, emoji: flow.emoji, description: flow.description, steps: flow.steps,
    })
    if (error) { toast(`Couldn't install "${flow.name}": ${error.message}`, 'error'); return }
    await supabase.from('flows').update({ install_count: (flow.install_count || 0) + 1 }).eq('id', flow.id)
    toast(`"${flow.name}" installed`, 'success')
    const { data } = await supabase.from('flows').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    if (data) setFlows(data)
    setTab('mine')
  }

  async function publishWorkspace(flow) {
    const { error } = await supabase.from('flows').update({ is_published: !flow.is_published }).eq('id', flow.id)
    if (error) { toast(error.message, 'error'); return }
    setFlows(p => p.map(f => f.id === flow.id ? { ...f, is_published: !f.is_published } : f))
    toast(flow.is_published ? 'Unpublished' : 'Published to marketplace', 'success')
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {runningFlow && <FlowRunner
        flow={runningFlow}
        user={user}
        onClose={() => {
          runningFlowCallback?.(false)
          setRunningFlow(null)
          setRunningFlowCallback(null)
        }}
        onShowHistory={onShowHistory}
        onRunComplete={success => {
          if (success) {
            runningFlowCallback?.(true)
            setRunningFlowCallback(null)
          }
        }}
      />}
      {sharingFlow && <ShareModal flow={sharingFlow} onClose={() => setSharingFlow(null)} />}
      {schedulingFlow && (
        <ScheduleModal flow={schedulingFlow} userId={user.id} onClose={() => setSchedulingFlow(null)}
          onSaved={row => setSchedules(p => {
            const next = { ...p }
            if (row) next[schedulingFlow.id] = row
            else delete next[schedulingFlow.id]
            return next
          })} />
      )}
      {webhookFlow && (
        <WebhookModal flow={webhookFlow} onClose={() => setWebhookFlow(null)}
          onUpdated={updated => {
            setFlows(prev => prev.map(f => f.id === updated.id ? updated : f))
            setWebhookFlow(updated)
          }} />
      )}
      {mode && (
        <FlowBuilderModal
          apps={apps}
          domains={domains}
          existingFlow={editingFlow}
          initialSteps={prefillStep ? [prefillStep] : undefined}
          onSave={saveFlow}
          onCancel={() => { setMode(null); setEditingFlow(null); setPrefillStep(null) }}
        />
      )}

      {/* Fixed top area */}
      <div className="shrink-0 px-6 pt-6 relative z-10 bg-[var(--app-bg)]">
        <div className="section-tab-row flex items-center justify-between">
          <div className="section-tabs">
            <button onClick={() => setTab('mine')}
              className={`section-tab ${tab === 'mine' ? 'section-tab-active' : ''}`}>
              <span className="section-tab-label">My Workflows</span>
              {flows.length > 0 && <span className="section-tab-count">{flows.length}</span>}
              🗂 My Workflows {flows.length > 0 && <span className="ml-1.5 opacity-70">{flows.length}</span>}
            </button>
            <button onClick={() => { setTab('shared'); loadShared() }}
              className={`section-tab ${tab === 'shared' ? 'section-tab-active' : ''}`}>
              <span className="section-tab-label">Shared</span>
              {sharedFlows.length > 0 && <span className="section-tab-count">{sharedFlows.length}</span>}
              👥 Shared {sharedFlows.length > 0 && <span className="ml-1.5 opacity-70">{sharedFlows.length}</span>}
            </button>
            <button onClick={() => { setTab('marketplace'); loadMarketplace() }}
              className={`section-tab ${tab === 'marketplace' ? 'section-tab-active' : ''}`}>
              <span className="section-tab-label">Marketplace</span>
              🌐 Marketplace
            </button>
          </div>
        </div>

        {tab === 'mine' && (
          <GoalLauncher
            apps={apps}
            flows={flows}
            userId={user.id}
            onInstalled={row => setFlows(p => [row, ...p])}
            onRunFlow={flow => setRunningFlow(flow)}
          />
        )}
        {tab === 'mine' && (
          <QuickStartTemplates
            apps={apps}
            flows={flows}
            userId={user.id}
            onCreated={row => setFlows(p => [row, ...p])}
            deletedFlowId={deletedFlowId}
            onRunFlow={(flow, cb) => { setRunningFlow(flow); setRunningFlowCallback(() => cb) }}
            activePack={activePack}
          />
        )}
        {tab === 'mine' && !loading && flows.length > 0 && (
          <WorkflowSuggestionsPanel
            flows={flows}
            flowLastRuns={flowLastRuns}
            schedules={schedules}
            onRun={flow => setRunningFlow(flow)}
            onCreate={() => { setMode('create'); setEditingFlow(null) }}
            onShowHistory={onShowHistory}
          />
        )}

        {tab === 'mine' && !loading && flows.length > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <h2 className="text-white font-semibold text-base shrink-0">My Workflows</h2>
            <div className="flex gap-1.5 flex-wrap">
              {TEMPLATE_PACKS.map(pack => (
                <button key={pack}
                  onClick={() => setActivePack(pack)}
                  className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-lg text-xs font-medium transition-all ${activePack === pack
                    ? 'text-white border'
                    : 'bg-[#1A2038] text-slate-400 hover:text-white border border-white/10'}`}
                  style={activePack === pack ? { background: PACK_COLORS[pack] + '33', borderColor: PACK_COLORS[pack] + '66' } : {}}>
                  <span>{PACK_ICONS[pack]}</span>
                  <span>{pack}</span>
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <div className="relative shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
              <input
                value={flowSearch}
                onChange={e => setFlowSearch(e.target.value)}
                placeholder="Search workflows..."
                className="w-40 bg-[#1A2038] border border-white/20 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors"
              />
            </div>
            <div className="flex items-center bg-[#1A2038] border border-white/20 rounded-lg p-0.5 shrink-0">
              <button onClick={() => { setFlowViewMode('compact'); localStorage.setItem('aistrix:flowViewMode', 'compact') }}
                title="Compact tiles" aria-label="Compact tiles view"
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${flowViewMode === 'compact' ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
                <span aria-hidden="true">▦</span>
              </button>
              <button onClick={() => { setFlowViewMode('cards'); localStorage.setItem('aistrix:flowViewMode', 'cards') }}
                title="Detailed cards" aria-label="Detailed cards view"
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${flowViewMode === 'cards' ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
                <span aria-hidden="true">▤</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable area */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">

        {tab === 'mine' && (
          loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-slate-400 text-sm">Loading workflows...</p>
            </div>
          ) : flows.length === 0 ? (
            <div className="relative border border-dashed border-white/18 rounded-2xl p-10 text-center overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[#6C5CE7]/5 via-transparent to-[#E84393]/5 pointer-events-none" />
              <div className="relative">
                <p className="text-white font-semibold mb-1">No workflows yet</p>
                <p className="text-slate-400 text-sm mb-4">Install a template to get started in seconds.</p>
                <button onClick={() => { setMode('create'); setEditingFlow(null) }}
                  className="text-xs text-slate-400 hover:text-slate-300 transition-colors underline underline-offset-2">
                  or build one from scratch
                </button>
              </div>
            </div>
          ) : flowViewMode === 'compact' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {flows.filter(f => !flowSearch || f.name.toLowerCase().includes(flowSearch.toLowerCase()) || f.description?.toLowerCase().includes(flowSearch.toLowerCase())).map(flow => (
                <WorkflowTab
                  key={flow.id}
                  flow={flow}
                  userId={user.id}
                  lastRun={flowLastRuns[flow.id] || null}
                  onRun={() => setRunningFlow(flow)}
                  onEdit={() => { setEditingFlow(flow); setMode('edit') }}
                  onDelete={() => deleteFlow(flow.id)}
                  schedule={schedules[flow.id]}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {(() => {
                const neverRun = Object.keys(flowLastRuns).length === 0
                const filtered = flows.filter(f => !flowSearch || f.name.toLowerCase().includes(flowSearch.toLowerCase()) || f.description?.toLowerCase().includes(flowSearch.toLowerCase()))
                return filtered.map((flow, idx) => (
                  <WorkspaceCard
                    key={flow.id}
                    flow={flow}
                    userId={user.id}
                    lastRun={flowLastRuns[flow.id] || null}
                    suggestStart={neverRun && idx === 0}
                    onRun={() => setRunningFlow(flow)}
                    onEdit={() => { setEditingFlow(flow); setMode('edit') }}
                    onDelete={() => deleteFlow(flow.id)}
                    onPublish={() => publishWorkspace(flow)}
                    onShare={() => setSharingFlow(flow)}
                    onSchedule={() => setSchedulingFlow(flow)}
                    onWebhook={() => setWebhookFlow(flow)}
                    schedule={schedules[flow.id]}
                  />
                ))
              })()}
            </div>
          )
        )}

        {tab === 'shared' && (
          loadingShared ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-slate-400 text-sm">Loading shared workflows...</p>
            </div>
          ) : sharedFlows.length === 0 ? (
            <div className="border border-dashed border-white/18 rounded-2xl p-12 text-center">
              <div className="text-4xl mb-3">👥</div>
              <p className="text-white font-medium mb-1">No workflows shared with you yet</p>
              <p className="text-slate-400 text-sm">Ask a teammate to invite you via the 👥 icon on one of their workflows.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {sharedFlows.filter(f => !flowSearch || f.name.toLowerCase().includes(flowSearch.toLowerCase())).map(flow => (
                <WorkspaceCard
                  key={flow.id}
                  flow={flow}
                  userId={user.id}
                  role={sharedRoles[flow.id]}
                  onRun={() => setRunningFlow(flow)}
                  onEdit={() => { setEditingFlow(flow); setMode('edit') }}
                />
              ))}
            </div>
          )
        )}

        {tab === 'marketplace' && (
          loadingPublic ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-slate-400 text-sm">Loading...</p>
            </div>
          ) : publicFlows.length === 0 ? (
            <div className="border border-dashed border-white/18 rounded-2xl p-12 text-center">
              <div className="text-4xl mb-3">🌐</div>
              <p className="text-white font-medium mb-1">No public workflows yet</p>
              <p className="text-slate-400 text-sm">Create a workflow and publish it to share with others.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {publicFlows.filter(f => !flowSearch || f.name.toLowerCase().includes(flowSearch.toLowerCase())).map(flow => (
                <div key={flow.id} className="relative bg-[#121829] border border-white/18 hover:border-white/18 rounded-2xl overflow-hidden p-5 transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                      style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.25), rgba(232,67,147,0.18))' }}>{flow.emoji}</div>
                    <div>
                      <p className="text-white font-semibold text-sm">{flow.name}</p>
                      <p className="text-[11px] text-slate-300">{flow.steps?.length || 0} steps · ⬇ {flow.install_count || 0} installs</p>
                    </div>
                  </div>
                  {flow.description && <p className="text-xs text-slate-400 mb-3 leading-relaxed">{flow.description}</p>}
                  <div className="flex gap-1 mb-4 flex-wrap">
                    {(flow.steps || []).map((s, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="text-[10px] bg-[#1A2038] text-slate-400 px-2 py-1 rounded-lg">{s.app_emoji} {s.app_name}</span>
                        {i < flow.steps.length - 1 && <span className="text-[#6C5CE7]/50 text-xs">→</span>}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => installWorkspace(flow)}
                    className="w-full bg-gradient-to-r from-[#6C5CE7] to-[#8B7CF6] hover:from-[#7D6FF0] hover:to-[#9C8FFF] text-white text-sm py-2.5 rounded-xl font-semibold transition-all shadow-md shadow-[#6C5CE7]/20">
                    ↓ Install workflow
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
