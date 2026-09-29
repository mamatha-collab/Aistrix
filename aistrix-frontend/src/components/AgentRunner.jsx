import { useState, useRef } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import OutputRenderer from './OutputRenderer'
import { parseSSELine } from '../lib/sse'
import RunRating from './RunRating'
import { friendlyErrorMessage } from '../utils/appActions'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const STEP_ICONS = {
  thinking: '🤔', tool_call: '⚙️', tool_result: '✓', complete: '🏁', error: '✕'
}

function ActivityFeed({ steps, loading }) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => (
        <div key={i} className={`flex items-start gap-2.5 text-xs py-1.5 px-3 rounded-lg transition-all
          ${step.type === 'complete' ? 'bg-green-500/10 border border-green-500/20' :
            step.type === 'error' ? 'bg-red-500/10 border border-red-500/20' :
            step.type === 'tool_result' ? 'bg-[#6C5CE7]/5' : ''}`}>
          <span className="shrink-0 mt-0.5 text-sm">{STEP_ICONS[step.type] || '·'}</span>
          <div className="flex-1 min-w-0">
            {step.type === 'tool_call' && (
              <>
                <span className="text-[#6C5CE7] font-mono font-medium">{step.name}()</span>
                {step.input && <p className="text-slate-500 text-[10px] mt-0.5 truncate font-mono">{JSON.stringify(step.input)}</p>}
              </>
            )}
            {step.type === 'tool_result' && (
              <p className="text-slate-400 text-[10px] truncate">→ {step.result}</p>
            )}
            {step.type === 'thinking' && (
              <p className="text-slate-400 italic">{step.text}</p>
            )}
            {step.type === 'complete' && (
              <p className="text-green-400 font-medium">Agent completed</p>
            )}
            {step.type === 'error' && (
              <p className="text-red-400">{step.text}</p>
            )}
          </div>
          {step.type === 'tool_call' && loading && i === steps.length - 1 && (
            <span className="text-[#6C5CE7] text-[10px] animate-pulse shrink-0">running</span>
          )}
        </div>
      ))}
      {loading && steps.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-slate-400 px-3 py-2">
          <span className="animate-spin">⟳</span> Agent is thinking...
        </div>
      )}
    </div>
  )
}

export default function AgentRunner({ app, user, onClose, onRun, inline = false }) {
  const [goal, setGoal] = useState('')
  const [steps, setSteps] = useState([])
  const [result, setResult] = useState('')
  const [usage, setUsage] = useState(null)
  const [lastRunId, setLastRunId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const resultRef = useRef('')
  const toast = useToast()

  async function runAgent() {
    if (!goal.trim()) return
    setLoading(true); setSteps([]); setResult(''); setError(''); setUsage(null); setLastRunId(null)
    resultRef.current = ''
    let finalUsage = null

    const agentSystemPrompt = (app.system_prompt || 'You are a helpful AI agent.') +
      `\n\nYou are operating in autonomous agent mode. Think through the problem step by step. Use available tools to gather information and take actions. Continue working until you have a complete, accurate answer. When finished, provide a clear, comprehensive final response.`

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          app_id: app.id, input: goal,
          system_prompt: agentSystemPrompt,
          ai_provider: app.ai_provider || 'claude',
          ai_model: app.ai_model || null,
          output_type: app.output_type || 'markdown',
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
          const data = parseSSELine(line)
          if (!data) continue
          if (data.token) { resultRef.current += data.token; setResult(resultRef.current) }
          if (data.tool_call) setSteps(prev => [...prev, { type: 'tool_call', name: data.tool_call.name, input: data.tool_call.input }])
          if (data.tool_result) setSteps(prev => [...prev, { type: 'tool_result', name: data.tool_result.name, result: data.tool_result.result }])
          if (data.done) { setSteps(prev => [...prev, { type: 'complete' }]); finalUsage = data.usage || null }
          if (data.error) throw new Error(data.error)
        }
      }

      setUsage(finalUsage)
      const finalResult = resultRef.current
      if (finalResult) {
        async function saveHistory() {
          const { data: row, error } = await supabase.from('run_history').insert({
            user_id: user.id, app_id: app.id, app_name: app.name,
            input: goal, output: finalResult,
            input_tokens: finalUsage?.input_tokens ?? null, output_tokens: finalUsage?.output_tokens ?? null,
          }).select('id').single()
          if (row) { setLastRunId(row.id); return true }
          if (error) toast(`Agent completed, but wasn't saved to history: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveHistory })
          return false
        }
        const saved = await saveHistory()
        await supabase.rpc('increment_app_runs', { p_app_id: app.id })
        onRun?.()
        if (saved) toast('Agent completed', 'success')
      }
    } catch (e) {
      const msg = friendlyErrorMessage(e)
      setError(msg)
      setSteps(prev => [...prev, { type: 'error', text: msg }])
    } finally {
      setLoading(false)
    }
  }

  const body = (
    <div className="flex flex-col gap-4">
      <div className="bg-[#6C5CE7]/10 border border-[#6C5CE7]/20 rounded-xl p-3 flex items-start gap-2">
        <span className="text-lg">◈</span>
        <div>
          <p className="text-[#6C5CE7] text-xs font-semibold">Agent Mode</p>
          <p className="text-slate-400 text-xs">The agent will plan, use tools, and work autonomously until your goal is complete.</p>
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1.5 block">What do you want the agent to accomplish?</label>
        <textarea
          className="w-full bg-[#1F2444] border border-white/10 rounded-xl p-3 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors"
          rows={3}
          placeholder={app.input_placeholder || 'e.g. Research the top 5 competitors of Tesla and summarize their EV strategies...'}
          value={goal} onChange={e => setGoal(e.target.value)}
        />
      </div>

      <button onClick={runAgent} disabled={loading || !goal.trim()}
        className="bg-gradient-to-r from-[#6C5CE7] to-[#E84393] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-xl font-medium transition-opacity flex items-center justify-center gap-2">
        {loading ? <><span className="animate-spin">⟳</span> Agent running...</> : '◈ Run Agent'}
      </button>

      {(steps.length > 0 || loading) && (
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 uppercase">Agent activity</p>
          <div className="bg-[#1F2444] border border-white/5 rounded-xl p-2 space-y-0.5">
            <ActivityFeed steps={steps} loading={loading} />
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-500 uppercase">Final result {loading && <span className="text-[#6C5CE7] animate-pulse">●</span>}</p>
            <div className="flex items-center gap-2">
              {usage && (
                <span className="text-[10px] text-slate-500" title="Tokens used for this run">
                  ↑{usage.input_tokens?.toLocaleString()} ↓{usage.output_tokens?.toLocaleString()} tok
                </span>
              )}
              {!loading && lastRunId && <RunRating key={lastRunId} runId={lastRunId} />}
            </div>
          </div>
          <OutputRenderer result={result} outputType={app.output_type || 'markdown'} loading={loading} title={app.name} />
        </div>
      )}

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">{error}</div>}
    </div>
  )

  if (inline) return body

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6C5CE7] to-[#E84393] flex items-center justify-center text-white font-bold">◈</div>
            <div>
              <p className="text-white font-medium">{app.name}</p>
              <p className="text-xs text-slate-400">AI Agent · {app.ai_provider === 'openai' ? 'GPT' : 'Claude'}</p>
            </div>
          </div>
          <button aria-label="Close" onClick={() => { if (loading && !window.confirm('Agent is running. Stop it?')) return; onClose() }}
            className="text-slate-500 hover:text-white text-lg">✕</button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{body}</div>
      </div>
    </div>
  )
}
