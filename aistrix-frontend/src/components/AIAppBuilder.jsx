import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { parseSSELine } from '../lib/sse'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const QUESTIONS_SYSTEM_PROMPT = `You are an expert AI app architect on a platform called Aistrix.
When a developer describes an app idea, generate exactly 6-8 precise clarifying questions.

Return ONLY valid JSON — no markdown, no explanation, just the JSON object:
{
  "questions": [
    { "id": "input_type", "question": "How do users provide input?", "options": ["Text / Prompt", "Structured Form", "File Upload", "API Call"] },
    { "id": "ai_provider", "question": "Which AI provider?", "options": ["Claude (Anthropic)", "GPT (OpenAI)", "Either"] },
    { "id": "output_format", "question": "Output format?", "options": ["Plain Text", "Markdown", "JSON", "Table"] },
    ... more questions tailored to the specific app described
  ]
}

Always include questions about: input method, AI provider, output format, authentication needed, pricing model, deployment.
Keep questions short. Keep options to 2-4 choices. Tailor questions to the specific app idea.`

const GENERATE_SYSTEM_PROMPT = `You are an expert AI app architect for Aistrix — a no-code AI app platform.
Given a developer's app idea and their requirement answers, generate a complete Aistrix app configuration.

Return ONLY valid JSON — no markdown, no explanation:
{
  "name": "Short memorable app name",
  "emoji": "single relevant emoji",
  "description": "One sentence describing what this app does for users",
  "app_type": "prompt OR native",
  "system_prompt": "Detailed, well-crafted system prompt that makes the AI behave correctly for this use case. Include output format instructions based on the chosen output format.",
  "ai_provider": "claude OR openai",
  "ai_model": "claude-sonnet-4-6 OR gpt-4o-mini OR gpt-4o",
  "tags": ["tag1", "tag2", "tag3"],
  "form_schema": [
    // Only include if app_type is native. Array of field objects:
    // { "id": "uuid", "type": "text|textarea|number|select|date", "label": "Field label", "placeholder": "Hint", "required": true, "options": "A,B,C" }
  ],
  "tools": [
    // Only include if tools are genuinely needed. Each tool:
    // { "type": "search|calculator|fetch|http", "name": "fn_name", "description": "When to use this" }
  ],
  "notes": "Brief note to developer about limitations or next steps (e.g. file upload coming soon)"
}

Rules:
- Use app_type "native" if the developer wants structured form inputs (multiple distinct fields)
- Use app_type "prompt" for single text input
- Recommend claude-sonnet-4-6 by default unless GPT was specifically chosen
- Only add tools if genuinely needed (search for real-time data, calculator for math)
- Make the system_prompt professional and detailed — this is the heart of the app`

async function callAI(systemPrompt, userMessage) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${API_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({
      input: userMessage,
      system_prompt: systemPrompt,
      ai_provider: 'claude',
      ai_model: 'claude-sonnet-4-6',
    }),
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n'); buffer = lines.pop()
    for (const line of lines) {
      const d = parseSSELine(line)
      if (d?.token) full += d.token
    }
  }
  return full.trim()
}

function parseJSON(raw) {
  const cleaned = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
  return JSON.parse(cleaned)
}

