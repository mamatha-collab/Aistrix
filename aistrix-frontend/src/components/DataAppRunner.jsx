import { useState, useRef } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import OutputRenderer, { ThinkingIndicator } from './OutputRenderer'
import { parseSSELine } from '../lib/sse'
import RunRating from './RunRating'
import { friendlyErrorMessage } from '../utils/appActions'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const DATA_TYPES = [
  { id: 'csv',  icon: '📊', label: 'CSV / Table',  placeholder: 'Paste CSV data here:\nName,Email,Amount\nJohn,john@co.com,$500\nJane,jane@co.com,$750' },
  { id: 'text', icon: '📝', label: 'Document',      placeholder: 'Paste any text, document, report, or article here...' },
  { id: 'json', icon: '{ }', label: 'JSON Data',    placeholder: 'Paste JSON data here:\n[{"name": "Alice", "score": 95}, ...]' },
  { id: 'url',  icon: '🌐', label: 'URL',           placeholder: 'https://example.com/data-page' },
]

export default function DataAppRunner({ app, user, onClose, onRun, inline = false }) {
  const [dataType, setDataType] = useState('csv')
  const [rawData, setRawData] = useState('')
  const [result, setResult] = useState('')
  const [usage, setUsage] = useState(null)
  const [lastRunId, setLastRunId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const resultRef = useRef('')
  const rafRef = useRef(null)
  const fileInputRef = useRef(null)
  const toast = useToast()

  const currentType = DATA_TYPES.find(t => t.id === dataType)

  function scheduleFlush() {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { setResult(resultRef.current); rafRef.current = null })
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      setRawData(ev.target?.result || '')
      // Auto-detect type
      if (file.name.endsWith('.csv')) setDataType('csv')
      else if (file.name.endsWith('.json')) setDataType('json')
      else setDataType('text')
    }
    reader.readAsText(file)
  }

  async function processData() {
    if (!rawData.trim()) return
    setLoading(true); setResult(''); setError(''); setUsage(null); setLastRunId(null)
    resultRef.current = ''
    let finalUsage = null

    const inputText = dataType === 'url'
      ? `Please fetch and analyze this URL: ${rawData}`
      : `Data type: ${currentType.label}\n\n${rawData}`

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          app_id: app.id, input: inputText,
          system_prompt: app.system_prompt,
          ai_provider: app.ai_provider || 'claude',
          ai_model: app.ai_model || null,
          output_type: app.output_type || (dataType === 'csv' ? 'table' : 'markdown'),
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
          input: rawData.slice(0, 500) + (rawData.length > 500 ? '...' : ''),
          result: resultRef.current,
          input_tokens: finalUsage?.input_tokens ?? null, output_tokens: finalUsage?.output_tokens ?? null,
        }).select('id').single()
        if (row) { setLastRunId(row.id); return true }
        if (error) toast(`Data processed, but wasn't saved to history: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveHistory })
        return false
      }
      const saved = await saveHistory()
      await supabase.rpc('increment_app_runs', { p_app_id: app.id })
      onRun?.()
      if (saved) toast('Data processed', 'success')
    } catch (e) {
      setError(friendlyErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const body = (
    <div className="space-y-4">
      {/* Data type selector */}
      <div>
        <label className="text-xs text-slate-400 block mb-2">Data type</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DATA_TYPES.map(t => (
            <button key={t.id} onClick={() => setDataType(t.id)}
              className={`flex flex-col items-center gap-1 py-2.5 px-3 rounded-xl border text-xs transition-all ${dataType === t.id ? 'border-[#E17055] bg-[#E17055]/10 text-white' : 'border-white/5 bg-[#1F2444] text-slate-400 hover:text-white'}`}>
              <span className="text-lg">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Data input */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-slate-400">
            {dataType === 'url' ? 'Enter URL' : `Paste ${currentType.label}`}
          </label>
          {dataType !== 'url' && (
            <>
              <button onClick={() => fileInputRef.current?.click()}
                className="text-[10px] text-slate-400 hover:text-white bg-[#1F2444] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1">
                📁 Upload file
              </button>
              <input ref={fileInputRef} type="file" className="hidden"
                accept=".csv,.txt,.json,.md,.pdf" onChange={handleFile} />
            </>
          )}
        </div>
        {fileName && (
          <p className="text-[10px] text-[#6C5CE7] mb-1.5">📎 {fileName}</p>
        )}
        {dataType === 'url' ? (
          <input className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors font-mono"
            placeholder={currentType.placeholder} value={rawData}
            onChange={e => setRawData(e.target.value)} />
        ) : (
          <textarea className="w-full bg-[#1F2444] border border-white/10 rounded-xl p-3 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#E17055] transition-colors font-mono leading-relaxed"
            rows={8} placeholder={currentType.placeholder}
            value={rawData} onChange={e => setRawData(e.target.value)} />
        )}
        {rawData && dataType !== 'url' && (
          <p className="text-[10px] text-slate-600 mt-1 text-right">
            {rawData.length.toLocaleString()} chars
            {dataType === 'csv' && ` · ~${rawData.split('\n').length} rows`}
          </p>
        )}
      </div>

      <button onClick={processData} disabled={loading || !rawData.trim()}
        className="w-full bg-[#E17055] hover:bg-[#d4614a] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
        {loading ? <><span className="animate-spin">⟳</span> Processing data...</> : `▦ Process ${currentType.label}`}
      </button>

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">{error}</div>}

      {loading && !result && <ThinkingIndicator label="Processing data..." />}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400 uppercase">
              Result {loading && <span className="text-[#E17055] animate-pulse ml-1">●</span>}
            </p>
            <div className="flex items-center gap-2">
              {usage && (
                <span className="text-[10px] text-slate-500" title="Tokens used for this run">
                  ↑{usage.input_tokens?.toLocaleString()} ↓{usage.output_tokens?.toLocaleString()} tok
                </span>
              )}
              {!loading && lastRunId && <RunRating key={lastRunId} runId={lastRunId} />}
            </div>
          </div>
          <OutputRenderer result={result}
            outputType={app.output_type || (dataType === 'csv' ? 'table' : 'markdown')}
            loading={loading} title={app.name} />
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
            <div className="w-9 h-9 rounded-xl bg-[#E17055]/20 flex items-center justify-center text-xl">▦</div>
            <div>
              <p className="text-white font-medium text-sm">{app.name}</p>
              <p className="text-xs text-slate-400">Data App · Upload or paste your data</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white text-lg">✕</button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{body}</div>
      </div>
    </div>
  )
}
