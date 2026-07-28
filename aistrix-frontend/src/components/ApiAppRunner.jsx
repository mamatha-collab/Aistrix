import { useState, useRef } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import OutputRenderer, { ThinkingIndicator } from './OutputRenderer'
import { parseSSELine } from '../lib/sse'
import RunRating from './RunRating'
import { friendlyErrorMessage } from '../utils/appActions'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function buildCurl(app, fieldValues, origin) {
  const body = Object.fromEntries(
    (app.form_schema || []).map(f => [
      f.label.toLowerCase().replace(/\s+/g, '_'),
      fieldValues[f.id] || (f.type === 'number' ? 0 : ''),
    ])
  )
  return `curl -X POST ${origin}/v1/apps/${app.id}/run \\
  -H "Authorization: Bearer ak_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ fields: body }, null, 2).replace(/\n/g, '\n  ')}'`
}

export default function ApiAppRunner({ app, user, onClose, onRun, inline = false }) {
  const [fieldValues, setFieldValues] = useState({})
  const [result, setResult] = useState('')
  const [usage, setUsage] = useState(null)
  const [lastRunId, setLastRunId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showCurl, setShowCurl] = useState(false)
  const [curlCopied, setCurlCopied] = useState(false)
  const resultRef = useRef('')
  const rafRef = useRef(null)
  const toast = useToast()

  const fields = app.form_schema || []
  const allFilled = fields.filter(f => f.required).every(f => fieldValues[f.id]?.trim?.() || fieldValues[f.id])
  const curl = buildCurl(app, fieldValues, window.location.origin)

  function scheduleFlush() {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { setResult(resultRef.current); rafRef.current = null })
  }

  async function execute() {
    if (!allFilled) return
    setLoading(true); setResult(''); setError(''); setUsage(null); setLastRunId(null)
    resultRef.current = ''
    let finalUsage = null

    const paramString = fields.map(f => {
      const val = fieldValues[f.id]
      return val ? `${f.label}: ${val}` : null
    }).filter(Boolean).join('\n')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          app_id: app.id, input: paramString,
          system_prompt: app.system_prompt,
          ai_provider: app.ai_provider || 'claude',
          ai_model: app.ai_model || null,
          output_type: 'json',
        }),
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop()
        for (const line of lines) {
          const d = parseSSELine(line)
          if (!d) continue
          if (d.token) { resultRef.current += d.token; scheduleFlush() }
          if (d.done) finalUsage = d.usage || null
          if (d.error) throw new Error(d.error)
        }
      }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      setResult(resultRef.current)
      setUsage(finalUsage)

      async function saveHistory() {
        const { data: row, error } = await supabase.from('run_history').insert({
          user_id: user.id, app_id: app.id, app_name: app.name,
          input: paramString, result: resultRef.current,
          input_tokens: finalUsage?.input_tokens ?? null, output_tokens: finalUsage?.output_tokens ?? null,
        }).select('id').single()
        if (row) { setLastRunId(row.id); return true }
        if (error) toast(`Call completed, but wasn't saved to history: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveHistory })
        return false
      }
      const saved = await saveHistory()
      await supabase.rpc('increment_app_runs', { p_app_id: app.id })
      onRun?.()
      if (saved) toast('API call completed', 'success')
    } catch (e) {
      setError(friendlyErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors font-mono'

  const body = (
    <div className="space-y-5">
      {/* Endpoint info */}
      <div className="bg-[#0F1225] border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
        <span className="text-[10px] font-bold text-green-400 bg-green-400/10 px-2 py-1 rounded shrink-0">POST</span>
        <code className="text-xs text-slate-300 font-mono truncate">{window.location.origin}/v1/apps/{app.id}/run</code>
        <button onClick={() => window.open(`/app/${app.id}/docs`, '_blank')}
          className="text-[10px] text-[#6C5CE7] hover:underline shrink-0">docs ↗</button>
      </div>

      {/* Parameters */}
      {fields.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400 uppercase font-medium">Parameters</p>
          {fields.map(f => (
            <div key={f.id} className="flex items-start gap-3">
              <div className="w-32 shrink-0 pt-2.5">
                <p className="text-xs text-white font-mono">{f.label.toLowerCase().replace(/\s+/g, '_')}</p>
                <p className="text-[10px] text-slate-500">{f.type}{f.required ? ' · required' : ''}</p>
              </div>
              {f.type === 'select' ? (
                <select className={inputCls} value={fieldValues[f.id] || ''}
                  onChange={e => setFieldValues(v => ({ ...v, [f.id]: e.target.value }))}>
                  <option value="">Select...</option>
                  {(f.options || '').split(',').map(o => o.trim()).filter(Boolean).map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input type={f.type === 'number' ? 'number' : 'text'}
                  className={inputCls} placeholder={f.placeholder || `Enter ${f.label.toLowerCase()}...`}
                  value={fieldValues[f.id] || ''}
                  onChange={e => setFieldValues(v => ({ ...v, [f.id]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-[#1F2444] border border-white/5 rounded-xl p-4 text-center">
          <p className="text-slate-400 text-sm">No parameters defined for this API</p>
        </div>
      )}

      {/* Curl preview */}
      <div>
        <button onClick={() => setShowCurl(v => !v)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
          {showCurl ? '▲ Hide' : '▼ Show'} curl command
        </button>
        {showCurl && (
          <div className="relative mt-2">
            <pre className="bg-[#0F1225] border border-white/5 rounded-xl p-3 text-[10px] text-slate-400 font-mono overflow-x-auto leading-relaxed">
              {curl}
            </pre>
            <button onClick={() => { navigator.clipboard.writeText(curl); setCurlCopied(true); setTimeout(() => setCurlCopied(false), 2000) }}
              className="absolute top-2 right-2 text-[10px] bg-[#1F2444] hover:bg-[#272C52] text-slate-400 px-2 py-1 rounded transition-colors">
              {curlCopied ? '✓' : '📋'}
            </button>
          </div>
        )}
      </div>

      <button onClick={execute} disabled={loading || !allFilled}
        className="w-full bg-[#0984E3] hover:bg-[#0878d0] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
        {loading ? <><span className="animate-spin">⟳</span> Executing...</> : '▶ Execute API call'}
      </button>

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">{error}</div>}

      {loading && !result && <ThinkingIndicator label="Executing..." />}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400 uppercase">Response {loading && <span className="text-[#6C5CE7] animate-pulse ml-1">●</span>}</p>
            <div className="flex items-center gap-2">
              {usage && (
                <span className="text-[10px] text-slate-500" title="Tokens used for this run">
                  ↑{usage.input_tokens?.toLocaleString()} ↓{usage.output_tokens?.toLocaleString()} tok
                </span>
              )}
              <span className="text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">200 OK</span>
              {!loading && lastRunId && <RunRating key={lastRunId} runId={lastRunId} />}
            </div>
          </div>
          <OutputRenderer result={result} outputType="json" loading={loading} title={app.name} />
        </div>
      )}
    </div>
  )

  if (inline) return body

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0984E3]/20 flex items-center justify-center text-[#0984E3] font-bold font-mono text-sm">{'{}'}</div>
            <div>
              <p className="text-white font-medium text-sm">{app.name}</p>
              <p className="text-xs text-slate-400">API App · Try it here or call via REST</p>
            </div>
          </div>
          <button aria-label="Close" onClick={() => { if (loading && !window.confirm('API call in progress. Stop?')) return; onClose() }}
            className="text-slate-500 hover:text-white text-lg">✕</button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{body}</div>
      </div>
    </div>
  )
}
