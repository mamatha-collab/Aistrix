import { useState } from 'react'
import { useTodayProgress } from './flowUtils'

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const TAB_VISIBLE = 2

export function WorkflowTab({ flow, onRun, onEdit, onDelete, schedule, userId, role, lastRun }) {
  const steps = flow.steps || []
  const isOwner = !role || role === 'owner'
  const [startIdx, setStartIdx] = useState(0)
  const pageSteps = steps.slice(startIdx, startIdx + TAB_VISIBLE)
  const canPrev = startIdx > 0
  const canNext = startIdx + TAB_VISIBLE < steps.length
  const { done, total } = useTodayProgress(flow, userId)
  const isEmpty = steps.length === 0

  if (isEmpty) {
    return (
      <div className="group relative bg-[#121829] border border-amber-400/30 rounded-xl p-3 flex flex-col gap-2 min-h-[100px]">
        {isOwner && (
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="absolute top-1.5 right-1.5 text-[9px] text-slate-500 hover:text-red-400 transition-colors p-0.5">🗑</button>
        )}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md flex items-center justify-center text-sm shrink-0 bg-amber-400/10">{flow.emoji}</div>
          <p className="text-white text-xs font-semibold leading-snug flex-1 min-w-0 truncate">{flow.name}</p>
        </div>
        <p className="text-[9px] text-amber-400">⚠ No steps — apps not found in your library</p>
      </div>
    )
  }

  return (
    <div
      className="group relative bg-[#121829] border border-white/20 hover:border-white/20 hover:bg-[#182030] hover:shadow-xl hover:shadow-black/30 rounded-xl p-3 cursor-pointer transition-all flex flex-col gap-2"
      onClick={onRun}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRun() } }}
    >
      {isOwner && (
        <div className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center z-10">
          <button onClick={e => { e.stopPropagation(); onEdit() }}
            className="p-0.5 text-[9px] text-slate-400 hover:text-white transition-colors">✏️</button>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="p-0.5 text-[9px] text-slate-400 hover:text-red-400 transition-colors">🗑</button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md flex items-center justify-center text-sm shrink-0"
          style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.25), rgba(232,67,147,0.18))' }}>
          {flow.emoji}
        </div>
        <p className="text-white text-xs font-semibold leading-snug line-clamp-2 flex-1 min-w-0" title={flow.name}>{flow.name}</p>
      </div>

      <div className="flex items-center gap-1 overflow-hidden min-w-0">
        {pageSteps.map((s, i) => (
          <div key={startIdx + i} className="flex items-center gap-1 min-w-0" style={{ flexShrink: i === 0 ? 2 : 1 }}>
            <div className="flex items-center gap-1 bg-[#1A2038] border border-white/18 px-1.5 py-0.5 rounded-md min-w-0 overflow-hidden">
              {s.app_icon && <img src={s.app_icon} alt="" className="w-3 h-3 rounded-sm shrink-0" />}
              <span className="text-[9px] text-slate-200 truncate">{s.app_name}</span>
            </div>
            {i < pageSteps.length - 1 && (
              <span className="flow-connector" style={{ animationDelay: `${i * 0.5}s`, width: '14px' }} />
            )}
          </div>
        ))}
        {canNext && <span className="text-slate-400 text-[9px] shrink-0">…</span>}
      </div>

      <p className="text-[9px] text-slate-500">
        {lastRun ? `Last run ${timeAgo(lastRun.created_at)}` : 'Never run'}
      </p>

      <div className="flex items-center gap-1.5 mt-auto">
        <span className="text-[9px] text-slate-400 shrink-0">
          ⚡ {steps.length}
          {schedule?.enabled && <span className="text-amber-400 ml-1">⏰</span>}
          {flow.is_published && <span className="text-green-400 ml-1">●</span>}
        </span>
        <div className="flex items-center gap-1 flex-1 justify-center">
          <button onClick={e => { e.stopPropagation(); setStartIdx(i => Math.max(0, i - TAB_VISIBLE)) }}
            disabled={!canPrev}
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] text-slate-400 hover:text-white hover:bg-white/8 transition-all ${!canPrev ? 'opacity-25 cursor-default' : ''}`}>‹</button>
          <button onClick={e => { e.stopPropagation(); onRun() }}
            className="workflow-action-button relative overflow-hidden text-[10px] px-3 py-1 rounded-md font-semibold shrink-0 transition-all"
            style={{ background: 'linear-gradient(135deg, #6C5CE7, #8B5CF6)' }}>
            <span className="relative z-10">▶ Run</span>
            <span className="absolute inset-0 rounded-md" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 60%)', pointerEvents: 'none' }} />
          </button>
          <button onClick={e => { e.stopPropagation(); setStartIdx(i => Math.min(steps.length - TAB_VISIBLE, i + TAB_VISIBLE)) }}
            disabled={!canNext}
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] text-slate-400 hover:text-white hover:bg-white/8 transition-all ${!canNext ? 'opacity-25 cursor-default' : ''}`}>›</button>
        </div>
        <div className="shrink-0"><CircleProgress done={done} total={total} /></div>
      </div>
    </div>
  )
}

