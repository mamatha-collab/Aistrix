import { useRef, useState } from 'react'
import OutputRenderer, { ThinkingIndicator } from './OutputRenderer'
import { parseSSELine } from '../lib/sse'
import { friendlyErrorMessage } from '../utils/appActions'
import { PLACEHOLDERS } from '../utils'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Runner for website visitors who don't have an Aistrix account. Only used
// when the owner enabled "visitor access" for a free app's widget. The
// backend applies a per-visitor, per-app rate limit and uses the owner's own
// provider key when one is saved.
export default function EmbedVisitorRunner({ app }) {
  const isForm = app.app_type === 'native' && Array.isArray(app.form_schema) && app.form_schema.length > 0
  const [input, setInput] = useState('')
  const [formValues, setFormValues] = useState({})
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const resultRef = useRef('')

  const runInput = isForm
    ? (app.form_schema || []).map(f => (formValues[f.id] ? `${f.label}: ${formValues[f.id]}` : null)).filter(Boolean).join('\n')
    : input
  const ready = isForm
    ? (app.form_schema || []).filter(f => f.required).every(f => formValues[f.id]?.trim()) && runInput.trim()
    : input.trim()

  async function run() {
    if (!ready || loading) return
    setLoading(true); setError(''); setResult(''); resultRef.current = ''
    try {
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: app.id, input: runInput, output_type: app.output_type || 'markdown' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || err.detail || `Run failed (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', finished = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop()
        for (const line of lines) {
          const d = parseSSELine(line)
          if (!d) continue
          if (d.token) { resultRef.current += d.token; setResult(resultRef.current) }
          if (d.done) finished = true
          if (d.contract_error) throw new Error('The app could not produce a valid answer — please try again.')
          if (d.error) throw new Error(d.error)
        }
      }
      if (!finished) throw new Error('The connection closed before the answer finished. Please try again.')
    } catch (e) {
      setError(friendlyErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const fieldCls = 'w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  return (
    <div className="space-y-4">
      {isForm ? (
        <div className="space-y-3">
          {app.form_schema.map(f => (
            <div key={f.id}>
              <label className="text-xs text-slate-400 block mb-1.5">
                {f.label} {f.required && <span className="text-red-400">*</span>}
              </label>
              {f.type === 'textarea' ? (
                <textarea className={`${fieldCls} resize-none`} rows={3} placeholder={f.placeholder}
                  value={formValues[f.id] || ''} onChange={e => setFormValues(v => ({ ...v, [f.id]: e.target.value }))} />
              ) : f.type === 'select' ? (
                <select className={fieldCls} value={formValues[f.id] || ''}
                  onChange={e => setFormValues(v => ({ ...v, [f.id]: e.target.value }))}>
                  <option value="">Select...</option>
                  {(f.options || '').split(',').map(o => o.trim()).filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} className={fieldCls}
                  placeholder={f.placeholder} value={formValues[f.id] || ''}
                  onChange={e => setFormValues(v => ({ ...v, [f.id]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <textarea className={`${fieldCls} resize-none`} rows={4}
          placeholder={app.input_placeholder || PLACEHOLDERS[app.id] || 'Type your question…'}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run() }} />
      )}

      <button onClick={run} disabled={!ready || loading}
        className="w-full bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-xl font-medium transition-colors">
        {loading ? 'Working…' : '▶ Run'}
      </button>

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">{error}</div>}
      {loading && !result && <ThinkingIndicator />}
      {result && <OutputRenderer result={result} outputType={app.output_type || 'markdown'} loading={loading} title={app.name} />}
    </div>
  )
}
