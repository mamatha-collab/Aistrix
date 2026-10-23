import { useRef, useState } from 'react'
import { APP_PUBLIC_SELECT } from '../lib/appColumns'
import { persistBlueprintPhase } from '../lib/blueprintStorage'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBuilderNavigation } from '../hooks/useBuilderNavigation'
import { confirmDiscard } from '../lib/confirmDiscard'
import { generateJSON, streamRun } from '../lib/runStream'
import { TOOL_DEFAULT_SCHEMAS } from '../utils/toolTypes'
import { fieldKeyFromLabel, outputFieldsErrors } from '../utils/schemaContracts'
import { saveStarterBlueprint } from '../utils/appContracts'
import { TypeGuideSteps } from './TypeBuilderGuide'
import { DEFAULT_PROVIDERS, PROVIDER_STYLE, defaultAppProvider, loadProviders } from '../lib/providers'
import OutputRenderer from './OutputRenderer'

import { BRAND } from '../lib/brand'
const QUESTIONS_SYSTEM_PROMPT = `You are an expert AI app architect on a platform called ${BRAND}.
When a developer describes an app idea, generate exactly 6-8 precise clarifying questions.

Return ONLY valid JSON — no markdown, no explanation, just the JSON object:
{
  "questions": [
    { "id": "input_type", "question": "How do users provide input?", "options": ["Type a request", "Fill in a form", "Paste data or upload a document", "Chat back and forth"] },
    { "id": "output_format", "question": "What should the result look like?", "options": ["Written answer", "Table", "Structured data fields"] },
    { "id": "tone", "question": "Tone?", "options": ["Friendly", "Professional", "Concise"] },
    ... more questions tailored to the specific app described
  ]
}

Always include questions about: who uses it, how they provide input (typed text, a form with fields, pasted data or a document, or a back-and-forth chat), the output format (written answer, table, structured data fields), and the tone.
Do not ask about deployment, hosting, authentication, pricing or APIs — ${BRAND} handles those.
Keep questions short. Keep options to 2-4 choices. Tailor questions to the specific app idea.`

const GENERATE_SYSTEM_PROMPT = `You are an expert AI app architect for ${BRAND} — a no-code AI app platform.
Given a developer's app idea and their requirement answers, generate a complete ${BRAND} app configuration.

Return ONLY valid JSON — no markdown, no explanation:
{
  "name": "Short memorable app name",
  "emoji": "single relevant emoji",
  "description": "One sentence describing what this app does for users",
  "app_type": "prompt OR native OR structured OR data OR chatbot",
  "output_type": "markdown OR table OR cards OR key_value OR json",
  "input_placeholder": "Short example of what a user would type",
  "system_prompt": "Detailed, well-crafted system prompt that makes the AI behave correctly for this use case. Include output format instructions based on the chosen output format.",
  "ai_provider": "claude OR openai OR gemini",
  "ai_model": "claude-sonnet-5-5 OR gpt-4o-mini OR gpt-4o",
  "tags": ["tag1", "tag2", "tag3"],
  "form_schema": [
    // Only include if app_type is native. Array of field objects:
    // { "id": "uuid", "type": "text|textarea|number|select|date", "label": "Field label", "placeholder": "Hint", "required": true, "options": "A,B,C" }
  ],
  "output_fields": [
    // Only for app_type structured: the JSON fields every answer must contain.
    // { "field": "snake_case_name", "type": "string|number|boolean|enum|string_array|number_array|object", "required": true, "description": "what it holds", "enum_values": ["only", "for", "enum"] }
  ],
  "greeting": "Only for app_type chatbot: the first message users see",
  "tone": "Only for app_type chatbot: friendly OR professional OR concise OR playful OR empathetic",
  "tools": [
    // Only include if tools are genuinely needed. Each tool:
    // { "type": "search|calculator|fetch|http", "name": "fn_name", "description": "When to use this" }
  ],
  "business_problem": "One sentence: the problem this app solves, from the idea and answers",
  "audience": "Who uses it day to day, from the answers (e.g. 'Sales development reps at B2B software companies')",
  "missing_data_fallback": "One sentence: what the app does when the input lacks details it needs, from the answers",
  "output_sections": ["Only for markdown/key_value/table output: the sections, fields or columns every answer must contain, exactly as the system_prompt names them"],
  "notes": "One or two plain-language sentences for the developer about limitations or next steps. Never use internal names such as app_type, native, structured, key_value, output_type, output_fields or form_schema."
}

Rules:
- Use app_type "native" if users fill in several distinct fields (a form)
- Use app_type "prompt" for a single typed request
- Use app_type "structured" when the result must be machine-readable data fields (then output_type is "json" and output_fields is required)
- Use app_type "data" when users paste CSV/text or upload a document to analyse
- Use app_type "chatbot" for a back-and-forth assistant (include greeting and tone)
- Match output_type to the requested result: "table" for tables, "markdown" for written answers
- Recommend claude-sonnet-5-5 by default unless GPT was specifically chosen
- Only add tools if genuinely needed (search for real-time data, calculator for math)
- Make the system_prompt professional and detailed — this is the heart of the app`

