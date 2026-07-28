import { useState, useEffect, useRef, useCallback, useTransition, Suspense, lazy } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '../supabase'
import { PLACEHOLDERS } from '../utils'
import { useToast } from '../hooks/useToast'
import { buildCareerContext, buildBusinessContext } from '../utils/profileContext'
import OutputRenderer, { ThinkingIndicator } from './OutputRenderer'
import { createNotification } from '../utils/notifications'
import { parseSSELine } from '../lib/sse'
import { duplicateApp, emailResult, friendlyErrorMessage } from '../utils/appActions'
import RunRating from './RunRating'

// Lazy-loaded — keeps the Stripe SDK out of the main bundle until a paid app is actually run
const PaymentModal = lazy(() => import('./PaymentModal'))

function SendToApp({ result }) {
  const [open, setOpen] = useState(false)
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(false)

  async function loadApps() {
    setLoading(true)
    const { data } = await supabase.from('apps').select('id, name, emoji').eq('is_published', true).order('total_runs', { ascending: false }).limit(20)
    setApps(data || [])
    setLoading(false)
  }

  function sendTo(targetApp) {
    // Store result as pending input for the target app, then navigate
    sessionStorage.setItem('aistrix_send_input', result)
    sessionStorage.setItem('aistrix_send_app', JSON.stringify(targetApp))
    setOpen(false)
    window.dispatchEvent(new CustomEvent('aistrix:send-to-app', { detail: targetApp }))
  }

  if (!open) return (
    <button onClick={() => { setOpen(true); loadApps() }}
      className="text-[10px] text-slate-500 hover:text-white bg-[#1F2444] hover:bg-[#272C52] px-2.5 py-1 rounded-lg transition-colors">
      ↗ Send to app
    </button>
  )

  return (
    <div className="bg-[#1F2444] border border-white/10 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 font-medium">Send result to another app</p>
        <button aria-label="Close" onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
      </div>
      {loading ? <p className="text-slate-500 text-xs">Loading...</p> : (
        <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
          {apps.map(a => (
            <button key={a.id} onClick={() => sendTo(a)}
              className="flex items-center gap-1.5 text-xs bg-[#0F1225] hover:bg-[#171B33] border border-white/5 text-slate-300 hover:text-white px-2.5 py-2 rounded-lg transition-colors text-left">
              <span>{a.emoji}</span><span className="truncate">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Proactive suggestions shown after every run — turn this one-off result into
// something reusable instead of leaving the user to figure out "what next".
function NextBestActions({ app, user, result, toast }) {
  const [duplicating, setDuplicating] = useState(false)

  function turnIntoWorkflow() {
    window.dispatchEvent(new CustomEvent('aistrix:nav', { detail: 'flows' }))
    window.dispatchEvent(new CustomEvent('aistrix:workflow-from-app', { detail: { id: app.id, name: app.name, emoji: app.emoji } }))
  }

  async function saveAsTemplate() {
    setDuplicating(true)
    const { data, error } = await duplicateApp(app, user.id)
    setDuplicating(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Saved as "${data.name}" — find it in My Apps to customize it`, 'success', 4000)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-slate-500 font-medium mr-0.5">Next best action:</span>
      <button onClick={turnIntoWorkflow}
        className="text-[10px] text-slate-300 hover:text-white bg-[#1F2444] hover:bg-[#272C52] px-2.5 py-1 rounded-lg transition-colors">
        🔀 Turn into workflow
      </button>
      <button onClick={saveAsTemplate} disabled={duplicating}
        className="text-[10px] text-slate-300 hover:text-white bg-[#1F2444] hover:bg-[#272C52] disabled:opacity-50 px-2.5 py-1 rounded-lg transition-colors">
        {duplicating ? '⟳ Saving...' : '💾 Save as template'}
      </button>
      <button onClick={() => emailResult(app.name, result)}
        className="text-[10px] text-slate-300 hover:text-white bg-[#1F2444] hover:bg-[#272C52] px-2.5 py-1 rounded-lg transition-colors">
        📧 Export to email
      </button>
    </div>
  )
}

// Try to extract JSON from result for structured storage
function extractStructuredData(result) {
  try {
    const cleaned = result.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
    try { return JSON.parse(cleaned) } catch {}
    const arr = result.match(/\[[\s\S]*\]/)
    if (arr) { try { return JSON.parse(arr[0]) } catch {} }
    const obj = result.match(/\{[\s\S]*\}/)
    if (obj) { try { return JSON.parse(obj[0]) } catch {} }
  } catch {}
  return null
}

async function findNextAppRecommendation(app, userId) {
  // 1. Developer-configured next step
  if (app.next_app_id) {
    const { data } = await supabase.from('apps').select('id, name, emoji, color, description').eq('id', app.next_app_id).single()
    if (data) return data
  }
  // 2. Next app in same domain by workflow_order that user hasn't run recently
  if (app.domain_id) {
    const { data: domainApps } = await supabase.from('apps')
      .select('id, name, emoji, color, description, workflow_order')
      .eq('domain_id', app.domain_id).eq('is_published', true)
      .gt('workflow_order', app.workflow_order || 0)
      .order('workflow_order').limit(3)
    if (domainApps?.length) {
      const { data: recentRuns } = await supabase.from('run_history')
        .select('app_id').eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      const recentIds = new Set((recentRuns || []).map(r => r.app_id))
      const fresh = domainApps.find(a => !recentIds.has(a.id))
      if (fresh) return fresh
      return domainApps[0]
    }
  }
  return null
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function checkAlerts(userId, input, result, toast) {
  const { data: alerts } = await supabase
    .from('user_alerts').select('*').eq('user_id', userId).eq('is_active', true)
  if (!alerts?.length) return

  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0)
  const { count: todayCount } = await supabase
    .from('run_history').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', startOfDay.toISOString())

  for (const alert of alerts) {
    let triggered = false
    let message = ''

    if (alert.type === 'run_limit') {
      const threshold = Number(alert.condition.threshold)
      if (todayCount >= threshold) { triggered = true; message = `${alert.name}: ${todayCount} of your daily runs used` }
    }
    if (alert.type === 'keyword') {
      const kw = alert.condition.keyword?.toLowerCase()
      if (kw && result.toLowerCase().includes(kw)) { triggered = true; message = `${alert.name}: "${kw}" found in result` }
    }
    if (alert.type === 'rating_streak') {
      const streak = Number(alert.condition.streak)
      const { data: recent } = await supabase.from('run_history').select('rating')
        .eq('user_id', userId).not('rating', 'is', null).order('created_at', { ascending: false }).limit(streak)
      if (recent?.length >= streak && recent.every(r => r.rating === -1)) {
        triggered = true; message = `${alert.name}: ${streak} consecutive thumbs down`
      }
    }

    if (triggered) {
      toast(`🔔 ${message}`, 'info', 5000)
      if (Notification.permission === 'granted') new Notification('Aistrix Alert', { body: message })
      // Push to notifications center
      await createNotification(userId, { type: 'alert', title: 'Alert triggered', message, link_view: 'alerts' })
    }
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function sendNotification(appName) {
  if (Notification.permission !== 'granted') return
  new Notification(`${appName} finished`, {
    body: 'Your result is ready — click to view.',
    icon: '/favicon.ico',
  })
}

function goToSettings() {
  // Navigate within the SPA — dispatch to the app's nav system
  window.dispatchEvent(new CustomEvent('aistrix:nav', { detail: 'settings' }))
}

export default function AppRunner({ app, user, onClose, onRun, inline = false }) {
  const [input, setInput] = useState(() => {
    // Pre-fill from "Send to app" cross-app data sharing
    const sent = sessionStorage.getItem('aistrix_send_input')
    const sentApp = sessionStorage.getItem('aistrix_send_app')
    if (sent && sentApp) {
      try {
        const target = JSON.parse(sentApp)
        if (target.id === app.id) {
          sessionStorage.removeItem('aistrix_send_input')
          sessionStorage.removeItem('aistrix_send_app')
          return sent
        }
      } catch {}
    }
    return ''
  })
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [usage, setUsage] = useState(null) // { input_tokens, output_tokens } | null
  const [nextApp, setNextApp] = useState(null)
  const [bulkMode, setBulkMode] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [toolCalls, setToolCalls] = useState([])
  const [hasTools, setHasTools] = useState(false)
  const [, startTransition] = useTransition()
  const [bulkResults, setBulkResults] = useState([])
  const [bulkProgress, setBulkProgress] = useState(0)
  const [lastRunId, setLastRunId] = useState(null)
  const [profiles, setProfiles] = useState({ career: null, business: null, memory: [], dataSources: [] })
  const [activeContext, setActiveContext] = useState({
    career:   (app.required_context || []).includes('career_profile'),
    business: (app.required_context || []).includes('business_profile'),
    memory:   (app.required_context || []).includes('memory'),
    dataSources: new Set(),
  })
  // Pre-run status: key presence + daily quota
  const [runStatus, setRunStatus] = useState(null) // { hasKey, provider, runsToday, limit }
  const resultRef = useRef('')
  const rafRef = useRef(null)
  const toast = useToast()

  useEffect(() => {
    if (!user) return
    async function loadContext() {
      const [{ data: career }, { data: business }, { data: memory }, { data: dataSources }] = await Promise.all([
        supabase.from('user_career_profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_business_profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_memory').select('key, value').eq('user_id', user.id),
        supabase.from('user_data_sources').select('id, name, type').eq('user_id', user.id).order('created_at', { ascending: false }),
      ])
      startTransition(() => setProfiles({ career: career || null, business: business || null, memory: memory || [], dataSources: dataSources || [] }))
    }
    async function loadRunStatus() {
      const appProvider = app.ai_provider || 'claude'
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
      const [{ data: keys }, { count: runsToday }] = await Promise.all([
        supabase.from('user_api_keys').select('id').eq('user_id', user.id).eq('provider', appProvider).eq('is_active', true).limit(1),
        supabase.from('run_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', startOfDay.toISOString()),
      ])
      setRunStatus({ hasKey: (keys?.length ?? 0) > 0, provider: appProvider, runsToday: runsToday ?? 0, limit: 50 })
    }
    loadContext()
    loadRunStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when user changes
  }, [user])

  async function buildUserContext() {
    const parts = []
    if (activeContext.career && profiles.career) {
      const text = buildCareerContext(profiles.career)
      if (text) parts.push(`[Career Profile]\n${text}`)
    }
    if (activeContext.business && profiles.business) {
      const text = buildBusinessContext(profiles.business)
      if (text) parts.push(`[Business Profile]\n${text}`)
    }
    if (activeContext.memory && profiles.memory.length > 0) {
      const text = profiles.memory.map(m => `${m.key}: ${m.value}`).join('\n')
      parts.push(`[My Preferences]\n${text}`)
    }
    if (activeContext.dataSources.size > 0) {
      const ids = [...activeContext.dataSources]
      const { data } = await supabase.from('user_data_sources').select('name, content').in('id', ids)
      if (data?.length) {
        data.forEach(ds => parts.push(`[Data Source: ${ds.name}]\n${ds.content}`))
      }
    }
    // Company Knowledge Vault — shared context across all apps
    const { data: vaultItems } = await supabase
      .from('knowledge_vault')
      .select('title, content')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at')
    if (vaultItems?.length) {
      vaultItems.forEach(item => parts.push(`[Company Knowledge: ${item.title}]\n${item.content}`))
    }
    return parts.join('\n\n')
  }

  function scheduleFlush() {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      setResult(resultRef.current)
      rafRef.current = null
    })
  }

  async function runSingle(inputText, signal) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const res = await fetch(`${API_URL}/run`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({
        app_id: app.id, input: inputText,
        system_prompt: app.system_prompt,
        ai_provider: app.ai_provider || 'claude',
        ai_model: app.ai_model || null,
        user_context: (await buildUserContext()) || undefined,
        output_type: app.output_type || 'markdown',
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Backend error' }))
      if (res.status === 429) throw new Error(err.error || 'Rate limit reached')
      throw new Error(err.detail || err.error || 'Backend error')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalProvider = '', finalModel = '', finalUsage = null
    resultRef.current = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        const data = parseSSELine(line)
        if (!data) continue
        if (data.token !== undefined) { resultRef.current += data.token; scheduleFlush() }
        if (data.tool_call) setToolCalls(prev => [...prev, { ...data.tool_call, status: 'running' }])
        if (data.tool_result) setToolCalls(prev => prev.map(tc => tc.name === data.tool_result.name && tc.status === 'running' ? { ...tc, status: 'done', result: data.tool_result.result } : tc))
        if (data.done) { finalProvider = data.provider; finalModel = data.model; finalUsage = data.usage || null }
        if (data.error) throw new Error(data.error)
      }
    }

    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    setResult(resultRef.current)

    return { text: resultRef.current, provider: finalProvider, model: finalModel, usage: finalUsage }
  }

  async function handleRun(overrideInput) {
    const runInput = overrideInput ?? input
    if (!runInput.trim()) return
    setLoading(true); setResult(''); setError('')
    setProvider(''); setModel(''); setUsage(null); setBulkResults([]); setToolCalls([])

    // Check if this app has tools
    if (app.id) {
      supabase.from('app_tools').select('id', { count: 'exact', head: true }).eq('app_id', app.id)
        .then(({ count }) => setHasTools((count ?? 0) > 0))
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 95000)

    try {
      if (bulkMode) {
        const lines = input.split('\n').map(l => l.trim()).filter(Boolean)
        setBulkProgress(0)
        const results = []
        for (let i = 0; i < lines.length; i++) {
          const { text, provider: p, model: m, usage: u } = await runSingle(lines[i], controller.signal)
          results.push({ input: lines[i], result: text, usage: u })
          setBulkResults([...results])
          setBulkProgress(i + 1)
          const runIndex = i
          async function saveBulkHistory() {
            const { data: row, error } = await supabase.from('run_history').insert({
              user_id: user.id, app_id: app.id, app_name: app.name, input: lines[runIndex], result: text,
              input_tokens: u?.input_tokens ?? null, output_tokens: u?.output_tokens ?? null,
            }).select('id').single()
            if (error) { toast(`Run ${runIndex + 1} completed but wasn't saved to history: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveBulkHistory }); return }
            results[runIndex] = { ...results[runIndex], runId: row.id }; setBulkResults([...results])
          }
          await saveBulkHistory()
          await supabase.rpc('increment_app_runs', { p_app_id: app.id })
          setProvider(p); setModel(m); setUsage(u)
        }
        sendNotification(app.name)
        onRun?.()
        toast(`${lines.length} runs completed`, 'success')
      } else {
        const { text, provider: p, model: m, usage: u } = await runSingle(runInput, controller.signal)
        if (!text) throw new Error('No response received')
        setProvider(p); setModel(m); setUsage(u)

        async function saveHistory() {
          const { data: row, error } = await supabase.from('run_history')
            .insert({
              user_id: user.id, app_id: app.id, app_name: app.name, input, result: text,
              input_tokens: u?.input_tokens ?? null, output_tokens: u?.output_tokens ?? null,
            })
            .select('id').single()
          if (row) { setLastRunId(row.id); return row }
          if (error) toast(`Result ready, but couldn't save to history: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveHistory })
          return null
        }
        const historyRow = await saveHistory()

        clearTimeout(timeoutId)
        await supabase.rpc('increment_app_runs', { p_app_id: app.id })

        // Feature 1: Save structured record if output is JSON-parseable
        if (app.output_type && app.output_type !== 'markdown') {
          const structured = extractStructuredData(resultRef.current)
          if (structured) {
            const { error: recordError } = await supabase.from('app_records').insert({
              app_id: app.id, user_id: user.id,
              run_id: historyRow?.id || null,
              data: structured,
              label: runInput.slice(0, 80),
            })
            if (recordError) toast(`Couldn't save structured record: ${recordError.message}`, 'error')
          }
        }

        await checkAlerts(user.id, runInput, resultRef.current, toast)

        // Feature 8: Intelligent next step
        const next = await findNextAppRecommendation(app, user.id)
        if (next) setNextApp(next)
        sendNotification(app.name)
        onRun?.()
        toast('Result saved to history', 'success')
        // Notify if paid run completed
        if (app.is_paid && app.price_per_run > 0) {
          await createNotification(user.id, { type: 'payment', title: 'Run completed', message: `${app.name} — $${app.price_per_run} charged`, link_view: 'apps' })
        }
      }
    } catch (err) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      clearTimeout(timeoutId)
      const msg = friendlyErrorMessage(err)
      setError(msg); toast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  const enableNotifications = useCallback(async () => {
    const ok = await requestNotificationPermission()
    toast(ok ? 'Notifications enabled' : 'Permission denied', ok ? 'success' : 'error')
  }, [toast])

  const isNative = app.app_type === 'native' && Array.isArray(app.form_schema) && app.form_schema.length > 0
  const [formValues, setFormValues] = useState({})

  // For native apps, build the input string from form values
  function buildNativeInput() {
    return (app.form_schema || []).map(f => {
      const val = formValues[f.id] || ''
      return val ? `${f.label}: ${val}` : null
    }).filter(Boolean).join('\n')
  }

  const nativeInputReady = !isNative || (app.form_schema || []).filter(f => f.required).every(f => formValues[f.id]?.trim())

  // Classify error into an actionable category
  function classifyError(msg) {
    if (!msg) return null
    const m = msg.toLowerCase()
    // Checked before the API-key branch: the backend's rate-limit message
    // itself suggests "Add your own API key", which would otherwise false-match
    // the api-key check below and mislabel a rate limit as a bad key.
    if (m.includes('rate limit') || m.includes('quota') || m.includes('429'))
      return { type: 'rate', label: 'Rate limit reached', action: 'Add your own API key in Settings → Keys for unlimited runs, or wait a moment.' }
    if (m.includes('api key') || m.includes('authentication') || m.includes('invalid') && m.includes('key'))
      return { type: 'key', label: 'API key invalid or missing', action: 'Go to Settings → Keys to add or fix your key.' }
    if (m.includes('permission') || m.includes('not have permission'))
      return { type: 'perm', label: 'API key permission denied', action: 'Your key may not have access to this model. Check your provider account.' }
    if (m.includes('timeout') || m.includes('timed out'))
      return { type: 'timeout', label: 'Request timed out', action: 'Try a shorter input or switch to a faster model (e.g. Haiku).' }
    if (m.includes('connect') || m.includes('backend') || m.includes('server'))
      return { type: 'server', label: 'Server error', action: 'The AI provider returned an error. Try again in a moment.' }
    return { type: 'generic', label: 'Something went wrong', action: msg }
  }

  const content = (
    <div className="flex flex-col gap-4">

      {/* Pre-run status strip */}
      {runStatus && !result && !loading && (
        <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs border ${
          runStatus.hasKey
            ? 'bg-green-500/8 border-green-500/20 text-green-400'
            : runStatus.runsToday >= runStatus.limit
            ? 'bg-red-500/8 border-red-500/20 text-red-400'
            : 'bg-amber-500/8 border-amber-500/20 text-amber-400'
        }`}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            runStatus.hasKey ? 'bg-green-400' : runStatus.runsToday >= runStatus.limit ? 'bg-red-400' : 'bg-amber-400'
          }`} />
          <span className="flex-1">
            {runStatus.hasKey
              ? `Ready to run · your ${runStatus.provider === 'openai' ? 'OpenAI' : 'Claude'} key is active`
              : runStatus.runsToday >= runStatus.limit
              ? `Daily limit reached (${runStatus.limit} runs) · add your API key for unlimited runs`
              : `Demo mode · ${runStatus.limit - runStatus.runsToday} free runs left today`
            }
          </span>
          {!runStatus.hasKey && (
            <button onClick={goToSettings} className="underline underline-offset-2 font-medium shrink-0 hover:opacity-80 transition-opacity">
              Add key →
            </button>
          )}
        </div>
      )}

      {/* Native App — structured form */}
      {isNative ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Fill in the fields below</p>
          {(app.form_schema || []).map(f => (
            <div key={f.id}>
              <label className="text-xs text-slate-400 block mb-1.5">
                {f.label} {f.required && <span className="text-red-400">*</span>}
              </label>
              {f.type === 'textarea' ? (
                <textarea
                  className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors"
                  rows={3} placeholder={f.placeholder}
                  value={formValues[f.id] || ''}
                  onChange={e => setFormValues(v => ({ ...v, [f.id]: e.target.value }))} />
              ) : f.type === 'select' ? (
                <select
                  className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7] transition-colors"
                  value={formValues[f.id] || ''}
                  onChange={e => setFormValues(v => ({ ...v, [f.id]: e.target.value }))}>
                  <option value="">Select...</option>
                  {(f.options || '').split(',').map(o => o.trim()).filter(Boolean).map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                  placeholder={f.placeholder}
                  value={formValues[f.id] || ''}
                  onChange={e => setFormValues(v => ({ ...v, [f.id]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Prompt App — standard textarea with bulk mode toggle */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-400">
              {bulkMode ? 'Bulk inputs (one per line)' : 'Your input'}
            </label>
            <button
              onClick={() => { setBulkMode(v => !v); setInput(''); setBulkResults([]) }}
              className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${bulkMode ? 'bg-[#6C5CE7]/20 text-[#6C5CE7]' : 'bg-[#1F2444] text-slate-400 hover:text-white'}`}>
              {bulkMode ? '⊞ Bulk ON' : '⊞ Bulk mode'}
            </button>
          </div>
          <textarea
            className="w-full bg-[#1F2444] border border-white/10 rounded-xl p-3 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-purple-500 transition-colors"
            rows={bulkMode ? 6 : 4}
            placeholder={bulkMode ? 'Enter one input per line...' : app.input_placeholder || PLACEHOLDERS[app.id] || 'Describe what you need...'}
            value={input}
            onChange={e => setInput(e.target.value)} />
        </>
      )}

      {/* Missing required profile warning */}
      {(app.required_context || []).length > 0 && (
        (app.required_context.includes('career_profile') && !profiles.career) ||
        (app.required_context.includes('business_profile') && !profiles.business)
      ) && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-400">
          ⚠ This app works best with your{' '}
          {app.required_context.includes('career_profile') && !profiles.career && 'Career Profile'}
          {app.required_context.includes('career_profile') && !profiles.career && app.required_context.includes('business_profile') && !profiles.business && ' and '}
          {app.required_context.includes('business_profile') && !profiles.business && 'Business Profile'}.{' '}
          <span className="underline cursor-pointer">Fill it in Profiles →</span>
        </div>
      )}

      {/* Context chips */}
      {(profiles.career || profiles.business || profiles.memory.length > 0 || profiles.dataSources.length > 0) && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase mb-1.5">Inject context</p>
          <div className="flex gap-1.5 flex-wrap">
            {profiles.career && (
              <button onClick={() => setActiveContext(p => ({ ...p, career: !p.career }))}
                className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border transition-all ${activeContext.career ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-[#6C5CE7]' : 'bg-[#1F2444] border-white/10 text-slate-400 hover:text-white'}`}>
                💼 Career Profile {activeContext.career && '✓'}
              </button>
            )}
            {profiles.business && (
              <button onClick={() => setActiveContext(p => ({ ...p, business: !p.business }))}
                className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border transition-all ${activeContext.business ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-[#6C5CE7]' : 'bg-[#1F2444] border-white/10 text-slate-400 hover:text-white'}`}>
                🏢 Business Profile {activeContext.business && '✓'}
              </button>
            )}
            {profiles.memory.length > 0 && (
              <button onClick={() => setActiveContext(p => ({ ...p, memory: !p.memory }))}
                className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border transition-all ${activeContext.memory ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-[#6C5CE7]' : 'bg-[#1F2444] border-white/10 text-slate-400 hover:text-white'}`}>
                🧠 AI Memory {activeContext.memory && '✓'}
              </button>
            )}
            {profiles.dataSources.map(ds => {
              const active = activeContext.dataSources.has(ds.id)
              return (
                <button key={ds.id}
                  onClick={() => setActiveContext(p => {
                    const next = new Set(p.dataSources)
                    if (active) next.delete(ds.id); else next.add(ds.id)
                    return { ...p, dataSources: next }
                  })}
                  className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border transition-all ${active ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-[#6C5CE7]' : 'bg-[#1F2444] border-white/10 text-slate-400 hover:text-white'}`}>
                  🗄️ {ds.name.slice(0, 16)}{ds.name.length > 16 ? '…' : ''} {active && '✓'}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Payment modal */}
      {showPayment && (
        <Suspense fallback={null}>
          <PaymentModal
            app={app} user={user}
            onSuccess={() => { setShowPayment(false); if (isNative) handleRun(buildNativeInput()); else handleRun() }}
            onClose={() => setShowPayment(false)}
          />
        </Suspense>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => {
            // Payment gate for paid apps
            if (app.is_paid && app.price_per_run > 0) { setShowPayment(true); return }
            if (isNative) handleRun(buildNativeInput()); else handleRun()
          }}
          disabled={loading || (isNative ? !nativeInputReady : !input.trim())}
          className="flex-1 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            bulkMode
              ? <><span className="animate-spin inline-block">⟳</span> {bulkProgress}/{input.split('\n').filter(l=>l.trim()).length} running...</>
              : <><span className="animate-spin inline-block">⟳</span> Running...</>
          ) : (
            bulkMode ? `⊞ Run ${input.split('\n').filter(l=>l.trim()).length || 0} inputs` : '▶ Run App'
          )}
        </button>
        {'Notification' in window && Notification.permission !== 'granted' && (
          <button onClick={enableNotifications} title="Enable notifications when run completes"
            className="bg-[#1F2444] hover:bg-[#272C52] text-slate-400 hover:text-white text-sm px-3 py-2.5 rounded-xl transition-colors">
            🔔
          </button>
        )}
      </div>

      {error && (() => {
        const c = classifyError(error)
        const isKeyOrRate = c?.type === 'key' || c?.type === 'rate' || c?.type === 'perm'
        return (
          <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
              <span>⚠</span>
              <span>{c?.label || 'Error'}</span>
            </div>
            <p className="text-slate-300 text-xs leading-relaxed">{c?.action || error}</p>
            {isKeyOrRate && (
              <button onClick={goToSettings}
                className="inline-flex items-center gap-1 text-xs text-[#A29BFE] hover:text-white underline underline-offset-2 transition-colors mt-1">
                Open Settings → Keys ↗
              </button>
            )}
          </div>
        )
      })()}

      {/* Tool activity — always show when app has tools and a run has completed or is in progress */}
      {hasTools && (loading || result) && (
        <div className="bg-[#1F2444] border border-white/5 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
            <p className="text-[10px] text-slate-500 uppercase">🔧 Tool activity</p>
            {!loading && toolCalls.length === 0 && (
              <span className="text-[10px] text-amber-500/80">
                No tools called — AI answered from knowledge
              </span>
            )}
            {!loading && toolCalls.length > 0 && (
              <span className="text-[10px] text-green-400">
                {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''} made
              </span>
            )}
          </div>

          {toolCalls.length === 0 && !loading && (
            <div className="px-3 py-3 text-[11px] text-slate-500 leading-relaxed">
              The AI decided it didn't need tools for this input. Try asking something that requires real-time data or complex math,
              or add <span className="text-white font-medium">"Always use tools when available"</span> to the system prompt to force it.
            </div>
          )}

          {toolCalls.map((tc, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 border-t border-white/5 first:border-0">
              <span className={`text-sm mt-0.5 shrink-0 ${tc.status === 'running' ? 'animate-spin inline-block' : 'text-green-400'}`}>
                {tc.status === 'running' ? '⟳' : '✓'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-xs text-white font-mono font-medium">{tc.name}()</p>
                  {tc.status === 'running' && <span className="text-[#6C5CE7] text-[10px] animate-pulse">calling…</span>}
                </div>
                <p className="text-[10px] text-slate-500 truncate">
                  Input: {JSON.stringify(tc.input)}
                </p>
                {tc.result && (
                  <p className="text-[10px] text-green-400/90 mt-0.5 truncate">→ {tc.result}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bulk results */}
      {bulkResults.length > 0 && (
        <div className="space-y-3">
          {bulkResults.map((r, i) => (
            <div key={i} className="bg-[#1F2444] border border-white/10 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-[#6C5CE7] font-medium">Input {i + 1}</span>
                <div className="flex items-center gap-2">
                  {r.usage && (
                    <span className="text-[10px] text-slate-500" title="Tokens used for this run">
                      ↑{r.usage.input_tokens?.toLocaleString()} ↓{r.usage.output_tokens?.toLocaleString()} tok
                    </span>
                  )}
                  {r.runId && <RunRating key={r.runId} runId={r.runId} />}
                  <button onClick={() => navigator.clipboard.writeText(r.result)} className="text-[10px] text-slate-500 hover:text-slate-300">📋</button>
                </div>
              </div>
              <div className="px-3 py-2">
                <p className="text-[11px] text-slate-500 mb-1">{r.input}</p>
                <div className="text-xs text-slate-200 prose-result">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.result}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Thinking — shown while running, before any tokens have arrived */}
      {loading && !result && !bulkMode && <ThinkingIndicator />}

      {/* Single result */}
      {result && !bulkMode && (
        <div className="space-y-2">
          {/* Provider + rating row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {provider && (
                <span className="text-[10px] bg-[#1F2444] text-slate-400 px-2 py-0.5 rounded">
                  {provider === 'openai' ? '🟢 OpenAI' : '🟣 Claude'}
                  {model && <span className="ml-1 opacity-60">{model.split('-').slice(-2).join('-')}</span>}
                </span>
              )}
              {usage && (
                <span className="text-[10px] bg-[#1F2444] text-slate-400 px-2 py-0.5 rounded" title="Tokens used for this run">
                  ↑{usage.input_tokens?.toLocaleString()} ↓{usage.output_tokens?.toLocaleString()} tok
                </span>
              )}
            </div>
            {!loading && lastRunId && <RunRating key={lastRunId} runId={lastRunId} />}
          </div>

          {/* Output renderer — handles table/cards/json/chart/markdown + view switcher */}
          <OutputRenderer result={result} outputType={app.output_type || 'markdown'} loading={loading} title={app.name} />
        </div>
      )}
      {/* Cross-app: Send to App */}
      {result && !loading && !bulkMode && (
        <SendToApp result={result} />
      )}

      {/* Next best action — proactive suggestions after every run */}
      {result && !loading && !bulkMode && (
        <NextBestActions app={app} user={user} result={result} toast={toast} />
      )}

      {/* Next Step Recommendation */}
      {nextApp && !loading && (
        <div className="bg-[#6C5CE7]/10 border border-[#6C5CE7]/30 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-[#6C5CE7] font-medium mb-0.5">Recommended next step</p>
            <p className="text-sm text-white font-medium">{nextApp.emoji} {nextApp.name}</p>
            <p className="text-xs text-slate-400">Continue your workflow — your result is pre-filled as input</p>
          </div>
          <button
            onClick={() => {
              setInput(resultRef.current)
              setNextApp(null)
              setResult('')
              setLastRunId(null)
            }}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-xs px-3 py-2 rounded-lg transition-colors shrink-0 font-medium"
          >
            Continue →
          </button>
        </div>
      )}
    </div>
  )

  if (inline) return content

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: (app.color || '#6C5CE7') + '33' }}>{app.emoji}</div>
            <div>
              <p className="text-white font-medium text-sm">{app.name}</p>
              <p className="text-xs text-slate-400">Powered by {provider || (app.ai_provider === 'openai' ? 'OpenAI' : 'Claude')}</p>
            </div>
          </div>
          <button aria-label="Close"
            onClick={() => { if (loading && !window.confirm('A run is in progress. Close anyway?')) return; onClose() }}
            className="text-slate-500 hover:text-white text-lg"
          >✕</button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{content}</div>
      </div>
    </div>
  )
}
