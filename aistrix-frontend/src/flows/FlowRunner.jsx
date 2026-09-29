import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExportActions } from '../components/OutputRenderer'
import { duplicateApp } from '../utils/appActions'
import RunRating from '../components/RunRating'
import { API_URL, APP_DEFAULT_FIELDS } from './flowConstants'
import { shortModelName, mergeMemory, streamRun, sendToIntegration, extractFacts } from './flowUtils'

function NativeStepForm({ schema, values, onChange }) {
  const cls = 'w-full bg-[#09101F] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'
  return (
    <div className="space-y-3">
      {schema.map(f => (
        <div key={f.id}>
          <label className="text-xs text-slate-400 block mb-1.5">
            {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
          </label>
          {f.type === 'textarea' ? (
            <textarea className={cls} rows={3} placeholder={f.placeholder}
              value={values[f.id] || ''}
              onChange={e => onChange({ ...values, [f.id]: e.target.value })} />
          ) : f.type === 'select' ? (
            <select className={cls} value={values[f.id] || ''}
              onChange={e => onChange({ ...values, [f.id]: e.target.value })}>
              <option value="">Select…</option>
              {(f.options || '').split(',').map(o => o.trim()).filter(Boolean).map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
              className={cls} placeholder={f.placeholder}
              value={values[f.id] || ''}
              onChange={e => onChange({ ...values, [f.id]: e.target.value })} />
          )}
        </div>
      ))}
    </div>
  )
}

export default function FlowRunner({ flow, user, onClose, onShowHistory, onRunComplete }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [inputs, setInputs] = useState({})
  const [formValues, setFormValues] = useState({})
  const [stepAppData, setStepAppData] = useState({})
  const [results, setResults] = useState({})
  const [memory, setMemory] = useState(flow.memory || {})
  const [provenance, setProvenance] = useState(flow.memory_provenance || {})
  const [editingFact, setEditingFact] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [sendStatus, setSendStatus] = useState('idle')
  const [stepModels, setStepModels] = useState({})
  const [stepRunIds, setStepRunIds] = useState({})
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [tokenSource, setTokenSource] = useState(null)
  const [credits, setCredits] = useState(null)
  const [wfContext, setWfContext] = useState({ source: {}, derived: {} })
  const toast = useToast()

  const steps = flow.steps || []
  const current = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1
  const allDone = stepIndex >= steps.length

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      fetch(`${API_URL}/credits`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json()).then(setCredits).catch(() => {})
    })
  }, [])

  useEffect(() => {
    if (!current?.app_id || stepAppData[stepIndex]) return
    supabase.from('apps')
      .select('system_prompt, ai_provider, ai_model, app_type, form_schema')
      .eq('id', current.app_id).single()
      .then(({ data }) => { if (data) setStepAppData(p => ({ ...p, [stepIndex]: data })) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stepAppData is read as a cache check, not a trigger
  }, [stepIndex, current?.app_id])

  const isApiCallStep = current?.step_type === 'api_call'
  const isApprovalStep = current?.step_type === 'human_approval'
  const currentApp = stepAppData[stepIndex]
  const isNativeStep = !isApiCallStep && !isApprovalStep && currentApp?.app_type === 'native'
    && Array.isArray(currentApp?.form_schema) && currentApp.form_schema.length > 0

  const [approvalEdits, setApprovalEdits] = useState({})
  const [assignEmail, setAssignEmail] = useState('')
  const [assignNote, setAssignNote] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)

  function approvalPreviousOutput() {
    return results[stepIndex - 1] || inputs[stepIndex] || ''
  }
  function approveStep() {
    const content = current?.approval_type === 'edit'
      ? (approvalEdits[stepIndex] ?? approvalPreviousOutput())
      : approvalPreviousOutput()
    setResults(p => ({ ...p, [stepIndex]: content }))
    if (!isLast) setInputs(p => ({ ...p, [stepIndex + 1]: content }))
    setShowRejectForm(false)
  }
  function rejectWorkflow() {
    const reason = rejectionReason.trim() || 'Rejected at approval step.'
    toast(`Workflow stopped: ${reason}`, 'error')
    onClose()
  }

  const effectiveStepFields = current?.step_fields?.length
    ? current.step_fields
    : (!isApiCallStep && !isApprovalStep && current?.app_name
        ? APP_DEFAULT_FIELDS[current.app_name.toLowerCase()] || null
        : null)
  const hasStepFields = !!(effectiveStepFields?.length)

  function buildStepInput() {
    if (hasStepFields) {
      const vals = formValues[stepIndex] || {}
      return (effectiveStepFields || [])
        .map(f => vals[f.id]?.trim() ? `${f.label}: ${vals[f.id]}` : null)
        .filter(Boolean).join('\n')
    }
    if (isNativeStep) {
      const vals = formValues[stepIndex] || {}
      return (currentApp.form_schema || [])
        .map(f => vals[f.id]?.trim() ? `${f.label}: ${vals[f.id]}` : null)
        .filter(Boolean).join('\n')
    }
    return inputs[stepIndex] || ''
  }

  function isStepReady() {
    if (isApiCallStep) return true
    if (!currentApp) return false
    if (hasStepFields) {
      return (effectiveStepFields || []).filter(f => f.required)
        .every(f => (formValues[stepIndex] || {})[f.id]?.trim())
    }
    if (isNativeStep) {
      return (currentApp.form_schema || []).filter(f => f.required)
        .every(f => (formValues[stepIndex] || {})[f.id]?.trim())
    }
    return !!(inputs[stepIndex]?.trim())
  }

  function getReadinessScore() {
    if (isApiCallStep || isApprovalStep) return 'ready'
    const fields = hasStepFields ? effectiveStepFields : isNativeStep ? currentApp?.form_schema : []
    if (!fields?.length) {
      const raw = inputs[stepIndex] || ''
      if (!raw.trim()) return 'incomplete'
      if (raw.trim().split(/\s+/).length < 3) return 'invalid'
      return 'ready'
    }
    const vals = formValues[stepIndex] || {}
    const required = fields.filter(f => f.required)
    const missingRequired = required.filter(f => !vals[f.id]?.trim())
    if (missingRequired.length) return 'incomplete'
    const tooShort = required.filter(f => (vals[f.id]?.trim().length || 0) < 3)
    if (tooShort.length) return 'invalid'
    return 'ready'
  }

  useEffect(() => {
    if (!allDone || !flow.integration_webhook_url || sendStatus !== 'idle') return
    setSendStatus('sending')
    sendToIntegration(flow.integration_webhook_url, flow, results, steps)
      .then(() => setSendStatus('sent'))
      .catch(() => setSendStatus('error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire when allDone flips true
  }, [allDone])

  const completedRef = useRef(false)
  useEffect(() => {
    if (allDone && !completedRef.current) {
      completedRef.current = true
      onRunComplete?.(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- completedRef guard prevents re-firing
  }, [allDone])

  function buildWorkflowContext() {
    const sourceLines = []
    for (let i = 0; i < stepIndex; i++) {
      const s = steps[i]
      const fields = s.step_fields?.length ? s.step_fields : APP_DEFAULT_FIELDS[s.app_name?.toLowerCase()] || []
      const vals = wfContext.source[i] || {}
      const filled = fields.filter(f => vals[f.id]?.trim())
      if (filled.length) {
        sourceLines.push(`${s.app_name} (Step ${i + 1}):`)
        filled.forEach(f => sourceLines.push(`  • ${f.label}: ${vals[f.id]}`))
      }
    }
    const derivedLines = []
    for (let i = 0; i < stepIndex; i++) {
      if (results[i] !== undefined) {
        const s = steps[i]
        derivedLines.push(`### Step ${i + 1} — ${s.app_name}:\n${results[i]}`)
      }
    }
    if (!sourceLines.length && !derivedLines.length) return null
    const parts = []
    if (sourceLines.length) {
      parts.push(`SOURCE DATA (verified user input — treat as ground truth):\n${sourceLines.join('\n')}`)
    }
    if (derivedLines.length) {
      parts.push(`DERIVED DATA (AI-generated from prior steps — use as context, not as final facts):\n${derivedLines.join('\n\n')}`)
    }
    return parts.join('\n\n═══\n\n')
  }

  function buildHistoryContext() { return buildWorkflowContext() }

  function buildMemoryContext() {
    if (!Object.keys(memory).length) return null
    return Object.entries(memory).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n')
  }

  async function runStep() {
    setLoading(true); setError('')

    if (tokenSource === null) {
      const { data } = await supabase.from('user_api_keys').select('id').eq('is_active', true).limit(1)
      setTokenSource(data?.length ? 'user' : 'platform')
    }

    if (isApiCallStep) {
      try {
        const previousOutput = results[stepIndex - 1] || inputs[stepIndex] || ''
        const fill = (t) => t?.replace(/\{\{previous_output\}\}/gi, previousOutput) || ''
        const { data: { session } } = await supabase.auth.getSession()

        const res = await fetch(`${API_URL}/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            method: current.api_method || 'GET',
            url: fill(current.api_url),
            body: current.api_body ? fill(current.api_body) : undefined,
            headers: current.api_headers ? JSON.parse(current.api_headers) : undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `API returned ${res.status}`)

        const resultText = typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2)
        setResults(p => ({ ...p, [stepIndex]: resultText }))
        if (!isLast) setInputs(p => ({ ...p, [stepIndex + 1]: resultText }))
        const thisStepIndex = stepIndex
        async function saveHistory() {
          const { data: row, error } = await supabase.from('run_history').insert({ user_id: user.id, app_id: null, app_name: current.app_name, input: fill(current.api_url), output: resultText, flow_id: flow.id, flow_name: flow.name }).select('id').single()
          if (row) { setStepRunIds(p => ({ ...p, [thisStepIndex]: row.id })); return }
          if (error) toast(`Step completed, but wasn't saved to history: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveHistory })
        }
        await saveHistory()
        if (!isLast) setConnecting(true)
      } catch (e) { setError(e.message); toast(e.message, 'error') }
      finally { setLoading(false); setConnecting(false) }
      return
    }

    const stepInput = buildStepInput()
    if (!stepInput.trim()) return

    const fields = effectiveStepFields || []
    const vals = formValues[stepIndex] || {}
    if (fields.length) {
      setWfContext(prev => ({
        ...prev,
        source: { ...prev.source, [stepIndex]: Object.fromEntries(fields.map(f => [f.id, vals[f.id] || ''])) }
      }))
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const appData = currentApp
        || (await supabase.from('apps').select('system_prompt, ai_provider, ai_model, app_type, form_schema').eq('id', current.app_id).single()).data

      const workspaceProvider = flow.default_provider || 'auto'
      let chosenProvider = appData?.ai_provider || 'claude'
      let chosenModel = appData?.ai_model || null
      if (workspaceProvider !== 'auto') {
        chosenProvider = workspaceProvider
        chosenModel = null
      } else {
        try {
          const selRes = await fetch(`${API_URL}/select-model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
            body: JSON.stringify({ system_prompt: appData?.system_prompt, input: stepInput, provider: appData?.ai_provider || 'claude' }),
          })
          if (selRes.ok) {
            const sel = await selRes.json()
            chosenModel = sel.model
            toast(`🤖 ${sel.label}`, 'info', 2000)
          }
        } catch {}
      }

      let priorResponses = []
      if (current.app_id) {
        const { data: history } = await supabase
          .from('run_history')
          .select('result')
          .eq('app_id', current.app_id)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(3)
        if (history) priorResponses = history.map(h => h.result).filter(Boolean).reverse()
      }
      const historyContext = buildHistoryContext()
      const memoryContext = buildMemoryContext()

      let knowledgeContext = ''
      if (flow.use_knowledge_vault) {
        const { data: kvEntries } = await supabase
          .from('knowledge_vault')
          .select('title, content')
          .eq('user_id', user.id)
          .limit(12)
        if (kvEntries?.length) {
          knowledgeContext = kvEntries.map(e => `### ${e.title}\n${e.content}`).join('\n\n')
        }
      }

      const blocks = []
      if (flow.gpt_instructions) blocks.push(`You are acting as part of "${flow.gpt_name || 'this workflow\'s dedicated assistant'}" — a standing intelligence that governs every app in this workflow. Follow these standing instructions for every response, in addition to your normal role:\n${flow.gpt_instructions}`)
      if (knowledgeContext) blocks.push(`Company Knowledge Vault — use this information to inform your response. Prioritise it over generic assumptions:\n\n${knowledgeContext}`)
      if (memoryContext) blocks.push(`Known facts about the user/subject, learned across this workflow over time — keep these actively in mind even if not repeated in the current input:\n${memoryContext}`)
      if (historyContext) blocks.push(`This app is one step in a multi-app workflow. Here is everything produced by earlier steps, in order — use it as context, and if your role is to compare/score/decide between them, do so explicitly:\n\n${historyContext}`)

      const { result: full, provider: runProvider, model: runModel, usage: runUsage } = await streamRun({
        app_id: current.app_id, input: stepInput, system_prompt: appData?.system_prompt,
        ai_provider: chosenProvider,
        ai_model: chosenModel || null,
        user_context: blocks.length ? blocks.join('\n\n---\n\n') : undefined,
        temperature: 1.1,
        prior_responses: priorResponses.length ? priorResponses : undefined,
      }, session, val => setResults(p => ({ ...p, [stepIndex]: val })))

      setStepModels(p => ({ ...p, [stepIndex]: { provider: runProvider, model: runModel, usage: runUsage } }))

      const thisStepIndex = stepIndex
      async function saveHistory() {
        const { data: row, error } = await supabase.from('run_history').insert({
          user_id: user.id, app_id: current.app_id, app_name: current.app_name, input: stepInput, output: full,
          flow_id: flow.id, flow_name: flow.name,
          input_tokens: runUsage?.input_tokens ?? null, output_tokens: runUsage?.output_tokens ?? null,
        }).select('id').single()
        if (row) { setStepRunIds(p => ({ ...p, [thisStepIndex]: row.id })); return }
        if (error) toast(`Step completed, but wasn't saved to history: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveHistory })
      }
      await saveHistory()

      const outputValid = full?.trim().length > 30 && !full.startsWith('Backend error') && !full.startsWith('Error:')
      const outputStatus = !full?.trim() ? 'empty' : full.trim().length < 30 ? 'too_short' : full.startsWith('Backend error') || full.startsWith('Error:') ? 'error' : 'valid'
      if (outputStatus !== 'valid') {
        toast(`⚠ Step output may be low quality (${outputStatus}) — review before continuing`, 'warn', 4000)
      }

      if (outputValid) {
        setWfContext(prev => ({
          ...prev,
          derived: { ...prev.derived, [stepIndex]: { stepName: current.app_name, output: full, status: outputStatus } }
        }))
      }

      if (!isLast) setInputs(p => ({ ...p, [stepIndex + 1]: full }))

      setLoading(false)
      if (!isLast) setConnecting(true)
      const facts = await extractFacts(full, session)
      if (Object.keys(facts).length) {
        setMemory(prevMem => {
          const merged = mergeMemory(prevMem, facts)
          setProvenance(prevProv => {
            const mergedProv = { ...prevProv }
            const now = new Date().toISOString()
            for (const key of Object.keys(facts)) mergedProv[key] = { step_name: current.app_name, step_index: stepIndex, updated_at: now }
            supabase.from('flows').update({ memory: merged, memory_provenance: mergedProv }).eq('id', flow.id)
              .then(({ error }) => { if (error) toast(`Learned facts weren't saved: ${error.message}`, 'error') })
            return mergedProv
          })
          return merged
        })
      }
    } catch (e) { setError(e.message); toast(e.message, 'error') }
    finally { setLoading(false); setConnecting(false) }
  }

  async function saveStepAsApp() {
    const stepApp = stepAppData[stepIndex]
    if (!stepApp) return
    setSavingTemplate(true)
    const { data, error } = await duplicateApp({
      name: current.app_name, emoji: current.app_emoji,
      description: `Extracted from the "${flow.name}" workflow.`,
      ...stepApp,
    }, user.id)
    setSavingTemplate(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Saved as "${data.name}" — find it in My Apps to customize it`, 'success', 4000)
  }

  function saveFactEdit(key) {
    setMemory(prevMem => {
      const merged = { ...prevMem }
      if (editValue.trim() === '') delete merged[key]
      else merged[key] = editValue.trim()
      setProvenance(prevProv => {
        const mergedProv = { ...prevProv }
        if (!(key in merged)) delete mergedProv[key]
        else mergedProv[key] = { step_name: 'manually corrected', step_index: null, updated_at: new Date().toISOString() }
        supabase.from('flows').update({ memory: merged, memory_provenance: mergedProv }).eq('id', flow.id)
          .then(({ error }) => { if (error) toast(`Edit wasn't saved: ${error.message}`, 'error') })
        return mergedProv
      })
      return merged
    })
    setEditingFact(null)
  }

  function deleteFact(key) {
    setMemory(prevMem => {
      const merged = { ...prevMem }
      delete merged[key]
      setProvenance(prevProv => {
        const mergedProv = { ...prevProv }
        delete mergedProv[key]
        supabase.from('flows').update({ memory: merged, memory_provenance: mergedProv }).eq('id', flow.id)
          .then(({ error }) => { if (error) toast(`Delete wasn't saved: ${error.message}`, 'error') })
        return mergedProv
      })
      return merged
    })
  }

  if (steps.length === 0) return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-md p-8 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-white text-lg font-bold mb-2">No steps found</h2>
        <p className="text-slate-400 text-sm mb-2">This workflow has no app steps configured, or the apps it references were not found in your library.</p>
        <p className="text-slate-400 text-xs mb-6">Try editing the workflow to add steps, or reinstall the template after the required apps have been created.</p>
        <button onClick={onClose} className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white px-6 py-2.5 rounded-xl font-medium transition-colors">Close</button>
      </div>
    </div>
  )

  if (allDone) return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="relative bg-[#121829] border border-white/18 rounded-2xl w-full max-w-md p-8 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#6C5CE7]/10 via-transparent to-[#E84393]/10 pointer-events-none" />
        <div className="relative">
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-lg shadow-[#6C5CE7]/20"
            style={{ background: 'linear-gradient(135deg, #6C5CE7, #E84393)' }}>🎉</div>
          <h2 className="text-white text-xl font-bold mb-2">Workflow complete!</h2>
          <p className="text-slate-400 text-sm mb-2">All {steps.length} steps finished. Results saved to your history.</p>
          {(() => {
            const totals = Object.values(stepModels).reduce((acc, s) => ({
              input: acc.input + (s.usage?.input_tokens || 0),
              output: acc.output + (s.usage?.output_tokens || 0),
            }), { input: 0, output: 0 })
            return (totals.input || totals.output) ? (
              <p className="text-[11px] text-slate-500 mb-6" title="Total tokens used across all steps">
                ↑{totals.input.toLocaleString()} in · ↓{totals.output.toLocaleString()} out tokens
              </p>
            ) : <div className="mb-4" />
          })()}
          {flow.integration_webhook_url && (
            <p className="text-xs mb-4">
              {sendStatus === 'sending' && <span className="text-slate-400">Sending to integration...</span>}
              {sendStatus === 'sent' && <span className="text-green-400">✓ Sent to integration</span>}
              {sendStatus === 'error' && (
                <button onClick={() => { setSendStatus('idle') }} className="text-red-400 hover:text-red-300">⚠ Failed to send — tap to retry</button>
              )}
            </p>
          )}
          <div className="flex flex-col gap-2 items-center">
            <div className="flex gap-2 justify-center">
              <ExportActions
                result={steps.map((s, i) => `## ${i + 1}. ${s.app_name}\n\n${results[i] || ''}`).join('\n\n---\n\n')}
                title={`${flow.name} — Full workflow results`}
                buttonLabel="⬇ Export all"
                buttonClassName="bg-[#1A2038] hover:bg-[#222840] text-slate-300 text-sm px-6 py-2.5 rounded-xl font-medium transition-colors"
                align="left"
              />
              <button onClick={onClose} className="bg-gradient-to-r from-[#6C5CE7] to-[#8B7CF6] hover:from-[#7D6FF0] hover:to-[#9C8FFF] text-white px-8 py-2.5 rounded-xl font-medium transition-all shadow-md shadow-[#6C5CE7]/20">Done</button>
            </div>
            <button onClick={() => { onClose(); onShowHistory?.() }}
              className="text-xs text-slate-400 hover:text-slate-300 transition-colors">
              🕘 View in Run History
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden" style={{ height: '85vh' }}>

        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/18 shrink-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-[#6C5CE7]/8 via-transparent to-[#E84393]/8 pointer-events-none" />
          <div className="relative flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
              style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.3), rgba(232,67,147,0.2))' }}>{flow.emoji}</div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-white font-semibold">{flow.name}</p>
                {flow.gpt_name && (
                  <span className="text-[9px] text-[#A29BFE] bg-[#6C5CE7]/15 px-2 py-0.5 rounded-full font-medium">🧠 {flow.gpt_name}</span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Step {stepIndex + 1} of {steps.length}</p>
            </div>
          </div>
          <div className="relative flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[10px]">
              {tokenSource === 'user'
                ? <span className="text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">🔑 Your API key</span>
                : tokenSource === 'platform'
                  ? <span className="text-[#A29BFE] bg-[#6C5CE7]/10 px-2 py-0.5 rounded-full">⚡ Aistrix credits</span>
                  : null
              }
            </div>
            <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-xl leading-none">✕</button>
          </div>
        </div>

        {/* Step progress */}
        <div className="px-6 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-0">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1 relative">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-all shrink-0
                    ${i < stepIndex ? 'bg-green-500 border-green-500 text-white'
                    : i === stepIndex && s.step_type === 'human_approval' ? 'bg-amber-500 border-amber-500 text-white'
                    : i === stepIndex ? 'bg-[#6C5CE7] border-[#6C5CE7] text-white'
                    : s.step_type === 'human_approval' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-[#1A2038] border-white/18 text-slate-400'}`}>
                    {i < stepIndex ? '✓' : s.step_type === 'human_approval' ? '✋' : s.app_emoji || i + 1}
                  </div>
                  {((i === stepIndex && loading) || (connecting && i === stepIndex - 1)) && (
                    <span className="absolute -top-1.5 -right-1.5 text-sm animate-pulse">🧠</span>
                  )}
                  <span className="text-[9px] text-slate-300 w-14 text-center truncate leading-tight">{s.app_name}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 mb-4 ${i < stepIndex ? 'bg-green-500' : 'bg-white/8'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 min-h-0 px-6 pb-2 space-y-4">
          {Object.keys(memory).length > 0 && (
            <div className="bg-[#6C5CE7]/8 border border-[#6C5CE7]/20 rounded-xl p-4">
              <p className="text-[10px] text-[#A29BFE] font-semibold uppercase tracking-wide mb-2">🧠 Workflow mind — learned facts, evolves with every run. Click a fact to correct it.</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(memory).map(([k, v]) => {
                  const prov = provenance[k]
                  const display = Array.isArray(v) ? v.join(', ') : v
                  return editingFact === k ? (
                    <span key={k} className="flex items-center gap-1 bg-[#1A2038] border border-[#6C5CE7]/40 rounded-lg px-2 py-1">
                      <span className="text-[11px] text-slate-300">{k}:</span>
                      <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveFactEdit(k); if (e.key === 'Escape') setEditingFact(null) }}
                        className="text-[11px] bg-transparent text-white focus:outline-none w-32" />
                      <button onClick={() => saveFactEdit(k)} className="text-green-400 text-xs hover:text-green-300">✓</button>
                      <button aria-label="Cancel edit" onClick={() => setEditingFact(null)} className="text-slate-400 text-xs hover:text-white">✕</button>
                    </span>
                  ) : (
                    <span key={k} title={prov ? `Learned from ${prov.step_name}${prov.updated_at ? ` · ${new Date(prov.updated_at).toLocaleDateString()}` : ''}` : undefined}
                      className="group/fact flex items-center gap-1 text-[11px] bg-[#1A2038] text-slate-300 pl-2.5 pr-1 py-1 rounded-lg hover:border hover:border-[#6C5CE7]/40">
                      <span className="text-slate-400">{k}:</span> {display}
                      <button onClick={() => { setEditingFact(k); setEditValue(display) }}
                        className="ml-1 text-slate-400 hover:text-white opacity-0 group-hover/fact:opacity-100 transition-opacity px-1">✏️</button>
                      <button aria-label={`Delete fact ${k}`} onClick={() => deleteFact(k)}
                        className="text-slate-400 hover:text-red-400 opacity-0 group-hover/fact:opacity-100 transition-opacity px-1">✕</button>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {stepIndex > 0 && !isApprovalStep && (
            <div className="bg-[#09101F] border border-white/18 rounded-xl p-4">
              <p className="text-[10px] text-[#6C5CE7] font-semibold uppercase tracking-wide mb-2">
                🧠 Workflow memory — this step sees all {stepIndex} earlier output{stepIndex > 1 ? 's' : ''}
              </p>
              <div className="space-y-2 max-h-28 overflow-y-auto">
                {steps.slice(0, stepIndex).map((s, i) => results[i] !== undefined && (
                  <div key={i} className="text-xs leading-relaxed">
                    <span className="text-slate-400 font-medium">{s.app_emoji} {s.app_name}: </span>
                    <span className="text-slate-400">{results[i].slice(0, 160)}{results[i].length > 160 ? '...' : ''}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-2">The immediate previous output is also pre-filled into the input below — edit it freely.</p>
            </div>
          )}

          {isApprovalStep ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
                <span className="text-2xl shrink-0">✋</span>
                <div>
                  <p className="text-amber-300 font-semibold text-sm">{current.app_name}</p>
                  <p className="text-amber-200/70 text-xs mt-0.5">
                    {current.approval_type === 'review' && 'Review the output below and approve or reject before the workflow continues.'}
                    {current.approval_type === 'edit' && 'Edit the output below before it passes to the next step.'}
                    {current.approval_type === 'assign' && 'Assign this output to a teammate for review, then approve to continue.'}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium mb-2">Output from previous step</p>
                {current.approval_type === 'edit' ? (
                  <textarea
                    className="w-full bg-[#1A2038] border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-white resize-none focus:outline-none focus:border-amber-400 transition-colors"
                    rows={6}
                    value={approvalEdits[stepIndex] ?? approvalPreviousOutput()}
                    onChange={e => setApprovalEdits(p => ({ ...p, [stepIndex]: e.target.value }))}
                  />
                ) : (
                  <div className="bg-[#1A2038] border border-white/18 rounded-xl p-4 text-sm text-slate-300 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                    {approvalPreviousOutput() || <span className="text-slate-500 italic">No output from previous step yet.</span>}
                  </div>
                )}
              </div>
              {current.approval_type === 'assign' && (
                <div className="space-y-2">
                  <input type="email" placeholder="Teammate's email address" value={assignEmail} onChange={e => setAssignEmail(e.target.value)}
                    className="w-full bg-[#1A2038] border border-white/18 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors" />
                  <textarea placeholder="Add a note for your teammate (optional)" value={assignNote} onChange={e => setAssignNote(e.target.value)} rows={2}
                    className="w-full bg-[#1A2038] border border-white/18 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-amber-400 transition-colors" />
                  <a href={assignEmail ? `mailto:${assignEmail}?subject=Review needed: ${encodeURIComponent(flow.name)}&body=${encodeURIComponent(`Hi,\n\nPlease review this output from the "${flow.name}" workflow:\n\n${approvalPreviousOutput()}\n\n${assignNote ? `Note: ${assignNote}\n\n` : ''}Thanks`)}` : undefined}
                    onClick={e => { if (!assignEmail) { e.preventDefault(); toast('Enter a teammate email first', 'error') } }}
                    className="inline-flex items-center gap-2 text-xs bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 px-4 py-2 rounded-lg transition-all">
                    📧 Open email to teammate
                  </a>
                </div>
              )}
              {showRejectForm && (
                <div className="space-y-2">
                  <input autoFocus placeholder="Reason for rejection (optional)" value={rejectionReason} onChange={e => setRejectionReason(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') rejectWorkflow(); if (e.key === 'Escape') setShowRejectForm(false) }}
                    className="w-full bg-[#1A2038] border border-red-500/30 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-400 transition-colors" />
                  <div className="flex gap-2">
                    <button onClick={rejectWorkflow} className="text-xs bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg transition-all">Confirm Reject & Stop</button>
                    <button onClick={() => setShowRejectForm(false)} className="text-xs text-slate-400 hover:text-white px-3 py-2 transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div>
            <div className="flex justify-center mb-3">
              <div className="inline-flex items-center gap-1.5 bg-[#6C5CE7]/15 border border-[#6C5CE7]/40 text-[#a89cf7] text-xs font-semibold px-3 py-1 rounded-full">
                {current.app_emoji} {current.app_name}
              </div>
            </div>
            {isApiCallStep ? (
              <div className="bg-[#0984E3]/8 border border-[#0984E3]/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[#0984E3] bg-[#0984E3]/15 px-2 py-0.5 rounded">{current.api_method}</span>
                  <code className="text-xs text-slate-300 truncate flex-1">{current.api_url}</code>
                </div>
                {stepIndex > 0 && (
                  <p className="text-[11px] text-slate-300">
                    <span className="text-[#0984E3]">{'{{previous_output}}'}</span> will be replaced with the output from step {stepIndex}.
                  </p>
                )}
                <p className="text-[11px] text-slate-300">This step runs automatically — no input needed.</p>
              </div>
            ) : hasStepFields ? (
              <div className="space-y-3">
                {(effectiveStepFields || []).map(f => {
                  const suggestions = (f.placeholder || '').includes('e.g.')
                    ? (f.placeholder || '').replace(/^.*e\.g\.\s*/i, '').split(/\s*[\/,]\s*/).map(s => s.trim()).filter(Boolean)
                    : []
                  const listId = `dl-${stepIndex}-${f.id}`
                  return (
                    <div key={f.id}>
                      <label className="block text-xs text-slate-300 font-medium mb-1">
                        {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
                      </label>
                      <input
                        className="w-full bg-[#1A2038] border border-white/18 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                        placeholder={f.placeholder || `Enter ${f.label.toLowerCase()}…`}
                        value={(formValues[stepIndex] || {})[f.id] || ''}
                        onChange={e => setFormValues(p => ({ ...p, [stepIndex]: { ...(p[stepIndex] || {}), [f.id]: e.target.value } }))}
                        spellCheck={true}
                        list={suggestions.length ? listId : undefined}
                      />
                      {suggestions.length > 0 && (
                        <datalist id={listId}>
                          {suggestions.map(s => <option key={s} value={s} />)}
                        </datalist>
                      )}
                    </div>
                  )
                })}
                <div className="flex items-center justify-between mt-1">
                  {stepIndex > 0 && results[stepIndex - 1]
                    ? <p className="text-[11px] text-slate-500">Previous step output is also available as context.</p>
                    : <span />
                  }
                  <button
                    onClick={() => {
                      const sample = {}
                      for (const f of effectiveStepFields || []) {
                        const eg = (f.placeholder || '').match(/e\.g\.\s*([^/,]+)/i)
                        if (eg) sample[f.id] = eg[1].trim()
                      }
                      setFormValues(p => ({ ...p, [stepIndex]: sample }))
                    }}
                    className="text-[11px] text-[#6C5CE7] hover:text-[#a89cf7] transition-colors underline underline-offset-2 shrink-0"
                  >
                    Try with sample data
                  </button>
                </div>
              </div>
            ) : isNativeStep ? (
              <NativeStepForm
                schema={currentApp.form_schema}
                values={formValues[stepIndex] || {}}
                onChange={vals => setFormValues(p => ({ ...p, [stepIndex]: vals }))}
              />
            ) : (
              <textarea
                className="w-full bg-[#1A2038] border border-white/18 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-400 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors"
                rows={4}
                placeholder={currentApp ? `Enter input for ${current.app_name}…` : 'Loading…'}
                value={inputs[stepIndex] || ''}
                onChange={e => setInputs(p => ({ ...p, [stepIndex]: e.target.value }))}
                spellCheck={true}
                autoComplete="on"
              />
            )}
          </div>
          )}

          {!isApprovalStep && error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

          {!isApprovalStep && results[stepIndex] && (
            <div className="bg-[#1A2038] border border-white/22 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/18">
                <p className="text-[11px] text-slate-300 font-medium">Result</p>
                <div className="flex items-center gap-2">
                  {loading
                    ? <span className="text-[10px] text-slate-400 animate-pulse">⟳ Streaming…</span>
                    : <span className="text-[10px] text-green-400">✓ Complete</span>
                  }
                  {stepModels[stepIndex] && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400">
                      {stepModels[stepIndex].provider === 'openai' ? '🟢' : '🟣'} {shortModelName(stepModels[stepIndex].model)}
                    </span>
                  )}
                  {stepModels[stepIndex]?.usage && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400" title="Tokens used for this step">
                      ↑{stepModels[stepIndex].usage.input_tokens?.toLocaleString()} ↓{stepModels[stepIndex].usage.output_tokens?.toLocaleString()} tok
                    </span>
                  )}
                  {!loading && stepRunIds[stepIndex] && <RunRating key={stepRunIds[stepIndex]} runId={stepRunIds[stepIndex]} />}
                  <ExportActions result={results[stepIndex]} title={`${flow.name} — ${current.app_name}`} />
                  {current.app_id && stepAppData[stepIndex] && (
                    <button onClick={saveStepAsApp} disabled={savingTemplate}
                      title="Save this step as its own reusable app"
                      className="text-[10px] text-slate-400 hover:text-slate-300 disabled:opacity-50 transition-colors">
                      {savingTemplate ? '⟳ Saving...' : '💾 Save as app'}
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 text-sm text-slate-200 max-h-52 overflow-y-auto leading-relaxed prose-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{results[stepIndex]}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* Credits bar */}
        {credits && !credits.unlimited && (
          <div className="px-6 py-2 border-b border-white/18 bg-[#09101F]/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400">⚡ Aistrix credits today</span>
              <span className="text-[10px] text-slate-400">{credits.daily_remaining} / {credits.daily_limit} remaining</span>
            </div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{
                  width: `${(credits.daily_used / credits.daily_limit) * 100}%`,
                  background: credits.daily_remaining < 20 ? '#EF4444' : credits.daily_remaining < 50 ? '#F59E0B' : '#6C5CE7'
                }} />
            </div>
            {credits.daily_remaining < 20 && (
              <p className="text-[10px] text-amber-400 mt-1">Running low — add your API key in Settings → Keys to get unlimited runs.</p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/18 flex items-center justify-between shrink-0">
          <button onClick={() => { setStepIndex(i => i - 1); setError(''); setShowRejectForm(false) }} disabled={stepIndex === 0}
            className="text-sm px-4 py-2 rounded-xl bg-[#1A2038] hover:bg-[#222840] disabled:opacity-30 text-slate-300 transition-colors">
            ← Back
          </button>
          {isApprovalStep ? (
            <div className="flex items-center gap-2">
              {!showRejectForm && (
                <button onClick={() => setShowRejectForm(true)}
                  className="text-sm px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 transition-colors">
                  ✕ Reject
                </button>
              )}
              <button onClick={() => { approveStep(); isLast ? setStepIndex(steps.length) : setStepIndex(i => i + 1) }}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm px-6 py-2 rounded-xl font-medium transition-colors">
                ✓ {current.approval_type === 'edit' ? 'Confirm & Continue' : 'Approve & Continue'}
              </button>
            </div>
          ) : (!results[stepIndex] || loading) ? (
            <div className="flex items-center gap-3">
              {(() => {
                const score = getReadinessScore()
                const cfg = {
                  ready:      { color: '#00B894', icon: '✓', label: 'Ready'      },
                  incomplete: { color: '#FDCB6E', icon: '○', label: 'Incomplete' },
                  invalid:    { color: '#E17055', icon: '⚠', label: 'Too vague'  },
                }[score]
                return (
                  <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: cfg.color }}>
                    {cfg.icon} {cfg.label}
                  </span>
                )
              })()}
              <button onClick={runStep} disabled={loading || !isStepReady()}
                className="flex items-center gap-2 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-6 py-2 rounded-xl font-medium transition-colors">
                {loading ? <><span className="animate-spin inline-block">⟳</span> Running…</> : isApiCallStep ? `🔗 Call API` : `▶ Run ${current.app_name}`}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setResults(p => { const n = { ...p }; delete n[stepIndex]; return n }); setError('') }}
                className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl bg-[#1A2038] hover:bg-[#222840] text-slate-300 transition-colors"
                title="Edit input and re-run this step"
              >
                ⟳ Re-run
              </button>
              <button onClick={() => isLast ? setStepIndex(steps.length) : setStepIndex(i => i + 1)}
                className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-6 py-2 rounded-xl font-medium transition-colors">
                {isLast ? '✓ Finish' : 'Next →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
