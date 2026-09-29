import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import OutputRenderer, { ThinkingIndicator } from './OutputRenderer'
import { parseSSELine } from '../lib/sse'
import RunRating from './RunRating'
import { friendlyErrorMessage } from '../utils/appActions'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function MultiPageRunner({ app, user, onClose, onRun, inline = false }) {
  const [pageIndex, setPageIndex] = useState(0)
  const [pageInputs, setPageInputs] = useState({})
  const [pageResults, setPageResults] = useState({})
  const [pageUsage, setPageUsage] = useState({})
  const [pageRunIds, setPageRunIds] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formValues, setFormValues] = useState({})
  const toast = useToast()

  const pages = app.pages || []
  const current = pages[pageIndex]
  const isLast = pageIndex === pages.length - 1
  const allDone = pageIndex >= pages.length

  function buildContextFromPreviousPages() {
    return Object.entries(pageResults)
      .filter(([idx]) => Number(idx) < pageIndex)
      .map(([idx, result]) => `[${pages[idx]?.title || `Step ${Number(idx) + 1}`}]\n${result}`)
      .join('\n\n')
  }

  async function runCurrentPage() {
    const rawInput = current.form_schema?.length > 0
      ? current.form_schema.map(f => formValues[`${pageIndex}_${f.id}`] ? `${f.label}: ${formValues[`${pageIndex}_${f.id}`]}` : null).filter(Boolean).join('\n')
      : pageInputs[pageIndex] || ''

    if (!rawInput.trim()) return
    setLoading(true); setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const previousContext = buildContextFromPreviousPages()
      const contextualInput = previousContext ? `Previous steps:\n${previousContext}\n\nCurrent input:\n${rawInput}` : rawInput

      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          app_id: app.id,
          input: contextualInput,
          system_prompt: current.system_prompt || app.system_prompt,
          ai_provider: app.ai_provider || 'claude',
          ai_model: app.ai_model || null,
          output_type: current.output_type || 'markdown',
        }),
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', full = '', finalUsage = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop()
        for (const line of lines) {
          const d = parseSSELine(line)
          if (d?.token) { full += d.token; setPageResults(prev => ({ ...prev, [pageIndex]: full })) }
          if (d?.done) finalUsage = d.usage || null
        }
      }
      setPageUsage(prev => ({ ...prev, [pageIndex]: finalUsage }))

      const thisPageIndex = pageIndex
      const thisPageTitle = current.title
      async function saveHistory() {
        const { data: row, error } = await supabase.from('run_history').insert({
          user_id: user.id, app_id: app.id, app_name: `${app.name} — ${thisPageTitle}`,
          input: rawInput, output: full,
          input_tokens: finalUsage?.input_tokens ?? null, output_tokens: finalUsage?.output_tokens ?? null,
        }).select('id').single()
        if (row) { setPageRunIds(prev => ({ ...prev, [thisPageIndex]: row.id })); return true }
        if (error) toast(`"${thisPageTitle}" completed, but wasn't saved to history: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveHistory })
        return false
      }
      const saved = await saveHistory()

      if (isLast) {
        await supabase.rpc('increment_app_runs', { p_app_id: app.id })
        onRun?.()
        if (saved) toast('All pages complete — results saved', 'success')
      }
    } catch (e) {
      setError(friendlyErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors'

  const body = (
    <div className="flex flex-col gap-4">
      {/* Progress stepper */}
      <div className="flex gap-2">
        {pages.map((p, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border transition-all
              ${i < pageIndex ? 'bg-green-500 border-green-500 text-white'
                : i === pageIndex ? 'border-[#6C5CE7] bg-[#6C5CE7]/20 text-[#6C5CE7]'
                : 'border-white/10 bg-[#1F2444] text-slate-500'}`}>
              {i < pageIndex ? '✓' : i + 1}
            </div>
            <span className="text-[9px] text-slate-500 text-center truncate w-full">{p.title}</span>
          </div>
        ))}
      </div>

      {allDone ? (
        <div className="text-center py-6">
          <div className="text-4xl mb-3">🎉</div>
          <p className="text-white font-medium mb-1">All done!</p>
          <p className="text-slate-400 text-sm">All {pages.length} pages completed.</p>
        </div>
      ) : (
        <>
          <div className="bg-[#1F2444] border border-white/5 rounded-xl px-4 py-3">
            <p className="text-xs text-[#6C5CE7] font-medium mb-0.5">Page {pageIndex + 1} of {pages.length}</p>
            <p className="text-white text-sm font-medium">{current.title}</p>
          </div>

          {/* Previous result preview */}
          {pageIndex > 0 && pageResults[pageIndex - 1] && (
            <div className="bg-[#0F1225] border border-white/5 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 uppercase mb-1">From previous page</p>
              <p className="text-xs text-slate-400 line-clamp-3">{pageResults[pageIndex - 1]}</p>
            </div>
          )}

          {/* Input */}
          {current.form_schema?.length > 0 ? (
            <div className="space-y-3">
              {current.form_schema.map(f => (
                <div key={f.id}>
                  <label className="text-xs text-slate-400 block mb-1.5">{f.label}{f.required && <span className="text-red-400 ml-1">*</span>}</label>
                  <input className={inputCls} placeholder={f.placeholder}
                    value={formValues[`${pageIndex}_${f.id}`] || ''}
                    onChange={e => setFormValues(prev => ({ ...prev, [`${pageIndex}_${f.id}`]: e.target.value }))} />
                </div>
              ))}
            </div>
          ) : (
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Input</label>
              <textarea className={inputCls} rows={4}
                placeholder={current.input_placeholder || 'Enter input for this step...'}
                value={pageInputs[pageIndex] || ''}
                onChange={e => setPageInputs(prev => ({ ...prev, [pageIndex]: e.target.value }))} />
            </div>
          )}

          <button onClick={runCurrentPage} disabled={loading}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm py-2.5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
            {loading ? <><span className="animate-spin">⟳</span> Running...</> : `▶ Run: ${current.title}`}
          </button>

          {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">{error}</div>}

          {loading && !pageResults[pageIndex] && <ThinkingIndicator />}

          {pageResults[pageIndex] && (
            <div className="space-y-3">
              {(pageUsage[pageIndex] || pageRunIds[pageIndex]) && (
                <div className="flex items-center justify-end gap-2">
                  {pageUsage[pageIndex] && (
                    <p className="text-[10px] text-slate-500" title="Tokens used for this page">
                      ↑{pageUsage[pageIndex].input_tokens?.toLocaleString()} ↓{pageUsage[pageIndex].output_tokens?.toLocaleString()} tok
                    </p>
                  )}
                  {!loading && pageRunIds[pageIndex] && <RunRating key={pageRunIds[pageIndex]} runId={pageRunIds[pageIndex]} />}
                </div>
              )}
              <OutputRenderer result={pageResults[pageIndex]} outputType={current.output_type || 'markdown'} title={`${app.name} — ${current.title || `Page ${pageIndex + 1}`}`} />
              <div className="flex gap-2">
                {pageIndex > 0 && (
                  <button onClick={() => setPageIndex(i => i - 1)}
                    className="flex-1 bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm py-2 rounded-xl transition-colors">
                    ← Back
                  </button>
                )}
                <button onClick={() => isLast ? setPageIndex(pages.length) : setPageIndex(i => i + 1)}
                  className="flex-1 bg-green-500/20 border border-green-500/30 text-green-400 text-sm py-2 rounded-xl font-medium transition-colors">
                  {isLast ? '✓ Complete' : 'Next page →'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )

  if (inline) return body

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{app.emoji}</span>
            <div>
              <p className="text-white font-medium">{app.name}</p>
              <p className="text-xs text-slate-400">Multi-page app · {pages.length} steps</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white text-lg">✕</button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{body}</div>
      </div>
    </div>
  )
}