function CircleProgress({ done, total }) {
  const r = 8
  const circ = 2 * Math.PI * r
  const pct = total > 0 ? done / total : 0
  const allDone = total > 0 && done === total
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0" title={total > 0 ? `${done}/${total} steps run today` : 'No runs today'}>
      <circle cx="10" cy="10" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
      {done > 0 && (
        <circle cx="10" cy="10" r={r} fill="none"
          stroke={allDone ? '#22c55e' : '#6C5CE7'}
          strokeWidth="2.5"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform="rotate(-90 10 10)"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      )}
    </svg>
  )
}

const STEP_VISIBLE = 3
const STEP_ADVANCE = 2

export default function WorkspaceCard({ flow, onRun, onEdit, onDelete, onPublish, onShare, onSchedule, onWebhook, schedule, userId, role, lastRun, suggestStart }) {
  const steps = flow.steps || []
  const isOwner = !role || role === 'owner'
  const [startIdx, setStartIdx] = useState(0)
  const pageSteps = steps.slice(startIdx, startIdx + STEP_VISIBLE)
  const canPrev = startIdx > 0
  const canNext = startIdx + STEP_VISIBLE < steps.length
  const hasNextPage = canNext
  const { done, total } = useTodayProgress(flow, userId)

  const isEmpty = steps.length === 0
  const status = isEmpty ? 'incomplete'
    : schedule?.enabled ? 'scheduled'
    : flow.is_published ? 'published'
    : 'active'

  const STATUS_STYLES = {
    incomplete: { dot: 'bg-amber-400', label: 'Incomplete', labelClass: 'text-amber-400' },
    scheduled:  { dot: 'bg-blue-400',  label: 'Scheduled',  labelClass: 'text-blue-400'  },
    published:  { dot: 'bg-green-400', label: 'Published',  labelClass: 'text-green-400' },
    active:     { dot: 'bg-green-400', label: 'Active',     labelClass: 'text-green-400' },
  }
  const st = STATUS_STYLES[status]

  return (
    <div className={`relative border rounded-lg overflow-hidden transition-all group flex flex-col h-full ${
      isEmpty
        ? 'bg-[#121829] border-amber-400/30'
        : suggestStart
          ? 'bg-[#121829] border-[#6C5CE7]/60 shadow-lg shadow-[#6C5CE7]/15 hover:border-[#6C5CE7]/80 hover:bg-[#182030]'
          : 'bg-[#121829] border-white/20 hover:border-white/30 hover:bg-[#182030] hover:shadow-xl hover:shadow-black/30'
    }`}>
      {suggestStart && (
        <div className="absolute top-0 left-0 right-0 flex items-center justify-center gap-1.5 bg-[#6C5CE7]/20 border-b border-[#6C5CE7]/30 py-1 z-10">
          <span className="text-[10px] text-[#a89cf7] font-semibold tracking-wide">✦ Start here — run this first</span>
        </div>
      )}
      <div className={`p-4 flex flex-col flex-1 relative ${suggestStart ? 'pt-8' : ''}`}>

        {isEmpty && (
          <div className="absolute inset-0 bg-amber-400/5 flex flex-col items-center justify-center p-4 text-center rounded-xl">
            <span className="text-2xl mb-2">⚠</span>
            <p className="text-amber-400 text-xs font-semibold mb-1">No steps installed</p>
            <p className="text-slate-400 text-[10px] leading-relaxed mb-3">
              The apps for this workflow weren't found in your library. Add the required apps, then delete and reinstall this workflow.
            </p>
            <button onClick={onDelete}
              className="text-[10px] text-slate-500 hover:text-red-400 underline underline-offset-2 transition-colors">
              Remove workflow
            </button>
          </div>
        )}

        {!isEmpty && (
          <>
            <div className="flex items-start justify-between mb-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                  style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.28), rgba(232,67,147,0.18))' }}>
                  {flow.emoji}
                </div>
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm leading-tight truncate">{flow.name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate leading-snug">
                    {flow.description || steps.map(s => s.app_name).join(' → ')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {isOwner && (
                  <>
                    <button onClick={onShare} title="Share" className="p-1 rounded-md text-xs text-slate-400 hover:text-white hover:bg-white/8 transition-colors">👥</button>
                    <button onClick={onSchedule} title="Schedule"
                      className={`p-1 rounded-md text-xs transition-colors hover:bg-white/8 ${schedule?.enabled ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'}`}>⏰</button>
                    <button onClick={onWebhook} title="Webhook / API trigger"
                      className={`p-1 rounded-md text-xs transition-colors hover:bg-white/8 ${flow.webhook_token ? 'text-[#0984E3]' : 'text-slate-400 hover:text-[#0984E3]'}`}>🔗</button>
                    <button onClick={onPublish} title={flow.is_published ? 'Unpublish' : 'Publish'}
                      className={`p-1 rounded-md text-xs transition-colors hover:bg-white/8 ${flow.is_published ? 'text-green-400' : 'text-slate-400 hover:text-green-400'}`}>🌐</button>
                  </>
                )}
                {(isOwner || role === 'editor') && (
                  <button onClick={onEdit} className="p-1 rounded-md text-xs text-slate-400 hover:text-white hover:bg-white/8 transition-colors">✏️</button>
                )}
                {isOwner && (
                  <button onClick={onDelete} className="p-1 rounded-md text-xs text-slate-400 hover:text-red-400 hover:bg-red-400/5 transition-colors">🗑</button>
                )}
              </div>
            </div>

            <div className="relative overflow-hidden flex-1 mb-3 mt-1">
              <div className="flex items-center gap-1 overflow-hidden">
                {pageSteps.map((s, i) => (
                  <div key={startIdx + i} className="flex items-center gap-1 shrink-0">
                    <div className="flex items-center gap-1 bg-[#1A2038] border border-white/18 px-1.5 py-1 rounded-md">
                      <span className="text-[11px]">{s.app_emoji}</span>
                      <span className="text-[10px] text-slate-200 whitespace-nowrap">{s.app_name}</span>
                    </div>
                    {i < pageSteps.length - 1 && (
                      <span className="flow-connector" style={{ animationDelay: `${i * 0.5}s` }} />
                    )}
                  </div>
                ))}
              </div>
              {hasNextPage && (
                <div className="absolute right-0 top-0 bottom-0 w-10 pointer-events-none"
                  style={{ background: 'linear-gradient(to right, transparent, #121829)' }} />
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-2 flex-wrap">
              <span className={`flex items-center gap-1 ${st.labelClass}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                {st.label}
              </span>
              <span>·</span>
              <span>{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
              <span>·</span>
              <span>{lastRun ? `Last run ${timeAgo(lastRun.created_at)}` : 'Never run'}</span>
            </div>

            {(() => {
              const allReady   = steps.length > 0 && steps.every(s => s.app_id)
              const hasTested  = !!lastRun
              const hasInputs  = steps.some(s => s.step_fields?.length)
              const connected  = !!(flow.webhook_token || flow.integration_webhook_url || schedule?.enabled)
              const badges = [
                allReady  && { label: 'Ready',     color: '#00B894' },
                hasTested && { label: 'Tested',    color: '#0984E3' },
                hasInputs && { label: 'Has inputs', color: '#6C5CE7' },
                connected && { label: 'Connected',  color: '#FDCB6E' },
              ].filter(Boolean)
              return badges.length > 0 ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {badges.map(b => (
                    <span key={b.label}
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md"
                      style={{ background: b.color + '18', color: b.color, border: `1px solid ${b.color}33` }}>
                      ✓ {b.label}
                    </span>
                  ))}
                </div>
              ) : null
            })()}

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 flex-1 justify-center">
                <button onClick={e => { e.stopPropagation(); setStartIdx(i => Math.max(0, i - STEP_ADVANCE)) }}
                  disabled={!canPrev}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-sm text-slate-400 hover:text-white bg-[#1A2038] hover:bg-white/10 border border-white/18 disabled:opacity-25 disabled:cursor-default transition-all shrink-0">
                  ‹
                </button>
                <button onClick={onRun}
                  className="workflow-action-button relative overflow-hidden text-xs px-5 py-1.5 rounded-lg font-semibold transition-all shrink-0"
                  style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.7) 0%, rgba(162,155,254,0.5) 40%, rgba(108,92,231,0.65) 100%)' }}>
                  <span className="relative z-10">▶ Run workflow</span>
                  <span className="absolute inset-0 rounded-lg" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%)', pointerEvents: 'none' }} />
                </button>
                <button onClick={e => { e.stopPropagation(); setStartIdx(i => Math.min(steps.length - STEP_VISIBLE, i + STEP_ADVANCE)) }}
                  disabled={!canNext}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-sm text-slate-400 hover:text-white bg-[#1A2038] hover:bg-white/10 border border-white/18 disabled:opacity-25 disabled:cursor-default transition-all shrink-0">
                  ›
                </button>
              </div>
              <div className="shrink-0">
                <CircleProgress done={done} total={total} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