const APP_TYPES = ['prompt', 'native', 'structured', 'data', 'chatbot']

// The names developers see in the type picker.
const TYPE_NAMES = { prompt: 'Prompt App', native: 'Form App', structured: 'Structured Output', data: 'Data App', chatbot: 'Chatbot' }

// The builder's note is for developers, not engineers: translate any internal
// names that slip through ('native', key_value, output_fields…).
const PLAIN_TERMS = {
  native: 'Form app', prompt: 'Prompt app', structured: 'Structured Output', data: 'Data app', chatbot: 'Chatbot',
  key_value: 'Label: value', 'key-value': 'Label: value', output_type: 'output format', output_fields: 'output fields',
  form_schema: 'form fields', app_type: 'app type', json: 'JSON', markdown: 'formatted text',
}
function plainNote(note) {
  return String(note || '')
    .replace(/['"`‘’“”]([a-z_-]+)['"`‘’“”]/gi, (m, w) => PLAIN_TERMS[w.toLowerCase()] || m)
    .replace(/\b(app_type|output_type|output_fields|form_schema|key_value)\b/g, w => PLAIN_TERMS[w])
    .trim()
}
const OUTPUT_TYPES = { json: 'json', table: 'table', cards: 'cards', chart: 'chart', key_value: 'key_value', 'key-value': 'key_value', markdown: 'markdown' }
const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'date']
const OUTPUT_FIELD_TYPES = ['string', 'number', 'boolean', 'enum', 'string_array', 'number_array', 'object']
const TONES = ['friendly', 'professional', 'concise', 'playful', 'empathetic']
const MODELS = Object.fromEntries(DEFAULT_PROVIDERS.map(p => [p.id, p.models.map(m => m.id)]))

// The model's JSON is a suggestion: coerce it into a config the app can run.
function normaliseConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  if (!String(c.name || '').trim() || !String(c.system_prompt || '').trim()) {
    throw new Error('the AI response was missing the app name or instructions. Try again.')
  }
  let appType = APP_TYPES.includes(c.app_type) ? c.app_type : 'prompt'
  const formSchema = (Array.isArray(c.form_schema) ? c.form_schema : [])
    .filter(f => f && String(f.label || '').trim())
    .map(f => ({
      id: f.id && String(f.id).length > 8 ? f.id : crypto.randomUUID(),
      type: FIELD_TYPES.includes(f.type) ? f.type : 'text',
      label: String(f.label).trim().slice(0, 80),
      placeholder: f.placeholder || '',
      required: f.required !== false,
      options: Array.isArray(f.options) ? f.options.join(',') : String(f.options || ''),
    }))
  if (appType === 'native' && !formSchema.length) appType = 'prompt'

  const seen = new Set()
  let outputFields = (Array.isArray(c.output_fields) ? c.output_fields : [])
    .map(f => ({
      field: fieldKeyFromLabel(f?.field || f?.name || ''),
      type: OUTPUT_FIELD_TYPES.includes(f?.type) ? f.type : 'string',
      required: f?.required !== false,
      description: String(f?.description || '').slice(0, 200),
      ...(f?.type === 'enum' && Array.isArray(f.enum_values) ? { enum_values: f.enum_values.map(String).filter(Boolean) } : {}),
    }))
    .filter(f => f.field && !seen.has(f.field) && seen.add(f.field))
    .map(f => (f.type === 'enum' && !f.enum_values?.length ? { ...f, type: 'string' } : f))
  if (outputFieldsErrors(outputFields)) outputFields = []
  if (appType === 'structured' && !outputFields.length) appType = 'prompt'

  const provider = MODELS[c.ai_provider] ? c.ai_provider : 'claude'
  const model = MODELS[provider].includes(c.ai_model) ? c.ai_model : MODELS[provider][0]
  let outputType = OUTPUT_TYPES[String(c.output_type || '').toLowerCase()] || 'markdown'
  if (appType === 'structured') outputType = 'json'
  if (appType === 'chatbot') outputType = 'markdown'
  const tools = (Array.isArray(c.tools) ? c.tools : [])
    .filter(t => t && TOOL_DEFAULT_SCHEMAS[t.type])
    .map(t => ({
      type: t.type,
      name: fieldKeyFromLabel(t.name || t.type) || t.type,
      description: String(t.description || `${t.type} tool`).slice(0, 300),
    }))

  return {
    name: String(c.name).trim().slice(0, 80),
    emoji: String(c.emoji || '🤖').slice(0, 8),
    description: String(c.description || '').trim().slice(0, 300),
    app_type: appType,
    output_type: outputType,
    system_prompt: String(c.system_prompt).trim(),
    input_placeholder: String(c.input_placeholder || '').slice(0, 200),
    ai_provider: provider,
    ai_model: model,
    tags: (Array.isArray(c.tags) ? c.tags : String(c.tags || '').split(',')).map(t => String(t).trim()).filter(Boolean).slice(0, 6),
    form_schema: appType === 'native' ? formSchema : [],
    output_fields: appType === 'structured' ? outputFields : [],
    greeting: appType === 'chatbot' ? String(c.greeting || '').trim().slice(0, 1000) : '',
    tone: appType === 'chatbot' && TONES.includes(c.tone) ? c.tone : null,
    tools,
    notes: plainNote(c.notes),
    // What Design asks for, so the app doesn't land there half-empty.
    known: {
      business_problem: String(c.business_problem || '').trim().slice(0, 500),
      audience: String(c.audience || '').trim().slice(0, 300),
      fallback: String(c.missing_data_fallback || '').trim().slice(0, 500),
      sections: appType === 'structured' || appType === 'chatbot' ? []
        : (Array.isArray(c.output_sections) ? c.output_sections : []).map(x => String(x).trim()).filter(x => x && x.length <= 60).slice(0, 12),
    },
  }
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
  const [formValues, setFormValues] = useState({})
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  // Form apps are tried with their form, sent the way the live app sends it.
  const fields = config.app_type === 'native' ? (config.form_schema || []) : []
  const formInput = fields.map(f => formValues[f.id]?.trim() ? `${f.label}: ${formValues[f.id].trim()}` : null).filter(Boolean).join('\n')
  const ready = fields.length ? !!formInput : !!input.trim()

  async function run() {
    if (!ready) return
    setRunning(true); setResult('')
    try {
      await streamRun({
        purpose: 'build',
        input: fields.length ? formInput : input,
        ...(fields.length ? { field_values: Object.fromEntries(fields.map(f => [f.label, formValues[f.id] ?? ''])) } : {}),
        system_prompt: config.system_prompt,
        ai_provider: config.ai_provider || 'claude',
        ai_model: config.ai_model || 'claude-sonnet-5-5',
        output_type: config.output_type || 'markdown',
        run_mode: config.app_type === 'chatbot' ? 'conversation' : undefined,
      }, { onToken: setResult })
    } catch (e) {
      setResult('Test run failed: ' + e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="border border-[#6C5CE7]/20 rounded-xl p-3 space-y-2 bg-[#0F1225]/60">
      <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">Test Run</p>
      {fields.length ? (
        <div className="space-y-2">
          {fields.map(f => {
            const cls = 'w-full bg-[#1F2444] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/50 transition-colors'
            const set = e => setFormValues(v => ({ ...v, [f.id]: e.target.value }))
            return (
              <div key={f.id}>
                <label className="text-[11px] text-slate-400 block mb-1">{f.label}{f.required && <span className="text-red-400"> *</span>}</label>
                {f.type === 'textarea' ? <textarea rows={2} className={`${cls} resize-none`} placeholder={f.placeholder} value={formValues[f.id] || ''} onChange={set} />
                  : f.type === 'select' ? (
                    <select className={cls} value={formValues[f.id] || ''} onChange={set}>
                      <option value="">Select...</option>
                      {String(f.options || '').split(',').map(o => o.trim()).filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} className={cls} placeholder={f.placeholder} value={formValues[f.id] || ''} onChange={set} />}
              </div>
            )
          })}
          <button onClick={run} disabled={running || !ready}
            className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-[#6C5CE7]/20 hover:bg-[#6C5CE7]/30 text-[#A29BFE] border border-[#6C5CE7]/25 disabled:opacity-40 transition-colors">
            {running ? '⟳ Running…' : '▶ Run'}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="Type a test input and press Enter…"
            className="flex-1 bg-[#1F2444] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/50 transition-colors"
          />
          <button onClick={run} disabled={running || !ready}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-[#6C5CE7]/20 hover:bg-[#6C5CE7]/30 text-[#A29BFE] border border-[#6C5CE7]/25 disabled:opacity-40 transition-colors shrink-0">
            {running ? '⟳' : '▶ Run'}
          </button>
        </div>
      )}
      {result && (
        <div className="space-y-1.5">
          {/* The same output view the live app uses (fields, table, JSON, text). */}
          <div className="bg-[#0F1225] rounded-lg p-3 text-xs text-slate-300 leading-relaxed max-h-72 overflow-y-auto">
            {result.startsWith('Test run failed:')
              ? <p className="whitespace-pre-wrap">{result}</p>
              : <OutputRenderer result={result} outputType={config.output_type || 'markdown'} loading={running} title={config.name} />}
          </div>
          <p className="text-[10px] text-slate-500 italic">Not saved — this is a sample run only.</p>
        </div>
      )}
    </div>
  )
}

function AppPreview({ config, onSaveDraft, onPublish, onBack, saving }) {
  const [showTest, setShowTest] = useState(false)
  const generatedItems = [
    ['App type', TYPE_NAMES[config.app_type] || 'AI app', true],
    ['Prompt', config.system_prompt?.length > 120 ? 'Detailed system prompt generated' : 'Prompt needs review', !!config.system_prompt],
    ['Inputs', config.app_type === 'native' ? `${config.form_schema?.length || 0} form fields` : 'Single prompt input', true],
    ['Output', config.output_type || 'markdown', true],
    ['Model', `${(PROVIDER_STYLE[config.ai_provider] || PROVIDER_STYLE.claude).name} · ${config.ai_model || 'default'}`, !!config.ai_model],
    ['Tools', config.tools?.length ? `${config.tools.length} tool${config.tools.length !== 1 ? 's' : ''}` : 'No external tools', true],
  ]
  const reviewItems = [
    !config.description?.trim() && 'Add a business-facing description',
    (config.system_prompt || '').length < 200 && 'Strengthen the system prompt before production',
    config.app_type === 'native' && !(config.form_schema || []).length && 'Add form fields so users do not rely on a blank prompt',
    (config.tools || []).length > 0 && 'Check required secrets for generated tools',
    'Run generated functional, edge-case, safety, performance, and contract tests',
  ].filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-emerald-300 uppercase tracking-wider">AI generation review</p>
            <p className="text-[11px] text-slate-400 mt-1">${BRAND} generated the first blueprint. Review these items, then save into Design and run tests before Deploy.</p>
          </div>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            Draft confidence
          </span>
        </div>
        <div className="grid md:grid-cols-3 gap-2">
          {generatedItems.map(([label, value, ok]) => (
            <div key={label} className="bg-[#0F1225] border border-white/5 rounded-xl px-3 py-2">
              <p className="text-[9px] text-slate-600 uppercase font-semibold">{label}</p>
              <p className={`text-[11px] mt-0.5 ${ok ? 'text-slate-300' : 'text-amber-300'}`}>{value}</p>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          <div className="bg-[#0F1225] border border-white/5 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1.5">Needs developer review</p>
            {reviewItems.map(item => (
              <p key={item} className="text-[11px] text-slate-400 leading-relaxed">○ {item}</p>
            ))}
          </div>
          <div className="bg-[#0F1225] border border-white/5 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1.5">Tests ${BRAND} will create</p>
            {['Normal use', 'Incomplete input', 'Prompt/key leakage', 'Speed and cost', config.output_type === 'json' ? 'JSON contract' : 'Output quality'].map(item => (
              <p key={item} className="text-[11px] text-slate-400 leading-relaxed">✓ {item}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-[#1F2444] border border-[#6C5CE7]/30 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-[#6C5CE7]/20 flex items-center justify-center text-2xl">{config.emoji}</div>
          <div>
            <p className="text-white font-semibold text-lg">{config.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] bg-[#6C5CE7]/20 text-[#6C5CE7] px-2 py-0.5 rounded-full">{TYPE_NAMES[config.app_type] || 'AI app'}</span>
              <span className="text-[10px] text-slate-500">{(PROVIDER_STYLE[config.ai_provider] || PROVIDER_STYLE.claude).icon} {(PROVIDER_STYLE[config.ai_provider] || PROVIDER_STYLE.claude).name}</span>
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
          {saving === 'test' ? 'Saving…' : 'Save for Test →'}
        </button>
      </div>
    </div>
  )
}

// `withGuide`: start on the type guide ("Start building →" moves on to
// Describe), so the whole Build with AI flow stays in this one popup.
export default function AIAppBuilder({ user, onClose, onBack, onCreated, withGuide = false, presentation = 'modal', navigationGuardRef, onLeave }) {
  const panelRef = useRef(null)
  const [phase, setPhase] = useState(withGuide ? 'intro' : 'describe')
  const [description, setDescription] = useState('')
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [generatedConfig, setGeneratedConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(null) // null | 'draft' | 'publish'
  const toast = useToast()

  function closeWithWarning() {
    const hasChanges = !!(description.trim() || questions.length || Object.keys(answers).length || generatedConfig)
    if (confirmDiscard(hasChanges)) onClose()
  }

  function goBack() {
    if (phase === 'intro') { onBack?.(); return }
    if (phase === 'describe') {
      if (withGuide) setPhase('intro')
      else onBack?.()
      return
    }
    if (phase === 'questions') { setPhase('describe'); return }
    if (phase === 'preview') setPhase('questions')
  }

  const canGoBack = phase !== 'intro' && (phase !== 'describe' || withGuide || !!onBack)
  useFocusTrap(panelRef, { onEscape: closeWithWarning, enabled: presentation !== 'inline' })
  useBuilderNavigation({ enabled: presentation === 'inline', navigationGuardRef,
    hasChanges: !!(description.trim() || questions.length || Object.keys(answers).length || generatedConfig), busy: loading || !!saving, onLeave })

  async function handleDescribe() {
    if (!description.trim()) return
    setLoading(true); setError('')
    setLoadingMsg('Analyzing your idea...')
    try {
      const parsed = await generateJSON(QUESTIONS_SYSTEM_PROMPT, `App idea: ${description}`)
      const qs = (parsed.questions || []).filter(q => q?.id && q?.question && Array.isArray(q.options) && q.options.length)
      if (!qs.length) throw new Error('The AI did not return any questions. Try describing the app in a bit more detail.')
      setQuestions(qs)
      setPhase('questions')
    } catch (e) {
      setError(`Could not generate questions: ${e.message}`)
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
      const config = normaliseConfig(await generateJSON(GENERATE_SYSTEM_PROMPT, prompt))
      // Run the app on a provider the developer has a key for.
      const providers = await loadProviders().catch(() => [])
      if (!providers.find(p => p.id === config.ai_provider)?.connected) {
        const { provider, model } = defaultAppProvider(providers)
        config.ai_provider = provider
        config.ai_model = model
      }
      setGeneratedConfig(config)
      setPhase('preview')
    } catch (e) {
      setError(`Could not generate the app: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // forTest: save and put the app in Dev Studio's Test step. Nothing is
  // published here — publishing needs passing tests (Deploy).
  async function handleSave(forTest) {
    if (!generatedConfig) return
    setSaving(forTest ? 'test' : 'draft')
    try {
      const cfg = generatedConfig
      const chatbot = cfg.app_type === 'chatbot'
      const { data, error: err } = await supabase.from('apps').insert({
        name: cfg.name,
        emoji: cfg.emoji || '🤖',
        description: cfg.description,
        system_prompt: cfg.system_prompt,
        app_type: cfg.app_type,
        form_schema: cfg.app_type === 'native' ? cfg.form_schema : [],
        output_type: cfg.output_type,
        input_placeholder: cfg.input_placeholder || null,
        ai_provider: cfg.ai_provider,
        ai_model: cfg.ai_model,
        tags: cfg.tags,
        has_memory: chatbot,
        ...(chatbot ? { greeting: cfg.greeting || null, tone: cfg.tone || null } : {}),
        is_published: false,   // published below through the gate (checks + tests)
        created_by: user.id,
        workflow_order: 999,
        total_runs: 0,
      }).select(`${APP_PUBLIC_SELECT}, domains(name, emoji, color, slug)`).single()
        .then(res => (res.data ? { ...res, data: { ...res.data, system_prompt: cfg.system_prompt } } : res))

      if (err) throw err

      const problems = []
      if (cfg.tools.length > 0) {
        const { error } = await supabase.from('app_tools').insert(
          cfg.tools.map(t => ({
            app_id: data.id,
            name: t.name,
            description: t.description,
            type: t.type,
            config: {},
            // The parameters the model sees — without them a search tool is
            // called with no query and fails.
            input_schema: TOOL_DEFAULT_SCHEMAS[t.type],
          }))
        )
        if (error) problems.push(`tools: ${error.message}`)
      }
      {
        const error = await saveStarterBlueprint(data, user.id, { formSchema: data.form_schema || [], outputFields: cfg.output_fields, known: cfg.known })
        if (error) problems.push(`design blueprint: ${error.message}`)
      }

      let inTest = false
      if (forTest && !problems.length) {
        try {
          await persistBlueprintPhase(supabase, data.id, row => ({
            app_id: data.id, user_id: user.id, readiness_score: row?.readiness_score ?? 0,
            blueprint: { ...(row?.blueprint || {}), dev_phase: 'test' },
          }))
          inTest = true
          data.dev_phase = 'test'   // Dev Studio opens it in Test
        } catch (e) { problems.push(`Test step: ${e.message}`) }
      }
      // The app itself saved even if a follow-up step failed — say so
      // instead of a plain success toast.
      if (problems.length) {
        toast(`"${data.name}" saved, but not its ${problems.join('; ')}`, 'error', 7000)
      } else if (inTest) {
        toast(`🧪 "${data.name}" saved — run its tests in Dev Studio → Test, then publish from Deploy.`, 'success', 6000)
      } else {
        toast(`⚫ "${data.name}" saved as draft`, 'success', 4000)
      }
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

  const content = (
    <>
        {/* Header */}
        <div className="px-6 pt-6 pb-5 shrink-0 border-b border-white/5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6C5CE7] to-[#E84393] flex items-center justify-center text-white font-bold shrink-0">✦</div>
              <div>
                <p className="text-white font-bold text-xl leading-snug">Build with AI</p>
                <p className="text-slate-400 text-sm mt-0.5">Describe your app — AI configures everything</p>
              </div>
            </div>
            <button aria-label="Close" onClick={closeWithWarning} className="text-slate-500 hover:text-white transition-colors p-1 shrink-0 ml-4">
              ✕
            </button>
          </div>
        </div>

        {canGoBack && (
          <div className="px-6 py-2 border-b border-white/5 bg-[#0F1225]/45">
            <button onClick={goBack}
              className="text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-colors">
              ← Back
            </button>
          </div>
        )}

        {phase === 'intro' ? (
          <TypeGuideSteps type="ai_builder" onBack={goBack} onContinue={() => setPhase('describe')} />
        ) : (<>
        {/* Progress bar */}
        <div className="flex gap-0 px-5 pt-4 pb-1">
          {['Describe', 'Configure', 'Review & Save'].map((label, i) => (
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
                <p className="text-slate-400 text-sm">Here's the generated draft. Review what AI created, save it into Design, then run tests before Deploy:</p>
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
        </>)}
    </>
  )
  if (presentation === 'inline') return <section ref={panelRef} aria-label="Build with AI" className="developer-inline-builder bg-[#171B33] border border-white/10 rounded-xl w-full flex flex-col min-h-[600px] overflow-hidden">{content}</section>
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Build with AI"
        className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-6xl flex flex-col overflow-hidden"
        style={{ height: 'min(94vh, 840px)' }}>

        {content}
      </div>
    </div>
  )
}
