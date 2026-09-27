import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { streamRun } from './flowUtils'
import { APP_DEFAULT_FIELDS, EMOJIS, GPT_PROVIDERS } from './flowConstants'

function AIDesignerPanel({ apps, domains, onApply }) {
  const [goal, setGoal] = useState('')
  const [selectedDomains, setSelectedDomains] = useState([])
  const [thinking, setThinking] = useState(false)
  const [suggestion, setSuggestion] = useState(null)
  const [error, setError] = useState(null)
  const [runOutput, setRunOutput] = useState(null)
  const [running, setRunning] = useState(false)
  const [swapIdx, setSwapIdx] = useState(null)
  const [altScores, setAltScores] = useState({})
  const [scoringAlts, setScoringAlts] = useState(false)
  const swapRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    function onDown(e) { if (swapRef.current && !swapRef.current.contains(e.target)) setSwapIdx(null) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  async function openSwap(idx) {
    if (swapIdx === idx) { setSwapIdx(null); return }
    setSwapIdx(idx)
    setAltScores({})
    if (!suggestion) return

    const step = suggestion.steps[idx]
    const prevStep = idx > 0 ? suggestion.steps[idx - 1] : null
    const nextStep = idx < suggestion.steps.length - 1 ? suggestion.steps[idx + 1] : null

    const usedIds = new Set(suggestion.steps.filter((_, i) => i !== idx).map(s => s.app_id))
    const candidates = apps.filter(a => !usedIds.has(a.id) && a.id !== step.app_id)
    if (candidates.length === 0) return

    setScoringAlts(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const context = [
        prevStep ? `previous step: "${prevStep.app_name}"` : 'first step',
        `current step role: "${step.role}"`,
        nextStep ? `next step: "${nextStep.app_name}"` : 'last step',
      ].join(', ')
      const { result } = await streamRun({
        system_prompt: 'You are a workflow compatibility expert. Respond ONLY with valid JSON, no prose.',
        input: `Workflow goal: ${goal}\nStep context: ${context}\nRate each app as a replacement for "${step.app_name}" in this position.\nApps: ${candidates.map(a => a.name).join(', ')}\nReturn JSON: {"AppName": score} where score is 0-100. 100=perfect replacement, 70=good, 50=possible, 30=unlikely, 0=irrelevant.`,
        provider: 'claude',
      }, session)
      const match = result.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        const map = {}
        for (const [name, score] of Object.entries(parsed)) {
          const app = candidates.find(a => a.name.toLowerCase() === name.toLowerCase())
          if (app) map[app.id] = Number(score)
        }
        setAltScores(map)
      }
    } catch {}
    setScoringAlts(false)
  }

  function replaceStep(idx, newApp) {
    setSuggestion(prev => {
      const steps = [...prev.steps]
      steps[idx] = { app_id: newApp.id, app_name: newApp.name, app_emoji: newApp.emoji, role: steps[idx].role }
      return { ...prev, steps }
    })
    setSwapIdx(null)
    setAltScores({})
  }

  useEffect(() => { inputRef.current?.focus() }, [])

  function toggleDomain(id) {
    setSelectedDomains(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    )
    setSuggestion(null)
  }

  function filteredApps() {
    if (selectedDomains.length === 0) return apps
    return apps.filter(a => a.domain_id && selectedDomains.includes(a.domain_id))
  }

  async function generate() {
    if (!goal.trim()) return
    setThinking(true); setSuggestion(null); setError(null); setRunOutput(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const pool = filteredApps()
      const domainNote = selectedDomains.length > 0
        ? `\nContext: the user is working in the domain of: ${domains.filter(d => selectedDomains.includes(d.id)).map(d => d.name).join(', ')}. Only suggest apps relevant to this domain.`
        : ''
      const appList = pool.map(a => `- ${a.name} (emoji: ${a.emoji}${a.domains?.name ? `, domain: ${a.domains.name}` : ''})`).join('\n')
      const systemPrompt = `You are an AI workflow designer. The user describes a goal and you suggest the best workflow using available apps.${domainNote}

Available apps:
${appList}

Respond ONLY with valid JSON (no markdown fences, no prose) in this exact shape:
{
  "name": "short workflow name",
  "emoji": "one emoji",
  "description": "one sentence describing what this workflow does",
  "explanation": "2-3 sentences explaining how the steps connect and what the user achieves",
  "steps": [
    { "app_name": "exact app name from the list", "role": "what this step does in 5 words" }
  ],
  "sampleInput": "a realistic one-paragraph sample input the user could paste to test this workflow"
}

Only include apps from the available list. Choose 2-5 steps. Match app names exactly. Do NOT suggest apps from unrelated domains.`

      const { result: full } = await streamRun({ system_prompt: systemPrompt, input: goal, provider: 'claude' }, session)
      const match = full.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No valid JSON in response')
      const parsed = JSON.parse(match[0])
      const resolved = (parsed.steps || []).map(s => {
        const found = apps.find(a => a.name.toLowerCase() === s.app_name.toLowerCase())
        return found
          ? { app_id: found.id, app_name: found.name, app_emoji: found.emoji, role: s.role }
          : { app_name: s.app_name, app_emoji: '🔧', role: s.role }
      }).filter(s => s.app_id)
      setSuggestion({ ...parsed, steps: resolved })
    } catch {
      setError('Could not generate a suggestion. Try rephrasing your goal.')
    } finally {
      setThinking(false)
    }
  }

  async function runSample() {
    if (!suggestion || running) return
    setRunning(true); setRunOutput('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const firstStep = suggestion.steps[0]
      if (!firstStep?.app_id) { setRunOutput('No runnable step found.'); setRunning(false); return }
      const { data: appData } = await supabase.from('apps').select('*').eq('id', firstStep.app_id).single()
      await streamRun({
        system_prompt: appData?.system_prompt || '',
        input: suggestion.sampleInput || goal,
        provider: appData?.ai_provider || 'claude',
        model: appData?.ai_model || null,
      }, session, t => { setRunOutput(t) })
    } catch (e) {
      setRunOutput('Sample run failed: ' + e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="border border-[#6C5CE7]/25 bg-[#6C5CE7]/5 rounded-xl p-4 space-y-3">

      {domains.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Filter by domain <span className="normal-case text-slate-400">(optional — leave blank for all)</span></p>
          <div className="flex flex-wrap gap-1.5">
            {domains.map(d => {
              const active = selectedDomains.includes(d.id)
              return (
                <button
                  key={d.id}
                  onClick={() => toggleDomain(d.id)}
                  className={`flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full border transition-all ${
                    active
                      ? 'text-white border-[#6C5CE7] bg-[#6C5CE7]/20'
                      : 'text-slate-400 border-white/18 bg-white/5 hover:border-white/20 hover:text-slate-300'
                  }`}
                >
                  <span>{d.emoji}</span>
                  <span>{d.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          rows={2}
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }}
          placeholder="Describe your goal, e.g. automate job applications — resume, cover letter, interview prep…"
          className="flex-1 bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors resize-none"
        />
        <button
          onClick={generate}
          disabled={!goal.trim() || thinking}
          className="px-4 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-50 shrink-0"
          style={{ background: 'linear-gradient(135deg, #6C5CE7, #E84393)' }}>
          {thinking ? '…' : '✦ Design'}
        </button>
      </div>

      {thinking && (
        <div className="flex items-center gap-2 py-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0s' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0.15s' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0.3s' }} />
          <span className="text-slate-400 text-xs ml-1">Analyzing requirements…</span>
        </div>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {suggestion && (
        <div className="space-y-3 animate-fade-in">
          <div className="bg-[#09101F] border border-white/8 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-lg">{suggestion.emoji}</span>
              <div>
                <p className="text-white text-xs font-semibold">{suggestion.name}</p>
                <p className="text-[10px] text-slate-400">{suggestion.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-wrap" ref={swapIdx !== null ? swapRef : null}>
              {suggestion.steps.map((s, i) => (
                <div key={i} className="flex items-center gap-1 relative">
                  <button
                    onClick={() => openSwap(i)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all text-left ${
                      swapIdx === i
                        ? 'bg-[#6C5CE7]/20 border-[#6C5CE7]/50'
                        : 'bg-[#1A2038] border-white/18 hover:border-[#6C5CE7]/40 hover:bg-[#222840]'
                    }`}
                    title="Click to swap this app"
                  >
                    <span className="text-xs">{s.app_emoji}</span>
                    <div>
                      <p className="text-white text-[10px] font-medium leading-tight">{s.app_name}</p>
                      <p className="text-[9px] text-slate-400 leading-tight">{s.role}</p>
                    </div>
                    <span className="text-[9px] text-slate-400 ml-0.5">⇅</span>
                  </button>

                  {swapIdx === i && (
                    <div ref={swapRef} className="absolute top-full left-0 mt-1.5 z-50 bg-[#09101F] border border-[#6C5CE7]/30 rounded-xl shadow-2xl shadow-black/50 p-3 w-64">
                      <p className="text-[10px] text-[#A29BFE] font-semibold mb-2 uppercase tracking-wide">
                        Replace "{s.app_name}"
                      </p>
                      {scoringAlts ? (
                        <div className="flex items-center gap-2 py-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0.15s' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0.3s' }} />
                          <span className="text-[10px] text-slate-400">Scoring alternatives…</span>
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {apps
                            .filter(a => a.id !== s.app_id && !suggestion.steps.filter((_, si) => si !== i).find(st => st.app_id === a.id))
                            .map(a => ({ ...a, score: altScores[a.id] ?? null }))
                            .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
                            .map(a => {
                              const sc = a.score
                              const scoreColor = sc === null ? 'text-slate-400'
                                : sc >= 80 ? 'text-green-400'
                                : sc >= 60 ? 'text-yellow-400'
                                : 'text-slate-400'
                              return (
                                <button
                                  key={a.id}
                                  onClick={() => replaceStep(i, a)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#1A2038] transition-colors text-left group"
                                >
                                  <span className="text-sm shrink-0">{a.emoji}</span>
                                  <span className="text-[11px] text-slate-300 group-hover:text-white flex-1 min-w-0 truncate">{a.name}</span>
                                  {sc !== null && (
                                    <span className={`text-[10px] font-semibold shrink-0 ${scoreColor}`}>{sc}%</span>
                                  )}
                                </button>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  )}

                  {i < suggestion.steps.length - 1 && <span className="flow-connector" style={{ width: '14px' }} />}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed border-t border-white/8 pt-2">{suggestion.explanation}</p>
          </div>

          {suggestion.sampleInput && (
            <div className="bg-[#09101F] border border-white/8 rounded-xl p-3">
              <p className="text-[9px] text-slate-400 uppercase font-medium mb-1">Sample input</p>
              <p className="text-[10px] text-slate-300 leading-relaxed line-clamp-2">{suggestion.sampleInput}</p>
            </div>
          )}

          {runOutput && (
            <div className="bg-[#09101F] border border-[#6C5CE7]/20 rounded-xl p-3">
              <p className="text-[9px] text-[#A29BFE] uppercase font-medium mb-1">▶ Sample — {suggestion.steps[0]?.app_name}</p>
              <p className="text-[10px] text-slate-300 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">{runOutput}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={runSample} disabled={running}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20 text-slate-300 hover:text-white hover:border-white/20 transition-all disabled:opacity-50">
              {running ? '▶ Running…' : '▶ Run Sample'}
            </button>
            <button onClick={() => onApply(suggestion)}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
              style={{ background: 'linear-gradient(135deg, #6C5CE7, #8B5CF6)' }}>
              ✓ Apply to Workflow
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ApiStepModal({ onSave, onCancel }) {
  const [label, setLabel]   = useState('API Call')
  const [method, setMethod] = useState('GET')
  const [url, setUrl]       = useState('')
  const [body, setBody]     = useState('')
  const [headers, setHeaders] = useState('')

  const inCls = 'w-full bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-lg flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <p className="text-white font-semibold">🔗 Add API Call Step</p>
          <button onClick={onCancel} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Step label</label>
            <input className={inCls} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Search Expedia" />
          </div>

          <div className="flex gap-2">
            <div className="shrink-0">
              <label className="text-xs text-slate-400 block mb-1">Method</label>
              <select className="bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7]"
                value={method} onChange={e => setMethod(e.target.value)}>
                {METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400 block mb-1">URL</label>
              <input className={inCls} value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://api.example.com/search?q={{previous_output}}" />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Request body <span className="text-slate-400">(JSON, optional)</span>
            </label>
            <textarea className={inCls} rows={4} value={body} onChange={e => setBody(e.target.value)}
              placeholder={'{\n  "query": "{{previous_output}}",\n  "limit": 10\n}'} />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Headers <span className="text-slate-400">(JSON, optional)</span>
            </label>
            <textarea className={inCls} rows={2} value={headers} onChange={e => setHeaders(e.target.value)}
              placeholder={'{"Authorization": "Bearer YOUR_KEY"}'} />
          </div>

          <div className="bg-[#09101F] border border-white/18 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Template variables</p>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Use <code className="text-[#A29BFE] bg-[#6C5CE7]/10 px-1 rounded">{'{{previous_output}}'}</code> anywhere in the URL or body — it gets replaced with the output of the previous step at runtime.
            </p>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { if (!url.trim()) return; onSave({ step_type: 'api_call', app_name: label || 'API Call', app_emoji: '🔗', api_method: method, api_url: url.trim(), api_body: body.trim(), api_headers: headers.trim() }) }}
            disabled={!url.trim()}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-5 py-2.5 rounded-xl font-medium transition-colors">
            Add step
          </button>
          <button onClick={onCancel} className="bg-[#1A2038] text-slate-300 text-sm px-4 py-2.5 rounded-xl transition-colors hover:bg-[#222840]">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function FlowBuilderModal({ apps, domains, existingFlow, initialSteps, onSave, onCancel }) {
  const [name, setName] = useState(existingFlow?.name || '')
  const [emoji, setEmoji] = useState(existingFlow?.emoji || '⚡')
  const [description, setDescription] = useState(existingFlow?.description || '')
  const [steps, setSteps] = useState(existingFlow?.steps || initialSteps || [])
  const [showApiModal, setShowApiModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [showGpt, setShowGpt] = useState(!!(existingFlow?.gpt_name || existingFlow?.gpt_instructions))
  const [gptName, setGptName] = useState(existingFlow?.gpt_name || '')
  const [gptInstructions, setGptInstructions] = useState(existingFlow?.gpt_instructions || '')
  const [gptProvider, setGptProvider] = useState(existingFlow?.gpt_provider || 'claude')
  const [showIntegration, setShowIntegration] = useState(!!existingFlow?.integration_webhook_url)
  const [webhookUrl, setWebhookUrl] = useState(existingFlow?.integration_webhook_url || '')
  const [useKnowledge, setUseKnowledge] = useState(!!existingFlow?.use_knowledge_vault)
  const [defaultProvider, setDefaultProvider] = useState(existingFlow?.default_provider || 'claude')
  const [showAI, setShowAI] = useState(!existingFlow)
  const [usageMap, setUsageMap] = useState({})
  const [aiScores, setAiScores] = useState({})
  const [scoringAI, setScoringAI] = useState(false)
  const [showApprovalPicker, setShowApprovalPicker] = useState(false)
  const [editingStepIdx, setEditingStepIdx] = useState(null)
  const [fieldsDraft, setFieldsDraft] = useState([])
  const lastScoredRef = useRef(null)

  useEffect(() => {
    supabase.from('flows').select('steps').then(({ data }) => {
      const map = {}
      for (const flow of data || []) {
        const fsteps = flow.steps || []
        for (let i = 0; i < fsteps.length - 1; i++) {
          const a = fsteps[i].app_id, b = fsteps[i + 1].app_id
          if (!a || !b) continue
          map[a] = map[a] || {}
          map[a][b] = (map[a][b] || 0) + 1
        }
      }
      setUsageMap(map)
    })
  }, [])

  useEffect(() => {
    if (steps.length === 0) { setAiScores({}); lastScoredRef.current = null; return }
    const lastId = steps[steps.length - 1].app_id
    if (lastId === lastScoredRef.current) return
    lastScoredRef.current = lastId

    const candidates = apps.filter(a => !steps.find(s => s.app_id === a.id) && !usageMap[lastId]?.[a.id])
    if (candidates.length === 0) return

    setScoringAI(true)
    const flowSoFar = steps.map(s => s.app_name).join(' → ')
    const lastApp = steps[steps.length - 1].app_name

    supabase.auth.getSession().then(({ data: { session } }) => {
      streamRun({
        system_prompt: 'You are a workflow compatibility expert. Respond ONLY with valid JSON, no prose.',
        input: `Current workflow: ${flowSoFar}\nLast step: "${lastApp}"\nRate each app as the NEXT step after "${lastApp}".\nApps: ${candidates.map(a => a.name).join(', ')}\nReturn JSON: {"AppName": score} where score is 0-90 (integer). 90=perfect fit, 70=good, 50=possible, 30=unlikely, 10=wrong order.`,
        provider: 'claude',
      }, session).then(({ result }) => {
        try {
          const match = result.match(/\{[\s\S]*\}/)
          if (match) {
            const parsed = JSON.parse(match[0])
            const scoreMap = {}
            for (const [name, score] of Object.entries(parsed)) {
              const app = candidates.find(a => a.name.toLowerCase() === name.toLowerCase())
              if (app) scoreMap[app.id] = Number(score)
            }
            setAiScores(scoreMap)
          }
        } catch {}
        setScoringAI(false)
      }).catch(() => setScoringAI(false))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, usageMap])

  function getAppScore(app) {
    if (steps.length === 0) return null
    const lastId = steps[steps.length - 1].app_id
    const followers = usageMap[lastId] || {}
    const total = Object.values(followers).reduce((a, b) => a + b, 0)
    const count = followers[app.id] || 0
    if (count > 0 && total > 0) {
      return { score: Math.round(70 + (count / total) * 30), source: 'usage' }
    }
    if (aiScores[app.id] !== undefined) {
      return { score: aiScores[app.id], source: 'ai' }
    }
    return null
  }

  function getOrderWarning() {
    if (steps.length < 2) return null
    const last = steps[steps.length - 1]
    const prev = steps[steps.length - 2]
    const lastBeforePrev = usageMap[last.app_id]?.[prev.app_id] || 0
    const prevBeforeLast = usageMap[prev.app_id]?.[last.app_id] || 0
    if (lastBeforePrev > prevBeforeLast * 2 && lastBeforePrev >= 2) {
      return `"${last.app_name}" usually comes before "${prev.app_name}" in similar workflows`
    }
    return null
  }

  function applyAISuggestion(s) {
    setName(s.name); setEmoji(s.emoji); setDescription(s.description); setSteps(s.steps)
    setShowAI(false)
  }

  function skipAI() { setShowAI(false) }

  function addStep(app) {
    const key = app.name.toLowerCase()
    const defaultFields = APP_DEFAULT_FIELDS[key]
    setSteps(p => [...p, { app_id: app.id, app_name: app.name, app_emoji: app.emoji, ...(defaultFields ? { step_fields: defaultFields } : {}) }])
  }
  function addApiStep(cfg) { setSteps(p => [...p, cfg]); setShowApiModal(false) }
  const APPROVAL_TYPES = {
    review:  { label: 'Needs Approval',       emoji: '✋', desc: 'A human must approve before the workflow continues.' },
    edit:    { label: 'Edit Before Sending',  emoji: '✏️', desc: 'Review and edit the AI output before it passes to the next step.' },
    assign:  { label: 'Assign to Teammate',   emoji: '👤', desc: 'Route to a specific person for review via email.' },
  }
  function addApprovalStep(type) {
    const t = APPROVAL_TYPES[type]
    setSteps(p => [...p, { step_type: 'human_approval', approval_type: type, app_name: t.label, app_emoji: t.emoji }])
    setShowApprovalPicker(false)
  }
  function openFieldEditor(i) {
    const existing = steps[i].step_fields || []
    setFieldsDraft(existing.length ? existing.map(f => ({ ...f })) : [{ id: Date.now() + '', label: '', placeholder: '', required: false }])
    setEditingStepIdx(i)
  }
  function addDraftField() {
    setFieldsDraft(p => [...p, { id: Date.now() + '', label: '', placeholder: '', required: false }])
  }
  function updateDraftField(id, key, val) {
    setFieldsDraft(p => p.map(f => f.id === id ? { ...f, [key]: val } : f))
  }
  function removeDraftField(id) {
    setFieldsDraft(p => p.filter(f => f.id !== id))
  }
  function saveFieldEditor(i) {
    const valid = fieldsDraft.filter(f => f.label.trim())
    setSteps(p => p.map((s, idx) => idx === i ? { ...s, step_fields: valid.length ? valid : undefined } : s))
    setEditingStepIdx(null)
  }

  function removeStep(i) { setSteps(p => p.filter((_, idx) => idx !== i)) }
  function moveStep(i, dir) {
    const s = [...steps]; const j = i + dir
    if (j < 0 || j >= s.length) return
    ;[s[i], s[j]] = [s[j], s[i]]; setSteps(s)
  }

  async function save() {
    if (!name.trim() || steps.length < 1) return
    setSaving(true)
    await onSave({
      name: name.trim(), emoji, description: description.trim(), steps,
      gpt_name: showGpt ? gptName.trim() || null : null,
      gpt_instructions: showGpt ? gptInstructions.trim() || null : null,
      gpt_provider: showGpt ? gptProvider : null,
      integration_webhook_url: showIntegration ? webhookUrl.trim() || null : null,
      default_provider: defaultProvider,
      use_knowledge_vault: useKnowledge || null,
    })
    setSaving(false)
  }

  const inCls = 'w-full bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'
  const unusedApps = apps.filter(a => !steps.find(s => s.app_id === a.id) && (!search || a.name.toLowerCase().includes(search.toLowerCase())))

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/18 shrink-0">
          <p className="text-white font-semibold">{existingFlow ? 'Edit AI Workflow' : 'New AI Workflow'}</p>
          <button aria-label="Close" onClick={onCancel} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>

        {showAI ? (
          <div className="overflow-y-auto flex-1 min-h-0 px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-white font-semibold text-sm">✦ Design with AI</p>
                <p className="text-slate-400 text-xs mt-0.5">Describe your goal and AI will suggest a workflow</p>
              </div>
              <button onClick={skipAI} className="text-xs text-slate-400 hover:text-white border border-white/18 hover:border-white/20 px-3 py-1.5 rounded-lg transition-colors">
                Skip — build manually →
              </button>
            </div>
            <AIDesignerPanel apps={apps} domains={domains} onApply={applyAISuggestion} />
          </div>
        ) : (
        <div className="overflow-y-auto flex-1 min-h-0 px-6 py-5 space-y-5">

          <div className="flex gap-3">
            <select className="bg-[#1A2038] border border-white/18 rounded-xl px-2 py-2.5 text-xl focus:outline-none focus:border-[#6C5CE7] w-14 text-center shrink-0"
              value={emoji} onChange={e => setEmoji(e.target.value)}>
              {EMOJIS.map(e => <option key={e}>{e}</option>)}
            </select>
            <input className={inCls} placeholder="Workflow name, e.g. Job Application Flow"
              value={name} onChange={e => setName(e.target.value)} />
          </div>
          <input className={inCls} placeholder="Description (optional)"
            value={description} onChange={e => setDescription(e.target.value)} />

          <div className="border border-[#6C5CE7]/20 bg-[#6C5CE7]/5 rounded-xl p-4">
            <button onClick={() => setShowGpt(v => !v)} className="w-full flex items-center justify-between">
              <span className="text-xs font-semibold text-[#A29BFE] uppercase tracking-wide">🧠 Workflow AI</span>
              <span className="text-slate-400 text-xs">{showGpt ? '− Remove' : '+ Add intelligence'}</span>
            </button>
            {!showGpt ? (
              <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                Give this workflow its own dedicated assistant — a name and standing instructions that guide every app inside it, on top of the shared memory.
              </p>
            ) : (
              <div className="space-y-2.5 mt-3">
                <input className={inCls} placeholder="GPT name, e.g. Career Coach GPT"
                  value={gptName} onChange={e => setGptName(e.target.value)} />
                <textarea className={inCls} rows={4}
                  placeholder="Standing instructions for every app in this workflow, e.g. 'Always write in a warm, encouraging tone. Always account for the user's accessibility needs and skills found in workflow memory. Prioritize concise, actionable output.'"
                  value={gptInstructions} onChange={e => setGptInstructions(e.target.value)} />
                <div className="flex gap-1.5">
                  {GPT_PROVIDERS.map(p => (
                    <button key={p.id} onClick={() => setGptProvider(p.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${gptProvider === p.id ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-white' : 'bg-[#1A2038] border-white/18 text-slate-400 hover:text-white'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400">Applied as a system-level directive to every app run in this workflow.</p>
              </div>
            )}
          </div>

          <div className="border border-white/22 bg-[#1A2038]/40 rounded-xl p-4">
            <button onClick={() => setShowIntegration(v => !v)} className="w-full flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">🔗 Integration</span>
              <span className="text-slate-400 text-xs">{showIntegration ? '− Remove' : '+ Add export'}</span>
            </button>
            {!showIntegration ? (
              <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                Auto-send the final results somewhere else when this workflow finishes — Slack, a Google Sheet (via Zapier/Apps Script), or email (via Zapier/Make).
              </p>
            ) : (
              <div className="space-y-2.5 mt-3">
                <input className={inCls} placeholder="Webhook URL — Slack Incoming Webhook, Zapier, Make, or Google Apps Script"
                  value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} />
                <p className="text-[10px] text-slate-400">Sends a JSON payload ({'{ text, workspace, steps }'}) to this URL right after every run completes.</p>
              </div>
            )}
          </div>

          <div className="border border-white/22 bg-[#1A2038]/40 rounded-xl p-4">
            <button onClick={() => setUseKnowledge(v => !v)} className="w-full flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">🧠 Company Knowledge</span>
              <span className={`w-9 h-5 rounded-full relative transition-colors ${useKnowledge ? 'bg-[#6C5CE7]' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${useKnowledge ? 'left-4' : 'left-0.5'}`} />
              </span>
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              {useKnowledge
                ? '✓ Knowledge Vault entries will be injected as context into every AI step in this workflow.'
                : 'Use company knowledge in this workflow — product docs, tone of voice, FAQs, and more.'}
            </p>
          </div>

          <div className="border border-white/22 bg-[#1A2038]/40 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">🤖 AI Provider</p>
            <p className="text-[11px] text-slate-300 mb-3">Which AI powers every app step in this workflow. Individual apps may override this.</p>
            <div className="flex gap-2">
              {[
                { id: 'claude', label: '🟣 Claude', sub: 'Anthropic' },
                { id: 'openai', label: '🟢 ChatGPT', sub: 'OpenAI' },
                { id: 'auto',   label: '⚡ Auto',   sub: 'Smart pick' },
              ].map(p => (
                <button key={p.id} onClick={() => setDefaultProvider(p.id)}
                  className={`flex-1 text-center py-2 rounded-xl border text-xs transition-all ${defaultProvider === p.id ? 'bg-[#6C5CE7]/20 border-[#6C5CE7]/50 text-white' : 'bg-[#1A2038] border-white/22 text-slate-400 hover:text-white'}`}>
                  <div className="font-medium">{p.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{p.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Steps</p>
              {steps.length < 1 && <span className="text-[10px] text-slate-400">Add at least 1 app</span>}
            </div>
            {steps.length === 0 ? (
              <div className="border border-dashed border-white/18 rounded-xl p-8 text-center">
                <p className="text-slate-400 text-sm">Click apps below to add steps</p>
              </div>
            ) : (
              <div className="space-y-1">
                {steps.map((s, i) => (
                  <div key={i}>
                    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 group ${
                      s.step_type === 'api_call' ? 'bg-[#0984E3]/10 border border-[#0984E3]/20'
                      : s.step_type === 'human_approval' ? 'bg-amber-500/10 border border-amber-500/25'
                      : 'bg-[#1A2038]'}`}>
                      <span className="text-[11px] font-bold text-slate-400 w-4 text-center">{i + 1}</span>
                      <span className="text-base shrink-0">{s.app_emoji}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-white">{s.app_name}</span>
                        {s.step_type === 'api_call' && (
                          <p className="text-[10px] text-[#0984E3] truncate mt-0.5">{s.api_method} {s.api_url}</p>
                        )}
                        {s.step_type === 'human_approval' && (
                          <p className="text-[10px] text-amber-400 mt-0.5">Human approval gate</p>
                        )}
                        {!s.step_type && (
                          <button onClick={() => editingStepIdx === i ? setEditingStepIdx(null) : openFieldEditor(i)}
                            className={`text-[10px] mt-0.5 transition-colors ${s.step_fields?.length ? 'text-[#A29BFE]' : 'text-slate-500 hover:text-[#A29BFE]'}`}>
                            {s.step_fields?.length ? `📋 ${s.step_fields.length} input field${s.step_fields.length > 1 ? 's' : ''} set` : '📋 Set input form'}
                          </button>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-white disabled:opacity-20 text-xs px-1.5 py-1 rounded transition-colors">↑</button>
                        <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="text-slate-400 hover:text-white disabled:opacity-20 text-xs px-1.5 py-1 rounded transition-colors">↓</button>
                        <button aria-label={`Remove step ${s.app_name}`} onClick={() => removeStep(i)} className="text-slate-400 hover:text-red-400 text-xs px-1.5 py-1 rounded transition-colors">✕</button>
                      </div>
                    </div>

                    {editingStepIdx === i && (
                      <div className="mt-2 ml-7 border border-[#6C5CE7]/30 bg-[#6C5CE7]/5 rounded-xl p-3 space-y-2" onClick={e => e.stopPropagation()}>
                        <p className="text-[11px] text-[#A29BFE] font-semibold">Define the input form runners will see for this step</p>
                        {fieldsDraft.map(f => (
                          <div key={f.id} className="flex items-center gap-2">
                            <input
                              placeholder="Field label *"
                              value={f.label}
                              onChange={e => updateDraftField(f.id, 'label', e.target.value)}
                              className="flex-1 bg-[#1A2038] border border-white/18 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]"
                            />
                            <input
                              placeholder="Placeholder hint"
                              value={f.placeholder}
                              onChange={e => updateDraftField(f.id, 'placeholder', e.target.value)}
                              className="flex-1 bg-[#1A2038] border border-white/18 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]"
                            />
                            <button
                              onClick={() => updateDraftField(f.id, 'required', !f.required)}
                              title="Toggle required"
                              className={`text-[10px] px-2 py-1.5 rounded-lg border transition-all shrink-0 ${f.required ? 'bg-[#6C5CE7]/20 border-[#6C5CE7]/40 text-[#A29BFE]' : 'bg-transparent border-white/18 text-slate-500 hover:text-white'}`}>
                              req
                            </button>
                            <button onClick={() => removeDraftField(f.id)} className="text-slate-500 hover:text-red-400 text-xs px-1 transition-colors shrink-0">✕</button>
                          </div>
                        ))}
                        {fieldsDraft.length < 6 && (
                          <button onClick={addDraftField} className="text-[11px] text-[#6C5CE7] hover:text-[#A29BFE] transition-colors">+ Add field</button>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => saveFieldEditor(i)} className="text-xs bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white px-3 py-1.5 rounded-lg transition-colors">Save</button>
                          <button onClick={() => setEditingStepIdx(null)} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 transition-colors">Cancel</button>
                          {steps[i].step_fields?.length > 0 && (
                            <button onClick={() => { setSteps(p => p.map((s, idx) => idx === i ? { ...s, step_fields: undefined } : s)); setEditingStepIdx(null) }}
                              className="text-xs text-red-400/70 hover:text-red-400 px-3 py-1.5 transition-colors ml-auto">Remove form</button>
                          )}
                        </div>
                      </div>
                    )}
                    {i < steps.length - 1 && (
                      <div className="flex items-center gap-2 pl-11 py-0.5">
                        <div className={`w-px h-3 ${s.step_type === 'human_approval' ? 'bg-amber-500/30' : steps[i+1]?.step_type === 'human_approval' ? 'bg-amber-500/30' : 'bg-[#6C5CE7]/25'}`} />
                        <span className={`text-[9px] ${steps[i+1]?.step_type === 'human_approval' ? 'text-amber-500/60' : s.step_type === 'human_approval' ? 'text-amber-500/60' : 'text-[#6C5CE7]/50'}`}>
                          {steps[i+1]?.step_type === 'human_approval' ? 'needs approval →' : s.step_type === 'human_approval' ? 'approved →' : 'output → input'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                {getOrderWarning() && (
                  <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2.5 mt-1">
                    <span className="text-amber-400 text-sm shrink-0">⚠</span>
                    <p className="text-[11px] text-amber-300 leading-relaxed">{getOrderWarning()} — consider reordering with the ↑↓ arrows.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Add steps</p>
                {steps.length > 0 && (
                  <span className="text-[10px] text-slate-400">
                    {scoringAI ? '⟳ scoring…' : '· sorted by compatibility'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button onClick={() => setShowApprovalPicker(v => !v)}
                    className="flex items-center gap-1.5 text-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 px-3 py-1.5 rounded-lg transition-all">
                    ✋ + Approval Gate
                  </button>
                  {showApprovalPicker && (
                    <div className="absolute right-0 top-full mt-1 w-64 bg-[#1A2038] border border-white/18 rounded-xl shadow-xl z-20 overflow-hidden">
                      {Object.entries(APPROVAL_TYPES).map(([type, t]) => (
                        <button key={type} onClick={() => addApprovalStep(type)}
                          className="w-full flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left">
                          <span className="text-lg shrink-0 mt-0.5">{t.emoji}</span>
                          <div>
                            <p className="text-sm text-white font-medium leading-tight">{t.label}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{t.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => setShowApiModal(true)}
                  className="flex items-center gap-1.5 text-xs bg-[#0984E3]/15 hover:bg-[#0984E3]/25 border border-[#0984E3]/30 text-[#0984E3] px-3 py-1.5 rounded-lg transition-all">
                  🔗 + API Call
                </button>
              </div>
            </div>
            <input className={`${inCls} mb-3`} placeholder="Search apps..."
              value={search} onChange={e => setSearch(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {unusedApps
                .map(a => ({ ...a, compat: getAppScore(a) }))
                .sort((a, b) => (b.compat?.score ?? -1) - (a.compat?.score ?? -1))
                .map(a => {
                  const s = a.compat
                  const scoreColor = !s ? 'text-slate-400'
                    : s.score >= 80 ? 'text-green-400'
                    : s.score >= 60 ? 'text-yellow-400'
                    : 'text-slate-400'
                  const borderColor = !s ? 'border-white/22'
                    : s.score >= 80 ? 'border-green-400/30'
                    : s.score >= 60 ? 'border-yellow-400/20'
                    : 'border-white/18'
                  return (
                    <button key={a.id} onClick={() => addStep(a)}
                      className={`flex items-center gap-1.5 text-xs bg-[#1A2038] hover:bg-[#222840] border ${borderColor} hover:border-[#6C5CE7]/50 text-slate-400 hover:text-white px-3 py-1.5 rounded-lg transition-all`}>
                      <span>{a.emoji}</span>
                      <span>{a.name}</span>
                      {s && (
                        <span className={`font-semibold ${scoreColor}`}>
                          {s.score}%{s.source === 'usage' ? '' : '~'}
                        </span>
                      )}
                    </button>
                  )
                })}
              {unusedApps.length === 0 && <p className="text-slate-400 text-xs">All apps added</p>}
            </div>
            {steps.length > 0 && (
              <p className="text-[10px] text-slate-400 mt-2">
                100–70% = used together in real workflows · 90%~ = AI-estimated · lower = likely incompatible
              </p>
            )}
          </div>
        </div>
        )}

        {!showAI && <div className="flex gap-2 px-6 py-4 border-t border-white/18 shrink-0">
          <button onClick={save} disabled={saving || !name.trim() || steps.length < 1}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-6 py-2.5 rounded-xl font-medium transition-colors">
            {saving ? 'Saving...' : existingFlow ? '✓ Save changes' : '✓ Create workflow'}
          </button>
          <button onClick={onCancel} className="bg-[#1A2038] hover:bg-[#222840] text-slate-300 text-sm px-4 py-2.5 rounded-xl transition-colors">
            Cancel
          </button>
        </div>}
      </div>
      {showApiModal && <ApiStepModal onSave={addApiStep} onCancel={() => setShowApiModal(false)} />}
    </div>
  )
}