function QuestionCard({ q, answer, onAnswer }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-white font-medium">{q.question}</p>
      <div className="flex flex-wrap gap-2">
        {q.options.map(opt => (
          <button key={opt} onClick={() => onAnswer(q.id, opt)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
              answer === opt
                ? 'bg-[#6C5CE7] border-[#6C5CE7] text-white'
                : 'bg-[#1F2444] border-white/10 text-slate-300 hover:border-[#6C5CE7]/50 hover:text-white'
            }`}>
            {answer === opt && <span className="mr-1">✓</span>}{opt}
          </button>
        ))}
      </div>
    </div>
  )
}

function TestRunPanel({ config }) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)

  async function run() {
    if (!input.trim()) return
    setRunning(true); setResult('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          input,
          system_prompt: config.system_prompt,
          ai_provider: config.ai_provider || 'claude',
          ai_model: config.ai_model || 'claude-sonnet-4-6',
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
          if (d?.token) setResult(p => p + d.token)
        }
      }
    } catch (e) {
      setResult('Test run failed: ' + e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="border border-[#6C5CE7]/20 rounded-xl p-3 space-y-2 bg-[#0F1225]/60">
      <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">Test Run</p>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
          placeholder="Type a test input and press Enter…"
          className="flex-1 bg-[#1F2444] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/50 transition-colors"
        />
        <button onClick={run} disabled={running || !input.trim()}
          className="px-3 py-2 rounded-lg text-xs font-medium bg-[#6C5CE7]/20 hover:bg-[#6C5CE7]/30 text-[#A29BFE] border border-[#6C5CE7]/25 disabled:opacity-40 transition-colors shrink-0">
          {running ? '⟳' : '▶ Run'}
        </button>
      </div>
      {result && (
        <div className="space-y-1.5">
          <div className="bg-[#0F1225] rounded-lg p-3 text-xs text-slate-300 leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap">
            {result}
          </div>
          <p className="text-[10px] text-slate-500 italic">Not saved — this is a sample run only.</p>
        </div>
      )}
    </div>
  )
}

function AppPreview({ config, onSaveDraft, onPublish, onBack, saving }) {
  const [showTest, setShowTest] = useState(false)

  return (
    <div className="space-y-4">
      <div className="bg-[#1F2444] border border-[#6C5CE7]/30 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-[#6C5CE7]/20 flex items-center justify-center text-2xl">{config.emoji}</div>
          <div>
            <p className="text-white font-semibold text-lg">{config.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] bg-[#6C5CE7]/20 text-[#6C5CE7] px-2 py-0.5 rounded-full capitalize">{config.app_type} app</span>
              <span className="text-[10px] text-slate-500">{config.ai_provider === 'openai' ? '🟢 GPT' : '🟣 Claude'}</span>
            </div>
          </div>
        </div>

        <p className="text-slate-300 text-sm mb-4">{config.description}</p>

        <div className="space-y-3">
          <div>
            <p className="text-[10px] text-slate-500 uppercase mb-1.5">System Prompt</p>
            <div className="bg-[#0F1225] rounded-xl p-3 text-xs text-slate-400 leading-relaxed max-h-28 overflow-y-auto">
              {config.system_prompt}
            </div>
          </div>

          {config.app_type === 'native' && config.form_schema?.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase mb-1.5">Form Fields</p>
              <div className="flex flex-wrap gap-1.5">
                {config.form_schema.map((f, i) => (
                  <span key={i} className="text-[10px] bg-[#0F1225] text-slate-400 px-2 py-1 rounded-lg">
                    {f.label} <span className="text-slate-600">({f.type})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {config.tools?.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase mb-1.5">Tools</p>
              <div className="flex flex-wrap gap-1.5">
                {config.tools.map((t, i) => (
                  <span key={i} className="text-[10px] bg-[#0F1225] text-slate-400 px-2 py-1 rounded-lg">
                    🔧 {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {(config.tags || []).map(t => (
              <span key={t} className="text-[9px] bg-[#0F1225] text-slate-500 px-2 py-0.5 rounded capitalize">{t}</span>
            ))}
          </div>
        </div>

        {config.notes && (
          <div className="mt-4 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <p className="text-[11px] text-amber-400 leading-relaxed">💡 {config.notes}</p>
          </div>
        )}
      </div>

      {/* Test run toggle */}
      <button onClick={() => setShowTest(v => !v)}
        className="w-full text-xs text-slate-400 hover:text-white border border-white/10 hover:border-[#6C5CE7]/30 rounded-xl py-2 transition-all">
        {showTest ? '▴ Hide test run' : '▶ Test run before saving'}
      </button>
      {showTest && <TestRunPanel config={config} />}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button onClick={onBack}
          className="bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm py-2.5 px-4 rounded-xl transition-colors shrink-0">
          ← Adjust
        </button>
        <button onClick={onSaveDraft} disabled={!!saving}
          className="flex-1 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-300 text-sm py-2.5 rounded-xl transition-colors border border-white/10">
          {saving === 'draft' ? 'Saving…' : '⚫ Save Draft'}
        </button>
        <button onClick={onPublish} disabled={!!saving}
          className="flex-1 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm py-2.5 rounded-xl font-medium transition-colors">
          {saving === 'publish' ? 'Publishing…' : '🌐 Publish'}
        </button>
      </div>
    </div>
  )
}

export default function AIAppBuilder({ user, onClose, onBack, onCreated }) {
  const [phase, setPhase] = useState('describe')
  const [description, setDescription] = useState('')
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [generatedConfig, setGeneratedConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(null) // null | 'draft' | 'publish'
  const toast = useToast()

  async function handleDescribe() {
    if (!description.trim()) return
    setLoading(true); setError('')
    setLoadingMsg('Analyzing your idea...')
    try {
      const raw = await callAI(QUESTIONS_SYSTEM_PROMPT, `App idea: ${description}`)
      const parsed = parseJSON(raw)
      setQuestions(parsed.questions || [])
      setPhase('questions')
    } catch (e) {
      setError('Could not generate questions. Please try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate() {
    const unanswered = questions.filter(q => !answers[q.id])
    if (unanswered.length > 0) {
      setError(`Please answer all questions (${unanswered.length} remaining)`)
      return
    }
    setLoading(true); setError('')
    setLoadingMsg('Generating your app configuration...')
    try {
      const answerSummary = questions.map(q => `${q.question} → ${answers[q.id]}`).join('\n')
      const prompt = `App idea: ${description}\n\nRequirements:\n${answerSummary}`
      const raw = await callAI(GENERATE_SYSTEM_PROMPT, prompt)
      const config = parseJSON(raw)
      if (config.form_schema) {
        config.form_schema = config.form_schema.map(f => ({ ...f, id: f.id || crypto.randomUUID() }))
      }
      setGeneratedConfig(config)
      setPhase('preview')
    } catch (e) {
      setError('Could not generate app config. Try rephrasing your description.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(publish) {
    if (!generatedConfig) return
    setSaving(publish ? 'publish' : 'draft')
    try {
      const cfg = generatedConfig
      const outputMap = {
        'json': 'json', 'table': 'table', 'cards': 'cards',
        'chart': 'chart', 'key-value': 'key_value', 'key_value': 'key_value',
      }
      const outputType = outputMap[cfg.output_type?.toLowerCase()] || 'markdown'

      const { data, error: err } = await supabase.from('apps').insert({
        name: cfg.name,
        emoji: cfg.emoji || '🤖',
        description: cfg.description,
        system_prompt: cfg.system_prompt,
        app_type: cfg.app_type || 'prompt',
        form_schema: cfg.form_schema || [],
        output_type: outputType,
        ai_provider: cfg.ai_provider || 'claude',
        ai_model: cfg.ai_model || 'claude-sonnet-4-6',
        tags: cfg.tags || [],
        is_published: publish,
        created_by: user.id,
        workflow_order: 999,
        total_runs: 0,
      }).select('*, domains(name, emoji, color, slug)').single()

      if (err) throw err

      if (cfg.tools?.length > 0) {
        await supabase.from('app_tools').insert(
          cfg.tools.map(t => ({
            app_id: data.id,
            name: t.name || t.type,
            description: t.description || `${t.type} tool`,
            type: t.type,
            config: t.config || {},
            input_schema: { type: 'object', properties: {}, required: [] },
          }))
        )
      }

      toast(publish ? `🌐 "${data.name}" published` : `⚫ "${data.name}" saved as draft`, 'success', 4000)
      onCreated?.(data)
      onClose()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSaving(null)
    }
  }

  const answeredCount = Object.keys(answers).length
  const allAnswered = questions.length > 0 && answeredCount === questions.length

  // Progress steps
  const steps = ['describe', 'questions', 'preview']
  const stepIdx = steps.indexOf(phase)

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6C5CE7] to-[#E84393] flex items-center justify-center text-white font-bold text-sm">✦</div>
            <div>
              <p className="text-white font-semibold">Build with AI</p>
              <p className="text-xs text-slate-400">Describe your app — AI configures everything</p>
            </div>
          </div>
          <button onClick={onBack && phase === 'describe' ? onBack : onClose} className="text-slate-500 hover:text-white transition-colors text-sm">
            {onBack && phase === 'describe' ? '← Back' : '✕'}
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex gap-0 px-5 pt-4 pb-1">
          {['Describe', 'Configure', 'Preview & Save'].map((label, i) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div className={`h-1 w-full rounded-full transition-all ${i <= stepIdx ? 'bg-[#6C5CE7]' : 'bg-white/8'}`} />
              <span className={`text-[9px] font-medium ${i === stepIdx ? 'text-[#A29BFE]' : i < stepIdx ? 'text-slate-500' : 'text-slate-700'}`}>{label}</span>
            </div>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {/* Phase: Describe */}
          {(phase === 'describe' || phase === 'questions') && (
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-[#1F2444] flex items-center justify-center text-xs text-slate-400 shrink-0 mt-0.5">You</div>
                <div className={`flex-1 bg-[#1F2444] rounded-2xl rounded-tl-sm p-3 ${phase === 'questions' ? 'border border-white/5' : ''}`}>
                  {phase === 'questions' ? (
                    <p className="text-slate-300 text-sm">{description}</p>
                  ) : (
                    <textarea
                      className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none resize-none leading-relaxed"
                      rows={3}
                      placeholder="e.g. I want an app that analyzes invoices and extracts line items..."
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleDescribe() }}
                      autoFocus
                    />
                  )}
                </div>
              </div>

              {phase === 'describe' && (
                <div className="flex justify-end">
                  <button onClick={handleDescribe} disabled={loading || !description.trim()}
                    className="bg-gradient-to-r from-[#6C5CE7] to-[#E84393] disabled:opacity-40 text-white text-sm px-5 py-2 rounded-xl font-medium transition-opacity">
                    {loading ? loadingMsg : 'Analyze idea →'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Phase: Questions */}
          {phase === 'questions' && (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#6C5CE7] to-[#E84393] flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">✦</div>
                <div className="flex-1 space-y-4">
                  <p className="text-slate-400 text-sm">Got it. A few questions to configure this precisely:</p>
                  {questions.map(q => (
                    <QuestionCard key={q.id} q={q} answer={answers[q.id]} onAnswer={(id, opt) => setAnswers(prev => ({ ...prev, [id]: opt }))} />
                  ))}
                </div>
              </div>

              {error && <p className="text-red-400 text-xs text-center">{error}</p>}

              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <p className="text-[11px] text-slate-500">{answeredCount} of {questions.length} answered</p>
                <button onClick={handleGenerate} disabled={loading || !allAnswered}
                  className="bg-gradient-to-r from-[#6C5CE7] to-[#E84393] disabled:opacity-40 text-white text-sm px-5 py-2 rounded-xl font-medium transition-opacity">
                  {loading ? loadingMsg : '✦ Generate App →'}
                </button>
              </div>
            </div>
          )}

          {/* Phase: Preview */}
          {phase === 'preview' && generatedConfig && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#6C5CE7] to-[#E84393] flex items-center justify-center text-white text-xs font-bold shrink-0">✦</div>
                <p className="text-slate-400 text-sm">Here's what I'll build for you — test it, then save or publish:</p>
              </div>
              <AppPreview
                config={generatedConfig}
                onSaveDraft={() => handleSave(false)}
                onPublish={() => handleSave(true)}
                onBack={() => setPhase('questions')}
                saving={saving}
              />
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-3 justify-center py-4">
              <span className="animate-spin text-[#6C5CE7]">⟳</span>
              <span className="text-slate-400 text-sm">{loadingMsg}</span>
            </div>
          )}

          {error && phase !== 'questions' && (
            <p className="text-red-400 text-xs text-center">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
