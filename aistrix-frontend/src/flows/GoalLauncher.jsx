import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { QUICK_START_TEMPLATES, PACK_COLORS } from './flowConstants'

export function GoalLauncher({ apps, flows, userId, onInstalled, onRunFlow }) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [installing, setInstalling] = useState(null)
  const toast = useToast()

  const suggestions = query.trim().length < 2 ? [] : (() => {
    const q = query.toLowerCase()
    return QUICK_START_TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.desc.toLowerCase().includes(q) ||
      t.appNames.some(a => a.toLowerCase().includes(q)) ||
      t.pack.toLowerCase().includes(q)
    ).slice(0, 5)
  })()

  async function installGoal(tpl) {
    const already = flows.find(f => f.name === tpl.name)
    if (already) { onRunFlow?.(already); setQuery(''); setFocused(false); return }
    setInstalling(tpl.name)
    try {
      const steps = tpl.appNames.map(name => {
        const lower = name.toLowerCase()
        const match = apps.find(a => a.name.toLowerCase() === lower)
          || apps.find(a => a.name.toLowerCase().includes(lower) || lower.includes(a.name.toLowerCase()))
        return match ? { app_id: match.id, app_name: match.name, app_emoji: match.emoji } : null
      }).filter(Boolean)
      const { data, error } = await supabase.from('flows').insert({
        user_id: userId, name: tpl.name, emoji: tpl.emoji, description: tpl.desc, steps,
      }).select().single()
      if (error) throw error
      onInstalled(data)
      toast(`"${tpl.name}" ready — ${steps.length} steps`, 'success')
      setQuery(''); setFocused(false)
    } catch (e) { toast(e.message || 'Install failed', 'error') }
    finally { setInstalling(null) }
  }

  return (
    <div className="mb-4 relative">
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-base">🎯</span>
        <input
          className="w-full bg-[#1A2038] border border-white/20 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors"
          placeholder="What do you want to automate today? e.g. follow-up emails, screen resumes, write proposals…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
        {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-lg leading-none">✕</button>}
      </div>
      {focused && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#121829] border border-white/20 rounded-xl overflow-hidden z-30 shadow-2xl">
          {suggestions.map(tpl => {
            const color = PACK_COLORS[tpl.pack]
            const isInstalling = installing === tpl.name
            const alreadyInstalled = !!flows.find(f => f.name === tpl.name)
            return (
              <div key={tpl.name} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 border-b border-white/8 last:border-0 transition-colors">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                  style={{ background: color + '22' }}>{tpl.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold">{tpl.name}
                    <span className="ml-1.5 text-[10px] font-normal px-1.5 py-0.5 rounded" style={{ background: color + '22', color }}>
                      {tpl.pack}
                    </span>
                  </p>
                  <p className="text-slate-400 text-[11px] truncate">{tpl.appNames.join(' → ')}</p>
                </div>
                <button
                  onClick={() => installGoal(tpl)}
                  disabled={isInstalling}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all disabled:opacity-50"
                  style={{ background: color + '22', color, border: `1px solid ${color}44` }}>
                  {isInstalling ? '⟳' : alreadyInstalled ? '▶ Run' : '+ Use this'}
                </button>
              </div>
            )
          })}
        </div>
      )}
      {focused && query.trim().length >= 2 && suggestions.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#121829] border border-white/20 rounded-xl px-4 py-3 z-30 shadow-xl">
          <p className="text-slate-400 text-xs">No matching templates — <button className="text-[#6C5CE7] hover:underline" onClick={() => { setQuery(''); setFocused(false) }}>build a custom workflow</button></p>
        </div>
      )}
    </div>
  )
}

export function WorkflowSuggestionsPanel({ flows, flowLastRuns, schedules, onRun, onCreate, onShowHistory }) {
  const recommendedFlow = (() => {
    const neverRun = flows.find(flow => !flowLastRuns[flow.id])
    if (neverRun) {
      return {
        flow: neverRun,
        reason: 'Ready for a first full test',
        detail: 'Run this once so users can trust it before depending on it.'
      }
    }

    const stale = flows.find(flow => {
      const lastRun = flowLastRuns[flow.id]
      if (!lastRun) return false
      return Date.now() - new Date(lastRun.created_at).getTime() > 14 * 24 * 60 * 60 * 1000
    })
    if (stale) {
      return {
        flow: stale,
        reason: 'Due for a fresh run',
        detail: 'It has been more than two weeks since this workflow was tested.'
      }
    }

    const manualOnly = flows.find(flow => !schedules[flow.id])
    if (manualOnly) {
      return {
        flow: manualOnly,
        reason: 'Candidate for automation',
        detail: 'Add a schedule once the workflow output is consistently useful.'
      }
    }

    return flows[0] ? {
      flow: flows[0],
      reason: 'Keep the system warm',
      detail: 'Run a proven workflow and check the latest output quality.'
    } : null
  })()

  if (!recommendedFlow) return null

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-[#12182A] p-4 shadow-[0_14px_40px_rgba(0,0,0,0.18)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-semibold text-[#A29BFE]">AI recommended next action</div>
          <h3 className="mt-1 text-white font-semibold text-lg">{recommendedFlow.flow.name}</h3>
          <p className="mt-1 text-sm text-slate-300">
            <span className="text-white">{recommendedFlow.reason}.</span> {recommendedFlow.detail}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onRun(recommendedFlow.flow)}
            className="px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#5a4bd1] text-white text-sm font-semibold transition-all"
          >
            Run suggested workflow
          </button>
          <button
            onClick={onCreate}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white text-sm font-semibold transition-all"
          >
            Design new workflow
          </button>
          <button
            onClick={onShowHistory}
            className="px-4 py-2 rounded-lg bg-transparent hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-semibold transition-all"
          >
            Review history
          </button>
        </div>
      </div>
    </div>
  )
}
