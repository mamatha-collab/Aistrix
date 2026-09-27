import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { QUICK_START_TEMPLATES, PACK_COLORS, PACK_ICONS } from './flowConstants'

export { PACK_COLORS, PACK_ICONS }

export default function QuickStartTemplates({ apps, flows, onCreated, userId, deletedFlowId, onRunFlow, activePack }) {
  const [installing, setInstalling] = useState(null)
  const [installed, setInstalled] = useState({})
  const [tested, setTested] = useState(new Set())
  const [testError, setTestError] = useState({})
  const toast = useToast()

  useEffect(() => {
    setInstalled(prev => {
      const next = { ...prev }
      for (const tpl of QUICK_START_TEMPLATES) {
        const match = flows.find(f => f.name === tpl.name)
        if (match) {
          const steps = match.steps || []
          const installedNames = steps.map(s => s.app_name)
          const missingNames = tpl.appNames.filter(n => {
            const lower = n.toLowerCase()
            return !installedNames.some(installed =>
              installed?.toLowerCase() === lower ||
              installed?.toLowerCase().includes(lower) ||
              lower.includes(installed?.toLowerCase())
            )
          })
          next[tpl.name] = { flowId: match.id, stepCount: steps.length, missingNames }
        } else if (next[tpl.name] && !flows.find(f => f.id === next[tpl.name]?.flowId)) {
          delete next[tpl.name]
        }
      }
      return next
    })
  }, [flows])

  useEffect(() => {
    if (!deletedFlowId) return
    setInstalled(p => {
      const next = { ...p }
      for (const [name, data] of Object.entries(next)) {
        if (data?.flowId === deletedFlowId) delete next[name]
      }
      return next
    })
  }, [deletedFlowId])

  async function installMissingApps(tpl) {
    const installData = installed[tpl.name]
    if (!installData) return
    setInstalling(tpl.name + '__fix')
    try {
      const { data: currentFlow } = await supabase.from('flows').select('steps').eq('id', installData.flowId).single()
      const existingSteps = currentFlow?.steps || []

      const installedByName = {}
      for (const s of existingSteps) installedByName[s.app_name.toLowerCase()] = s
      for (const appName of installData.missingNames) {
        installedByName[appName.toLowerCase()] = { app_name: appName, app_emoji: '⚡', app_id: null }
      }

      const fullSteps = tpl.appNames.map(name => {
        const lower = name.toLowerCase()
        return installedByName[lower]
          || Object.values(installedByName).find(s => s.app_name.toLowerCase().includes(lower) || lower.includes(s.app_name.toLowerCase()))
      }).filter(Boolean)

      const { error: updateErr } = await supabase.from('flows').update({ steps: fullSteps }).eq('id', installData.flowId)
      if (updateErr) throw updateErr

      setInstalled(p => ({
        ...p,
        [tpl.name]: { flowId: installData.flowId, stepCount: fullSteps.length, missingNames: [] },
      }))
      toast(`✓ All ${fullSteps.length} steps installed for "${tpl.name}"`, 'success', 4000)
    } catch (e) {
      toast(e.message || 'Failed to install missing apps', 'error')
    } finally {
      setInstalling(null)
    }
  }

  async function install(tpl) {
    setInstalling(tpl.name)
    try {
      const resolved = tpl.appNames.map(name => {
        const lower = name.toLowerCase()
        const match = apps.find(a => a.name.toLowerCase() === lower)
          || apps.find(a => a.name.toLowerCase().includes(lower) || lower.includes(a.name.toLowerCase()))
        return { name, match }
      })

      const steps = resolved.filter(r => r.match).map(r => ({
        app_id: r.match.id, app_name: r.match.name, app_emoji: r.match.emoji,
      }))
      const missingNames = resolved.filter(r => !r.match).map(r => r.name)

      if (steps.length === 0) {
        const list = missingNames.join(', ')
        toast(`Apps not found: ${list}. Add them to your library first.`, 'error', 6000)
        return
      }

      const { data, error } = await supabase.from('flows').insert({
        user_id: userId, name: tpl.name, emoji: tpl.emoji,
        description: tpl.desc, steps,
      }).select().single()

      if (error) throw error
      setInstalled(p => ({ ...p, [tpl.name]: { flowId: data.id, stepCount: steps.length, missingNames } }))
      onCreated(data)
      if (missingNames.length > 0) {
        toast(`"${tpl.name}" installed with ${steps.length} of ${tpl.appNames.length} steps. Missing: ${missingNames.join(', ')}`, 'warn', 6000)
      } else {
        toast(`"${tpl.name}" installed — ${steps.length} steps ready`, 'success', 4000)
      }
    } catch (e) {
      toast(e.message || 'Install failed', 'error')
    } finally {
      setInstalling(null)
    }
  }

  function handleTest(tpl) {
    const installData = installed[tpl.name]
    if (!installData) return
    const flow = flows.find(f => f.id === installData.flowId)
    if (!flow) return
    setTestError(p => { const n = { ...p }; delete n[tpl.name]; return n })
    onRunFlow?.(flow, success => {
      if (success) {
        setTested(prev => new Set([...prev, tpl.name]))
      } else {
        setTestError(p => ({ ...p, [tpl.name]: true }))
      }
    })
  }

  const packTemplates = QUICK_START_TEMPLATES.filter(t => t.pack === activePack)

  return (
    <div className="mb-6">
      <p className="text-xs text-slate-300 uppercase font-semibold tracking-wide mb-3">Quick start — install a workflow template</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {packTemplates.map(tpl => {
          const isInstalling = installing === tpl.name
          const installData = installed[tpl.name]
          const isDone = !!installData
          const hasPartial = isDone && installData.missingNames?.length > 0
          const isTested = tested.has(tpl.name)
          const hasTestError = testError[tpl.name]
          return (
            <div key={tpl.name}
              className={`flex flex-col text-left p-3 rounded-xl border transition-all ${isDone
                ? hasPartial ? 'border-amber-500/40 bg-amber-500/5' : 'border-green-500/40 bg-green-500/8'
                : 'border-white/20 bg-[#121829] hover:border-white/35 hover:bg-[#172035] hover:shadow-md hover:shadow-black/30'}`}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                  style={{ background: isDone ? (hasPartial ? '#f59e0b22' : '#10b98122') : tpl.color + '22' }}>
                  {isInstalling ? <span className="animate-spin text-sm">⟳</span> : isDone ? (hasPartial ? '⚠' : '✓') : tpl.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold leading-snug truncate">{tpl.name}</p>
                  <p className="text-[10px] text-slate-500">
                    {isDone
                      ? `${installData.stepCount}/${tpl.appNames.length} steps`
                      : `${tpl.appNames.length} steps`}
                  </p>
                </div>
              </div>
              <p className="text-slate-400 text-[11px] leading-relaxed flex-1 line-clamp-2">{tpl.desc}</p>
              {isDone && hasPartial && (
                <div className="flex gap-1 flex-wrap mt-2">
                  {tpl.appNames.map(n => {
                    const isMissing = installData.missingNames?.includes(n)
                    return (
                      <span key={n} className={`text-[9px] border px-1.5 py-0.5 rounded-md ${isMissing
                        ? 'bg-red-400/8 border-red-400/25 text-red-400 line-through'
                        : 'bg-white/6 border-white/10 text-slate-400'}`}>{n}</span>
                    )
                  })}
                </div>
              )}
              {hasPartial && (
                <div className="mt-1 mb-1 space-y-1.5">
                  <p className="text-[9px] text-amber-400 leading-relaxed">
                    Missing: {installData.missingNames.join(', ')}
                  </p>
                  <button
                    onClick={() => !installing && installMissingApps(tpl)}
                    disabled={!!installing}
                    className="w-full text-[11px] font-semibold py-1.5 rounded-lg transition-all bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 disabled:opacity-50">
                    {installing === tpl.name + '__fix' ? '⟳ Installing…' : '⚡ Install missing'}
                  </button>
                </div>
              )}
              {isDone && !hasPartial ? (
                <div className="mt-2 space-y-1.5">
                  {isTested ? (
                    <div className="w-full text-[11px] py-1.5 rounded-lg text-center bg-green-500/10 text-green-400 border border-green-500/20">
                      ✓ Tested · {installData.stepCount} steps
                    </div>
                  ) : (
                    <>
                      <div className="workflow-action-button-muted w-full text-[11px] py-1.5 rounded-lg text-center">
                        ✓ Installed · {installData.stepCount} steps
                      </div>
                      {hasTestError && (
                        <p className="text-[10px] text-red-400 text-center">
                          ⚠ Test didn't complete
                        </p>
                      )}
                      <button
                        onClick={() => handleTest(tpl)}
                        className={`w-full text-[11px] font-semibold py-1.5 rounded-lg transition-all border ${hasTestError
                          ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/25'
                          : 'workflow-action-button'}`}>
                        {hasTestError ? '↺ Retry' : '▶ Test workflow'}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => !isDone && !installing && install(tpl)}
                  disabled={!!installing || isDone}
                  className={`mt-2 w-full text-[11px] font-medium py-1.5 rounded-lg transition-all disabled:opacity-50 ${isDone
                    ? 'cursor-default bg-white/5 text-slate-500'
                    : 'cursor-pointer workflow-action-button'}`}>
                  {isDone
                    ? `${installData.stepCount}/${tpl.appNames.length} steps`
                    : isInstalling ? 'Installing…' : '+ Install'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
