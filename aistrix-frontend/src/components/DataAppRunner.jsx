import { useState, useRef } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import OutputRenderer, { ThinkingIndicator } from './OutputRenderer'
import { parseSSELine } from '../lib/sse'
import RunRating from './RunRating'
import { friendlyErrorMessage } from '../utils/appActions'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
// Must stay under the backend's MAX_INPUT_LENGTH (20k chars by default).
const CHUNK_CHARS = 15000
const MAX_CHUNKS = 12
const MAX_ANALYSIS_CHARS = CHUNK_CHARS * MAX_CHUNKS
const MAX_EXTRACT_CHARS = 400000
const BINARY_EXTS = ['pdf', 'xlsx', 'xlsm', 'docx']

function fileExt(name) {
  return name.toLowerCase().split('.').pop()
}

// Split on line boundaries; CSV chunks repeat the header so every part is
// self-describing.
function chunkText(text, isCsv) {
  if (text.length <= CHUNK_CHARS) return [text]
  const lines = text.split('\n')
  const header = isCsv ? lines.shift() + '\n' : ''
  const chunks = []
  let cur = header
  const maxPiece = CHUNK_CHARS - header.length - 1
  for (const line of lines) {
    // A single enormous line still has to be split somewhere.
    const pieces = line.length > maxPiece
      ? Array.from({ length: Math.ceil(line.length / maxPiece) }, (_, i) => line.slice(i * maxPiece, (i + 1) * maxPiece))
      : [line]
    for (const piece of pieces) {
      if (cur.length + piece.length + 1 > CHUNK_CHARS && cur.length > header.length) {
        chunks.push(cur)
        cur = header
      }
      cur += piece + '\n'
    }
  }
  if (cur.length > header.length) chunks.push(cur)
  return chunks
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

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
  const [fileMeta, setFileMeta] = useState(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [progressLabel, setProgressLabel] = useState('')
  const resultRef = useRef('')
  const rafRef = useRef(null)
  const fileInputRef = useRef(null)
  const toast = useToast()

  const currentType = DATA_TYPES.find(t => t.id === dataType)

  function scheduleFlush() {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { setResult(resultRef.current); rafRef.current = null })
  }

  async function registerStoredFile(file, path, session) {
    const res = await fetch(`${API_URL}/v1/files/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        app_id: app.id,
        file_kind: 'input',
        bucket: 'aistrix-input-files',
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || 'text/plain',
        size_bytes: file.size,
        retention_days: 30,
        metadata: { app_type: 'data', data_type: dataType },
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || 'File uploaded, but could not be registered')
    }
    return res.json()
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const ext = fileExt(file.name)
    const isBinary = BINARY_EXTS.includes(ext)
    if (file.size > (isBinary ? 10 : 5) * 1024 * 1024) {
      setError(`File is too large. Use ${isBinary ? 'PDF/Excel/Word files under 10 MB' : 'text files under 5 MB'}.`)
      return
    }
    setUploadingFile(true); setError(''); setFileMeta(null)
    setFileName(file.name)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in again before uploading files')
      const safeName = file.name.replace(/[^\w.\-]+/g, '_')
      const path = `apps/${app.id}/users/${user.id}/inputs/${Date.now()}-${safeName}`
      const { error: uploadError } = await supabase.storage.from('aistrix-input-files').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      })
      if (uploadError) throw uploadError
      const registered = await registerStoredFile(file, path, session)
      setFileMeta(registered)

      if (isBinary) {
        const res = await fetch(`${API_URL}/v1/files/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ file_name: file.name, content_b64: await fileToBase64(file) }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          const detail = body.detail || `Could not read ${file.name}`
          if (/scanned pdf|no selectable text/i.test(detail)) {
            throw new Error('This PDF looks scanned, so there is no selectable text to analyze yet. OCR is not enabled for Data apps; upload a text-based PDF or run OCR first.')
          }
          throw new Error(detail)
        }
        setRawData(body.text || '')
        setDataType(body.kind === 'csv' ? 'csv' : 'text')
        if (body.truncated) toast(`Only the first ${body.text.length.toLocaleString()} characters of ${file.name} were extracted. Split larger files for best results.`, 'info', 7000)
      } else {
        setRawData(await file.text())
        if (ext === 'csv') setDataType('csv')
        else if (ext === 'json') setDataType('json')
        else setDataType('text')
      }
    } catch (e) {
      setError(friendlyErrorMessage(e))
    } finally {
      setUploadingFile(false)
    }
  }

  async function streamRun(inputText, outputType, onToken) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${API_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        app_id: app.id, input: inputText,
        system_prompt: app.system_prompt,
        ai_provider: app.ai_provider || 'claude',
        ai_model: app.ai_model || null,
        output_type: outputType,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || err.detail || `Run failed (${res.status})`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', text = '', usage = null, finished = false
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n'); buffer = lines.pop()
      for (const line of lines) {
        const d = parseSSELine(line)
        if (!d) continue
        if (d.token) { text += d.token; onToken?.(text) }
        if (d.done) { finished = true; usage = d.usage || null }
        if (d.contract_error) throw new Error(`Output contract failed: ${d.contract_error.join('; ')}`)
        if (d.error) throw new Error(d.error)
      }
    }
    if (!finished) throw new Error('The connection closed before the run finished. Please try again.')
    return { text, usage }
  }

  async function processData() {
    if (!rawData.trim()) return
    setLoading(true); setResult(''); setError(''); setUsage(null); setLastRunId(null); setProgressLabel('')
    resultRef.current = ''
    const outputType = app.output_type || (dataType === 'csv' ? 'table' : 'markdown')
    const header = `Data type: ${currentType.label}${fileMeta ? `\nStored file id: ${fileMeta.id}` : ''}`
    const live = text => { resultRef.current = text; scheduleFlush() }

    try {
      let final
      const totalUsage = { input_tokens: 0, output_tokens: 0 }
      const addUsage = u => { if (u) { totalUsage.input_tokens += u.input_tokens || 0; totalUsage.output_tokens += u.output_tokens || 0 } }

      if (dataType === 'url') {
        final = await streamRun(`Please fetch and analyze this URL: ${rawData}`, outputType, live)
        addUsage(final.usage)
      } else {
        const chunks = chunkText(rawData, dataType === 'csv')
        if (chunks.length > MAX_CHUNKS) {
          throw new Error(`This data is too large for an interactive run (${rawData.length.toLocaleString()} chars, ${chunks.length} parts). This runner analyzes about ${MAX_ANALYSIS_CHARS.toLocaleString()} characters at a time. Trim it or split the file.`)
        }
        if (chunks.length === 1) {
          final = await streamRun(`${header}\n\n${rawData}`, outputType, live)
          addUsage(final.usage)
        } else {
          // Map: analyse each part. Reduce: merge the partial findings using
          // the app's own instructions and output format.
          const notes = []
          for (let i = 0; i < chunks.length; i++) {
            setProgressLabel(`Analysing part ${i + 1} of ${chunks.length}…`)
            const part = await streamRun(
              `${header}\nThis is part ${i + 1} of ${chunks.length} of a larger dataset. Extract every finding, figure and row-level detail relevant to the task as concise notes; a later step will merge all parts.\n\n${chunks[i]}`,
              'markdown')
            addUsage(part.usage)
            notes.push(`## Part ${i + 1}\n${part.text}`)
          }
          setProgressLabel(`Combining ${chunks.length} parts…`)
          final = await streamRun(
            `${header}\nThe data was too large for one pass, so it was analysed in ${chunks.length} parts. Combine these partial results into one complete answer to the original task. Totals and counts must cover ALL parts.\n\n${notes.join('\n\n').slice(0, CHUNK_CHARS)}`,
            outputType, live)
          addUsage(final.usage)
        }
      }

      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      resultRef.current = final.text
      setResult(final.text)
      const finalUsage = totalUsage.input_tokens || totalUsage.output_tokens ? totalUsage : null
      setUsage(finalUsage)

      async function saveHistory() {
        const { data: row, error } = await supabase.from('run_history').insert({
          user_id: user.id, app_id: app.id, app_name: app.name,
          input: rawData.slice(0, 500) + (rawData.length > 500 ? '...' : ''),
          output: resultRef.current,
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
      setProgressLabel('')
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
              <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}
                className="text-[10px] text-slate-400 hover:text-white bg-[#1F2444] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1">
                {uploadingFile ? '⟳ Uploading…' : '📁 Upload file'}
              </button>
              <input ref={fileInputRef} type="file" className="hidden"
                accept=".csv,.txt,.json,.md,.pdf,.xlsx,.xlsm,.docx" onChange={handleFile} />
            </>
          )}
        </div>
        {fileName && (
          <p className="text-[10px] text-[#6C5CE7] mb-1.5">
            📎 {fileName}{fileMeta && <span className="text-emerald-400 ml-1">· stored for 30 days</span>}
          </p>
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
            {rawData.length > CHUNK_CHARS && ` · large input: processed in ${chunkText(rawData, dataType === 'csv').length} parts`}
          </p>
        )}
        {dataType !== 'url' && (
          <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">
            Text-based PDF, Word and Excel files are extracted server-side and stored for 30 days. Scanned PDFs need OCR first. Extraction loads up to {MAX_EXTRACT_CHARS.toLocaleString()} characters; interactive analysis handles about {MAX_ANALYSIS_CHARS.toLocaleString()} characters per run.
          </p>
        )}
      </div>

      <button onClick={processData} disabled={loading || !rawData.trim()}
        className="w-full bg-[#E17055] hover:bg-[#d4614a] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
        {loading ? <><span className="animate-spin">⟳</span> Processing data...</> : `▦ Process ${currentType.label}`}
      </button>

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">{error}</div>}

      {loading && !result && <ThinkingIndicator label={progressLabel || 'Processing data...'} />}

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
