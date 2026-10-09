import { useState, useEffect, useTransition, useRef } from 'react'
import { supabase } from '../supabase'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { TypeGuideSteps } from './TypeBuilderGuide'
import { useToast } from '../hooks/useToast'
import { generateJSON, normaliseUrl, readUrl, streamRun } from '../lib/runStream'
import { TOOL_DEFAULT_SCHEMAS } from '../utils/toolTypes'
import OutputSchemaEditor from './OutputSchemaEditor'
import { formSchemaToInputFields, getOutputSchemaFields, outputFieldsErrors } from '../utils/schemaContracts'

const TYPE_DEFAULTS = {
  native: { emoji: '⊞', placeholder: 'Fill out the form fields and submit...' },
  data: { emoji: '▦', output_type: 'table', placeholder: 'Upload or paste data to analyze...' },
  website: { emoji: '🌐', placeholder: 'Ask about products, services, pricing, hours, or policies...' },
  structured: {
    emoji: '{}',
    output_type: 'json',
    placeholder: 'Paste messy text to extract structured fields...',
    system_prompt: 'You extract useful information from the user input and return only valid JSON that matches the output schema. Do not include markdown fences, explanations, or extra keys.',
  },
  api: { emoji: '{}', output_type: 'json', placeholder: 'Send JSON fields through the API...' },
  chatbot: {
    emoji: '💬',
    placeholder: 'Start a conversation...',
    system_prompt: 'You are a friendly, knowledgeable chatbot with a clear persona. Greet the user warmly, ask clarifying questions when needed, remember the conversation context within the session, and give concise, useful answers in the configured tone.',
    description: 'A conversational AI assistant with a custom persona and memory.',
    tags: 'chatbot, support, assistant',
  },
  prompt: { emoji: '✦', placeholder: 'Describe what you need...' },
}

function defaultForType(type, key, fallback = '') {
  return TYPE_DEFAULTS[type]?.[key] ?? fallback
}

const EMOJI_OPTIONS = ['🤖','🧠','✍️','📊','🔍','💡','📝','🎯','🚀','🛠️','💬','📈','🔧','🎨','📧','🌐','⚡','🏆','🎓','🔑']

const MODELS = {
  claude: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (Recommended)' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (Fast)' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (Powerful)' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Recommended)' },
    { id: 'gpt-4o', label: 'GPT-4o (Powerful)' },
  ],
}

const FIELD_TYPES = [
  { id: 'text',     label: 'Short text' },
  { id: 'textarea', label: 'Long text' },
  { id: 'number',   label: 'Number' },
  { id: 'select',   label: 'Dropdown' },
  { id: 'date',     label: 'Date' },
  { id: 'upload',   label: 'File upload' },
]

const TOOL_TYPES = [
  { id: 'search',     icon: '🔍', label: 'Web Search' },
  { id: 'fetch',      icon: '🌐', label: 'Fetch URL' },
  { id: 'calculator', icon: '🧮', label: 'Calculator' },
  { id: 'http',       icon: '🔗', label: 'HTTP Request' },
  { id: 'app',        icon: '🧩', label: 'Call App' },
  { id: 'pdf',        icon: '📄', label: 'PDF Parser' },
  { id: 'ocr',        icon: '🖼️', label: 'OCR (Image→Text)' },
  { id: 'email',      icon: '📧', label: 'Send Email' },
  { id: 'calendar',   icon: '📅', label: 'Calendar' },
  { id: 'storage',    icon: '🗂️', label: 'File Storage' },
]

// ─── Form Builder (for Native App) ───────────────────────────────────────────
function FormBuilder({ fields, onChange }) {
  const [editingIdx, setEditingIdx] = useState(null)
  const [draft, setDraft] = useState(null)
  const [dragIdx, setDragIdx] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  function addField() {
    const newField = { id: crypto.randomUUID(), type: 'text', label: '', placeholder: '', required: false, options: '' }
    onChange([...fields, newField])
    setEditingIdx(fields.length)
    setDraft(newField)
  }

  function saveField() {
    if (!draft?.label.trim()) return
    const updated = fields.map((f, i) => i === editingIdx ? { ...draft } : f)
    onChange(updated)
    setEditingIdx(null); setDraft(null)
  }

  function removeField(i) {
    onChange(fields.filter((_, idx) => idx !== i))
    if (editingIdx === i) { setEditingIdx(null); setDraft(null) }
  }

  function handleDragStart(i) { setDragIdx(i) }
  function handleDragOver(e, i) { e.preventDefault(); setDragOver(i) }
  function handleDrop(i) {
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOver(null); return }
    const arr = [...fields]
    const [moved] = arr.splice(dragIdx, 1)
    arr.splice(i, 0, moved)
    onChange(arr)
    if (editingIdx === dragIdx) setEditingIdx(i)
    setDragIdx(null); setDragOver(null)
  }

  const inCls = 'w-full bg-[#0F1225] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={f.id}>
          {editingIdx === i && draft ? (
            <div className="bg-[#1F2444] border border-[#6C5CE7]/40 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Field label</label>
                  <input className={inCls} placeholder="e.g. Company Name" value={draft.label}
                    onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} autoFocus />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Field type</label>
                  <select className={inCls} value={draft.type}
                    onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}>
                    {FIELD_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Placeholder hint</label>
                <input className={inCls} placeholder="e.g. Enter your company name..."
                  value={draft.placeholder} onChange={e => setDraft(d => ({ ...d, placeholder: e.target.value }))} />
              </div>
              {draft.type === 'select' && (
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Options (comma separated)</label>
                  <input className={inCls} placeholder="e.g. Option A, Option B, Option C"
                    value={draft.options} onChange={e => setDraft(d => ({ ...d, options: e.target.value }))} />
                </div>
              )}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={draft.required} onChange={e => setDraft(d => ({ ...d, required: e.target.checked }))}
                    className="accent-[#6C5CE7]" />
                  <span className="text-xs text-slate-400">Required</span>
                </label>
                <div className="flex gap-2 ml-auto">
                  <button onClick={() => { setEditingIdx(null); setDraft(null); if (!f.label) removeField(i) }}
                    className="text-xs text-slate-500 hover:text-white px-2 py-1 transition-colors">Cancel</button>
                  <button onClick={saveField} disabled={!draft.label.trim()}
                    className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-xs px-3 py-1 rounded-lg transition-colors">
                    Save field
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => { setDragIdx(null); setDragOver(null) }}
              className={`flex items-center gap-2 bg-[#1F2444] border rounded-xl px-3 py-2.5 group cursor-grab active:cursor-grabbing transition-all ${
                dragOver === i ? 'border-[#6C5CE7]/60 bg-[#6C5CE7]/10' : dragIdx === i ? 'border-white/20 opacity-40' : 'border-white/5'
              }`}>
              <span className="text-slate-600 group-hover:text-slate-400 transition-colors text-sm select-none shrink-0">⋮⋮</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-white">{f.label || <span className="text-slate-500 italic">Untitled field</span>}</span>
                <span className="ml-2 text-[10px] text-slate-500 bg-[#0F1225] px-1.5 py-0.5 rounded">
                  {FIELD_TYPES.find(t => t.id === f.type)?.label}
                </span>
                {f.required && <span className="ml-1 text-[10px] text-red-400">*</span>}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => { setEditingIdx(i); setDraft({ ...f }) }}
                  className="text-slate-500 hover:text-white text-xs p-1 transition-colors">✏️</button>
                <button aria-label={`Remove field ${f.label || f.key || i + 1}`} onClick={() => removeField(i)}
                  className="text-slate-500 hover:text-red-400 text-xs p-1 transition-colors">✕</button>
              </div>
            </div>
          )}
        </div>
      ))}

      <button onClick={addField}
        className="w-full bg-[#6C5CE7]/10 hover:bg-[#6C5CE7]/20 border border-[#6C5CE7]/30 hover:border-[#6C5CE7]/60 text-[#6C5CE7] text-sm py-2.5 rounded-xl transition-colors font-medium">
        + Add field
      </button>

      {fields.length === 0 && (
        <p className="text-[11px] text-slate-500 text-center">Add fields to define what users will fill in. Each field becomes part of the AI's input.</p>
      )}
    </div>
  )
}

// ─── Local tool builder ───────────────────────────────────────────────────────
function LocalToolBuilder({ tools, onChange }) {
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState('search')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [config, setConfig] = useState({})
  const inCls = 'w-full bg-[#0F1225] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  function addTool() {
    if (!name.trim() || !description.trim()) return
    onChange([...tools, { type, name: name.trim(), description: description.trim(), config,
      input_schema: TOOL_DEFAULT_SCHEMAS[type] || { type: 'object', properties: {}, required: [] } }])
    setName(''); setDescription(''); setConfig({}); setType('search'); setShowForm(false)
  }

  function removeTool(i) { onChange(tools.filter((_, idx) => idx !== i)) }

  return (
    <div className="space-y-3">
      {tools.map((t, i) => {
        const td = TOOL_TYPES.find(x => x.id === t.type)
        return (
          <div key={i} className="bg-[#1F2444] border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-xl shrink-0">{td?.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-mono">{t.name}</p>
              <p className="text-xs text-slate-400 truncate">{t.description}</p>
            </div>
            <button aria-label={`Remove tool ${t.name}`} onClick={() => removeTool(i)} className="text-slate-500 hover:text-red-400 text-sm transition-colors shrink-0">✕</button>
          </div>
        )
      })}

      {showForm ? (
        <div className="bg-[#1F2444] border border-[#6C5CE7]/30 rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {TOOL_TYPES.map(t => (
              <button key={t.id} onClick={() => setType(t.id)}
                className={`p-2 rounded-xl border text-center transition-all ${type === t.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10' : 'border-white/5 bg-[#171B33] hover:border-white/20'}`}>
                <div className="text-lg mb-0.5">{t.icon}</div>
                <p className="text-[10px] text-slate-400 leading-tight">{t.label}</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Function name</label>
              <input className={inCls} placeholder="e.g. search_web"
                value={name} onChange={e => setName(e.target.value.replace(/\s/g, '_').toLowerCase())} />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Description</label>
              <input className={inCls} placeholder="When the AI should use this"
                value={description} onChange={e => setDescription(e.target.value)} />
            </div>
          </div>
          {type === 'http' && (
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Endpoint URL</label>
              <input className={inCls} placeholder="https://api.example.com/endpoint"
                value={config.url || ''} onChange={e => setConfig(c => ({ ...c, url: e.target.value }))} />
            </div>
          )}
          {type === 'app' && (
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Target App ID</label>
              <input className={inCls} placeholder="UUID of the app to call"
                value={config.app_id || ''} onChange={e => setConfig(c => ({ ...c, app_id: e.target.value }))} />
            </div>
          )}
          {type === 'email' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">From address</label>
                <input className={inCls} placeholder="noreply@yourdomain.com"
                  value={config.from || ''} onChange={e => setConfig(c => ({ ...c, from: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">SMTP / SendGrid key</label>
                <input className={inCls} placeholder="API key or smtp://..." type="password"
                  value={config.api_key || ''} onChange={e => setConfig(c => ({ ...c, api_key: e.target.value }))} />
              </div>
            </div>
          )}
          {(type === 'pdf' || type === 'ocr') && (
            <p className="text-[10px] text-slate-500 bg-[#171B33] rounded-xl px-3 py-2">
              {type === 'pdf' ? '📄 Extracts text content from uploaded PDF files.' : '🖼️ Converts uploaded images to text using OCR.'}
              {' '}Attach a file upload field to your form to enable this.
            </p>
          )}
          {type === 'calendar' && (
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Calendar API key / OAuth</label>
              <input className={inCls} placeholder="Google Calendar API key"
                value={config.api_key || ''} onChange={e => setConfig(c => ({ ...c, api_key: e.target.value }))} />
            </div>
          )}
          {type === 'storage' && (
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Storage bucket (Supabase)</label>
              <input className={inCls} placeholder="my-bucket"
                value={config.bucket || ''} onChange={e => setConfig(c => ({ ...c, bucket: e.target.value }))} />
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={addTool} disabled={!name.trim() || !description.trim()}
              className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-4 py-1.5 rounded-lg font-medium transition-colors">
              Add tool
            </button>
            <button onClick={() => { setShowForm(false); setName(''); setDescription('') }}
              className="bg-[#171B33] hover:bg-[#272C52] text-slate-300 text-sm px-3 py-1.5 rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)}
          className="w-full bg-[#6C5CE7]/10 hover:bg-[#6C5CE7]/20 border border-[#6C5CE7]/30 hover:border-[#6C5CE7]/60 text-[#6C5CE7] text-sm py-2.5 rounded-xl transition-colors font-medium">
          + Add tool
        </button>
      )}

      {tools.length === 0 && !showForm && (
        <p className="text-[11px] text-slate-500 text-center">Optional — tools let the AI search the web, call APIs, run calculations, and more.</p>
      )}
    </div>
  )
}

// ─── Quality Score ────────────────────────────────────────────────────────────
function QualityScore({ form, appType, formSchema }) {
  const isNative = appType === 'native'
  const checks = [
    { label: 'App name',        pass: form.name.trim().length > 2,                     fix: 'Add a clear name' },
    { label: 'Description',     pass: form.description.trim().length > 15,             fix: 'Add a short description' },
    { label: 'System prompt',   pass: form.system_prompt.trim().length > 80,           fix: 'Write a detailed prompt (80+ chars)' },
    { label: 'Example input',   pass: (form.sample_input || '').trim().length > 0,    fix: 'Add a sample input so users know what to enter' },
    { label: 'Tags',            pass: form.tags.trim().length > 0,                     fix: 'Add tags for discoverability' },
    ...(isNative ? [{ label: 'Form fields', pass: formSchema.length > 0, fix: 'Add at least one form field' }] : []),
  ]
  const passed = checks.filter(c => c.pass).length
  const pct    = Math.round((passed / checks.length) * 100)
  const color  = pct >= 80 ? '#00B894' : pct >= 50 ? '#FDCB6E' : '#E17055'
  const label  = pct >= 80 ? 'Great' : pct >= 50 ? 'Good' : 'Needs work'

  return (
    <div className="rounded-xl border border-white/5 bg-[#0F1225] px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">App quality</p>
        <span className="text-xs font-bold" style={{ color }}>{pct}% · {label}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-1.5">
            <span className="text-[10px]" style={{ color: c.pass ? '#00B894' : '#E17055' }}>{c.pass ? '✓' : '○'}</span>
            <span className={`text-[10px] ${c.pass ? 'text-slate-400' : 'text-slate-500'}`}>{c.pass ? c.label : c.fix}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────
// `withGuide`: start on the type guide ("Start building →" moves on to
// step 1), so creating an app stays in this one popup.
export default function CreateAppModal({ user, onClose, onBack, onCreated, onUpdated, existingApp, initialType = 'prompt', websitePrefilled, withGuide = false, embedded = false }) {
  const modalRef = useRef(null)
  useFocusTrap(modalRef, { onEscape: onClose })
  const toast = useToast()
  const isEdit = !!existingApp
  const [appType] = useState(existingApp?.app_type || initialType)
  const [domains, setDomains] = useState([])
  const [form, setForm] = useState({
    name: existingApp?.name || websitePrefilled?.name || '',
    emoji: existingApp?.emoji || websitePrefilled?.emoji || defaultForType(initialType, 'emoji', '🤖'),
    description: existingApp?.description || websitePrefilled?.description || defaultForType(initialType, 'description'),
    system_prompt: existingApp?.system_prompt || websitePrefilled?.system_prompt || defaultForType(initialType, 'system_prompt'),
    ai_provider: existingApp?.ai_provider || 'claude',
    ai_model: existingApp?.ai_model || 'claude-sonnet-5-5',
    tags: existingApp?.tags?.join(', ') || websitePrefilled?.tags || defaultForType(initialType, 'tags'),
    input_placeholder: existingApp?.input_placeholder || websitePrefilled?.input_placeholder || defaultForType(initialType, 'placeholder'),
    webhook_url: existingApp?.webhook_url || '',
    domain_id: existingApp?.domain_id || null,
    required_context: existingApp?.required_context || [],
    compose_hint: existingApp?.compose_hint || '',
    output_type: existingApp?.output_type || defaultForType(initialType, 'output_type', 'markdown'),
    visibility: existingApp?.visibility || 'public',
    is_paid: existingApp?.is_paid || false,
    price_per_run: existingApp?.price_per_run || 0,
    has_memory: existingApp?.has_memory || initialType === 'chatbot',
    custom_model_url: existingApp?.custom_model_url || '',
    custom_model_name: existingApp?.custom_model_name || '',
    sample_input: existingApp?.sample_input || '',
    greeting: existingApp?.greeting || '',
    tone: existingApp?.tone || '',
  })
  const [formSchema, setFormSchema] = useState(existingApp?.form_schema || [])
  const [outputFields, setOutputFields] = useState([])
  const [existingBlueprint, setExistingBlueprint] = useState(null)
  const [pendingTools, setPendingTools] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState(websitePrefilled ? 2 : 1)
  const [intro, setIntro] = useState(withGuide && !existingApp && !websitePrefilled)
  const [showPreview, setShowPreview] = useState(false)
  const [previewInput, setPreviewInput] = useState('')
  const [previewResult, setPreviewResult] = useState('')
  const [previewRunning, setPreviewRunning] = useState(false)
  const [, startTransition] = useTransition()

  const isNative  = appType === 'native'
  const isApi     = appType === 'api'
  const isData    = appType === 'data'
  const isWebsite = appType === 'website'
  const isStructured = appType === 'structured'
  const isChatbot = appType === 'chatbot'
  const hasOutputSchema = isStructured || isApi
  const [generating, setGenerating] = useState(false)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [websiteScraping, setWebsiteScraping] = useState(false)
  // If the caller passed prefilled website data, skip the URL step
  const [websiteScraped, setWebsiteScraped] = useState(!!websitePrefilled)
  const [websiteSource, setWebsiteSource] = useState(null)   // { url, text } read on this form's URL step

  async function scrapeWebsite() {
    const url = normaliseUrl(websiteUrl)
    if (!url) return
    setWebsiteScraping(true); setError('')
    try {
      const page = await readUrl(url, { maxChars: 20000 })
      if (page.text.split(/\s+/).filter(Boolean).length < 80) {
        throw new Error('That page has very little readable text. Try its About, Services, Pricing or Docs page.')
      }
      const parsed = await generateJSON(`You are an AI app generator. You have been given real text read from a business or service website.

Based on this content, generate a complete AI assistant app that helps users of this business.

Return ONLY valid JSON with these fields:
{
  "name": "short app name, e.g. 'Acme Support Assistant'",
  "emoji": "one relevant emoji",
  "description": "one sentence describing what this app does for users",
  "system_prompt": "a detailed system prompt (300+ chars) for an assistant representing this business — business name, what they offer, tone, common questions, and what to say when the answer isn't in the site content",
  "tags": "comma-separated tags, e.g. 'support, retail, customer service'",
  "input_placeholder": "a helpful prompt placeholder, e.g. 'Ask about our products, hours, or services…'"
}`, `Text read from ${page.url}:\n\n${page.text.slice(0, 12000)}`)
      if (!parsed?.name || !parsed?.system_prompt) throw new Error('The AI response was missing the app name or instructions. Try again.')
      set('name', parsed.name)
      if (parsed.emoji)             set('emoji', parsed.emoji)
      if (parsed.description)       set('description', parsed.description)
      set('system_prompt', parsed.system_prompt)
      if (parsed.tags)              set('tags', Array.isArray(parsed.tags) ? parsed.tags.join(', ') : parsed.tags)
      if (parsed.input_placeholder) set('input_placeholder', parsed.input_placeholder)
      setWebsiteSource({ url: page.url, text: page.text })
      setWebsiteScraped(true)
      setStep(2)
    } catch (e) {
      setError(`Could not build an app from that URL: ${e.message}`)
    } finally {
      setWebsiteScraping(false)
    }
  }

  async function aiGenerateDetails() {
    if (!form.system_prompt.trim()) { setError('Add a system prompt first so AI knows what to generate.'); return }
    setGenerating(true); setError('')
    try {
      const parsed = await generateJSON(
        'Given this AI app system prompt, generate a concise app name, a one-sentence description, a single relevant emoji, and 3-4 relevant tags. Return ONLY valid JSON: {"name":"...","description":"...","emoji":"...","tags":"tag1, tag2, tag3"}',
        form.system_prompt, { model: 'claude-haiku-5-5' })
      if (parsed.name) set('name', parsed.name)
      if (parsed.description) set('description', parsed.description)
      if (parsed.emoji) set('emoji', parsed.emoji)
      if (parsed.tags) set('tags', Array.isArray(parsed.tags) ? parsed.tags.join(', ') : parsed.tags)
    } catch (e) {
      setError(`Could not generate details: ${e.message}`)
    } finally {
      setGenerating(false)
    }
  }

  const STEPS = isEdit ? 2 : (isNative || isApi || isWebsite ? 4 : 3)

  useEffect(() => {
    supabase.from('domains').select('id, name, emoji, color').order('order_index')
      .then(({ data }) => { if (data) startTransition(() => setDomains(data)) })
  }, [])

  // Editing: load the saved contract so output fields round-trip (and so we
  // merge into, rather than overwrite, anything Blueprint Studio added).
  useEffect(() => {
    if (!existingApp?.id) return
    supabase.from('app_blueprints').select('blueprint').eq('app_id', existingApp.id).maybeSingle()
      .then(({ data }) => {
        const bp = data?.blueprint || {}
        setExistingBlueprint(bp)
        setOutputFields(getOutputSchemaFields(bp).map(f => ({ ...f })))
      })
  }, [existingApp?.id])

  async function saveBlueprint(appId) {
    const inputFields = (isNative || isApi) ? formSchemaToInputFields(formSchema) : []
    if (!outputFields.length && !inputFields.length && !existingBlueprint) return null
    let base = existingBlueprint
    if (!base) {
      const { data } = await supabase.from('app_blueprints').select('blueprint').eq('app_id', appId).maybeSingle()
      base = data?.blueprint || {}
    }
    const blueprint = { ...base }
    if (inputFields.length) blueprint.input_schema = { type: 'object', fields: inputFields }
    if (hasOutputSchema) {
      if (outputFields.length) {
        blueprint.output_schema = { type: 'object', fields: outputFields }
        blueprint.output_contract = { ...(base.output_contract || {}), format: 'json', fields: outputFields }
      } else {
        delete blueprint.output_schema
        if (blueprint.output_contract) blueprint.output_contract = { ...blueprint.output_contract, fields: [] }
      }
    }
    const { error } = await supabase.from('app_blueprints').upsert({
      app_id: appId, user_id: user.id, blueprint, updated_at: new Date().toISOString(),
    }, { onConflict: 'app_id' })
    return error
  }

  function set(key, val) {
    setForm(prev => {
      const next = { ...prev, [key]: val }
      if (key === 'ai_provider') next.ai_model = MODELS[val][0].id
      return next
    })
  }

  async function handleSave() {
    if (!form.name.trim() || !form.system_prompt.trim()) {
      setError('App name and system prompt are required.')
      return
    }
    if (isNative && formSchema.length === 0) {
      setError('Add at least one input field for a Native App.')
      return
    }
    if (isStructured && outputFields.length === 0) {
      setError('Add at least one output field — it defines the JSON every response must match.')
      return
    }
    const fieldsError = hasOutputSchema ? outputFieldsErrors(outputFields) : ''
    if (fieldsError) { setError(fieldsError); return }
    setSaving(true); setError('')

    const tags = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : []
    const payload = {
      name: form.name.trim(), emoji: form.emoji,
      description: form.description.trim(), system_prompt: form.system_prompt.trim(),
      ai_provider: form.ai_provider, ai_model: form.ai_model, tags,
      input_placeholder: form.input_placeholder.trim() || null,
      domain_id: form.domain_id || null, required_context: form.required_context,
      compose_hint: form.compose_hint.trim() || null,
      app_type: appType,
      form_schema: isNative ? formSchema : [],
      output_type: isStructured ? 'json' : form.output_type,
      visibility: form.visibility || 'public',
      is_paid: form.is_paid || false,
      price_per_run: form.is_paid ? Number(form.price_per_run) : 0,
      webhook_url: form.webhook_url?.trim() || null,
      has_memory: isChatbot || form.has_memory || false,
      ...(isChatbot ? { greeting: form.greeting.trim() || null, tone: form.tone || null } : {}),
      custom_model_url: form.custom_model_url?.trim() || null,
      custom_model_name: form.custom_model_name?.trim() || null,
      sample_input: form.sample_input?.trim() || null,
    }

    if (isEdit) {
      const { error: versionErr } = await supabase.from('app_versions').insert({
        app_id: existingApp.id, user_id: user.id,
        version_data: {
          name: existingApp.name, emoji: existingApp.emoji,
          description: existingApp.description, system_prompt: existingApp.system_prompt,
          ai_provider: existingApp.ai_provider, ai_model: existingApp.ai_model,
          tags: existingApp.tags, input_placeholder: existingApp.input_placeholder,
          domain_id: existingApp.domain_id, output_type: existingApp.output_type,
          sample_input: existingApp.sample_input,
        },
      })
      // Non-fatal — the edit itself still proceeds, but flag the gap in version history.
      if (versionErr) toast(`Couldn't snapshot the previous version: ${versionErr.message}`, 'error')
      const { data, error: err } = await supabase.from('apps').update(payload)
        .eq('id', existingApp.id).select('*, domains(name, emoji, color, slug)').single()
      if (err) { setSaving(false); setError(err.message); return }
      const bpErr = await saveBlueprint(existingApp.id)
      setSaving(false)
      if (bpErr) toast(`Saved, but the input/output contract wasn't: ${bpErr.message}`, 'error', 8000)
      onUpdated?.(data)
    } else {
      const { data, error: err } = await supabase.from('apps')
        .insert({ ...payload, is_published: true, created_by: user.id, workflow_order: 999, total_runs: 0 })
        .select('*, domains(name, emoji, color, slug)').single()
      if (err) { setSaving(false); setError(err.message); return }
      const bpErr = await saveBlueprint(data.id)
      setSaving(false)
      if (bpErr) toast(`"${data.name}" saved, but its input/output contract wasn't: ${bpErr.message}`, 'error', 8000)
      if (pendingTools.length > 0) {
        const { error: toolsErr } = await supabase.from('app_tools').insert(pendingTools.map(t => ({ ...t, app_id: data.id })))
        // The app itself saved fine — surface this via toast (not setError,
        // which the modal is about to unmount) so it isn't lost silently.
        if (toolsErr) toast(`"${data.name}" saved, but its tools weren't: ${toolsErr.message}`, 'error', 6000)
      }
      const source = websitePrefilled?.source_text
        ? { url: websitePrefilled.source_url, text: websitePrefilled.source_text }
        : websiteSource
      if (isWebsite && source?.text) {
        const { error: kbErr } = await supabase.from('app_knowledge').insert({
          app_id: data.id,
          title: source.url ? `Website source: ${source.url}` : 'Website source',
          content: source.text.slice(0, 20000),
          source_url: source.url || null,
          type: 'url',
        })
        if (kbErr) toast(`"${data.name}" saved, but website source wasn't attached: ${kbErr.message}`, 'error', 6000)
      }
      onCreated?.(data)
    }
    onClose()
  }

  function nextStep() {
    if (step === infoStep && !form.name.trim()) { setError('App name is required.'); return }
    if (step === promptStep && !form.system_prompt.trim()) { setError('System prompt is required.'); return }
    setError(''); setStep(s => s + 1)
  }

  async function runPreview() {
    if (!previewInput.trim() || !form.system_prompt.trim()) return
    setPreviewRunning(true); setPreviewResult('')
    try {
      await streamRun({
        input: previewInput,
        system_prompt: form.system_prompt,
        ai_provider: form.ai_provider,
        ai_model: form.ai_model,
        output_type: isStructured ? 'json' : form.output_type,
        run_mode: isChatbot ? 'conversation' : undefined,
      }, { onToken: setPreviewResult })
    } catch (e) {
      setPreviewResult(`Error: ${e.message}`)
    } finally {
      setPreviewRunning(false)
    }
  }


  // For website type steps are offset by 1: 1=URL, 2=Info, 3=Prompt, 4=Tools
  const infoStep   = isWebsite ? 2 : 1
  const promptStep = isWebsite ? 3 : 2

  const inputCls = 'w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors'
  const typeLabel = isNative ? 'Form App' : isApi ? 'API App' : isData ? 'Data App' : isWebsite ? 'From Website' : isStructured ? 'Structured Output App' : isChatbot ? 'Chatbot App' : appType === 'batch' ? 'Batch Processor' : appType === 'agent' ? 'Agent' : appType === 'iframe' ? 'Iframe App' : 'Prompt App'
  const typeColor = isNative ? '#00B894' : isApi || isStructured ? '#0984E3' : isData ? '#E17055' : isWebsite ? '#00B894' : isChatbot ? '#E84393' : appType === 'batch' ? '#6C5CE7' : appType === 'agent' ? '#FDCB6E' : appType === 'iframe' ? '#E84393' : '#6C5CE7'

  const stepLabels = isWebsite
    ? (websiteScraped ? ['Website', 'Info', 'AI & Prompt', 'Tools'] : ['Website'])
    : isNative || isApi
      ? ['Info', 'AI & Prompt', isApi ? 'Parameters' : 'Form Fields', 'Tools']
      : ['Info', 'AI & Prompt', 'Tools']

  const content = (
    <>
        {/* Header */}
        <div className="px-6 pt-6 pb-5 shrink-0 border-b border-white/5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-bold shrink-0"
                style={{ background: typeColor + '22', color: typeColor }}>
                {isNative ? '⊞' : isApi || isStructured ? '{}' : isData ? '▦' : isWebsite ? '🌐' : isChatbot ? '💬' : appType === 'batch' ? '⊞' : appType === 'agent' ? '◈' : appType === 'iframe' ? '⬡' : '✦'}
              </div>
              <div>
                <p className="text-white font-bold text-xl leading-snug">{isEdit ? `Edit — ${typeLabel}` : `New ${typeLabel}`}</p>
                <p className="text-slate-400 text-sm mt-0.5">{intro ? 'Overview' : `Step ${step} of ${STEPS} — ${stepLabels[step - 1]}`}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-4 shrink-0">
              {!intro && form.system_prompt.trim() && (
                <button onClick={() => { setShowPreview(v => { if (!v && form.sample_input.trim()) setPreviewInput(form.sample_input); return !v }); setPreviewResult('') }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${showPreview ? 'bg-green-500/20 text-green-400' : 'bg-[#1F2444] text-slate-400 hover:text-white'}`}>
                  {showPreview ? '✕ Test' : '▶ Test'}
                </button>
              )}
              {(() => {
                // Back from step 1 returns to the guide when it's part of this popup
                const back = existingApp ? null : intro ? onBack : step === 1 ? (withGuide ? () => setIntro(true) : onBack) : null
                return (
                  <button aria-label={back ? 'Back' : 'Close'} onClick={back || onClose} className="text-slate-500 hover:text-white transition-colors p-1">
                    {back ? '← Back' : '✕'}
                  </button>
                )
              })()}
            </div>
          </div>
        </div>

        {/* Embedded in the type picker: steps sit in a centred column */}
        <div className={embedded ? 'flex-1 min-h-0 w-full max-w-2xl mx-auto flex flex-col' : 'contents'}>
        {intro ? (
          <TypeGuideSteps type={appType} onBack={onBack || onClose} onContinue={() => setIntro(false)} />
        ) : (<>
        {/* Inline Preview Panel */}
        {showPreview && (
          <div className="border-b border-white/5 bg-[#0F1225] p-4 space-y-3">
            <p className="text-[10px] text-slate-500 uppercase font-medium">Test as end user — using current prompt</p>
            <div className="flex gap-2">
              <input
                className="flex-1 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500 transition-colors"
                placeholder="Type a test input..."
                value={previewInput}
                onChange={e => setPreviewInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runPreview()}
              />
              <button onClick={runPreview} disabled={previewRunning || !previewInput.trim()}
                className="bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm px-4 py-2 rounded-xl font-medium transition-colors whitespace-nowrap">
                {previewRunning ? '⟳ Running...' : '▶ Run'}
              </button>
            </div>
            {previewResult && (
              <div className="bg-[#171B33] border border-white/5 rounded-xl p-3 text-xs text-slate-300 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {previewResult}
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Website URL step — only for website type, shown before normal step 1 */}
          {isWebsite && !websiteScraped && (
            <div className="space-y-5">
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-2xl bg-[#00B894]/15 flex items-center justify-center text-3xl mx-auto mb-4">🌐</div>
                <p className="text-white font-semibold text-base mb-1">Create from a website</p>
                <p className="text-slate-400 text-sm leading-relaxed max-w-sm mx-auto">Enter the URL of any business, service, or knowledge base. We'll read the site and generate a ready-to-run AI assistant in seconds.</p>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Website URL</label>
                <div className="flex gap-2">
                  <input
                    className={inputCls + ' flex-1'}
                    placeholder="https://example.com"
                    value={websiteUrl}
                    onChange={e => setWebsiteUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !websiteScraping && websiteUrl.trim() && scrapeWebsite()}
                    type="url"
                    autoFocus
                  />
                  <button
                    onClick={scrapeWebsite}
                    disabled={websiteScraping || !websiteUrl.trim()}
                    className="bg-[#00B894] hover:bg-[#00C9A7] disabled:opacity-40 text-white text-sm px-4 py-2 rounded-xl font-medium transition-colors whitespace-nowrap shrink-0"
                  >
                    {websiteScraping ? '⟳ Analysing…' : '✦ Generate'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-600 mt-2">Works great for small business sites, product pages, docs, and service listings.</p>
              </div>
              {websiteScraping && (
                <div className="bg-[#0F1225] border border-white/5 rounded-xl p-4 text-center">
                  <div className="text-2xl mb-2 animate-pulse">🌐</div>
                  <p className="text-slate-400 text-sm">Reading the site and generating your app…</p>
                  <p className="text-slate-600 text-xs mt-1">This takes about 10–15 seconds</p>
                </div>
              )}
              <div className="border-t border-white/5 pt-4">
                <p className="text-[11px] text-slate-600 mb-2">Or build manually instead:</p>
                <button
                  onClick={() => { setWebsiteScraped(true); setStep(2) }}
                  className="text-xs text-slate-400 hover:text-white underline transition-colors"
                >
                  Skip and fill in details yourself →
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Info */}
          {step === infoStep && (
            <>
              <div>
                <label className="text-xs text-slate-400 block mb-2">Pick an emoji</label>
                <div className="flex flex-wrap gap-2">
                  {EMOJI_OPTIONS.map(e => (
                    <button key={e} onClick={() => set('emoji', e)}
                      className={`w-9 h-9 rounded-lg text-xl transition-all ${form.emoji === e ? 'ring-2 ring-[#6C5CE7]' : 'bg-[#1F2444] hover:bg-[#272C52]'}`}
                      style={form.emoji === e ? { background: typeColor + '33' } : {}}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-400">App Name <span className="text-red-400">*</span></label>
                  {step === promptStep && form.system_prompt.trim() && (
                    <button type="button" onClick={aiGenerateDetails} disabled={generating}
                      className="text-[10px] text-[#6C5CE7] hover:text-white bg-[#6C5CE7]/10 hover:bg-[#6C5CE7] px-2 py-0.5 rounded-lg transition-colors disabled:opacity-40">
                      {generating ? '⟳ Generating...' : '✦ AI Generate'}
                    </button>
                  )}
                </div>
                <input className={inputCls} placeholder={isNative ? 'e.g. Job Application Builder' : 'e.g. Market Research Assistant'}
                  value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Short Description</label>
                <input className={inputCls} placeholder="What does this app do?"
                  value={form.description} onChange={e => set('description', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-2">Category</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => set('domain_id', null)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${!form.domain_id ? 'text-white' : 'bg-[#1F2444] text-slate-400 hover:text-white'}`}
                    style={!form.domain_id ? { background: typeColor } : {}}>
                    No category
                  </button>
                  {domains.map(d => (
                    <button key={d.id} onClick={() => set('domain_id', d.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${form.domain_id === d.id ? 'text-white' : 'bg-[#1F2444] text-slate-400 hover:text-white'}`}
                      style={form.domain_id === d.id ? { background: typeColor } : {}}>
                      {d.emoji} {d.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Tags <span className="text-slate-600">(comma separated)</span></label>
                <input className={inputCls} placeholder="e.g. Research, Analytics"
                  value={form.tags} onChange={e => set('tags', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Visibility</label>
                  <select className={inputCls} value={form.visibility} onChange={e => set('visibility', e.target.value)}>
                    <option value="public">🌐 Public</option>
                    <option value="private">🔒 Private</option>
                    <option value="invite">✉️ Invite only</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Pricing</label>
                  <div className="flex gap-2">
                    <select className="flex-1 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7] transition-colors"
                      value={form.is_paid ? 'paid' : 'free'} onChange={e => set('is_paid', e.target.value === 'paid')}>
                      <option value="free">Free</option>
                      <option value="paid">Paid per run</option>
                    </select>
                    {form.is_paid && (
                      <input type="number" min="0" step="0.01"
                        className="w-20 bg-[#1F2444] border border-white/10 rounded-xl px-2 text-sm text-white focus:outline-none focus:border-[#6C5CE7] transition-colors"
                        placeholder="0.10" value={form.price_per_run} onChange={e => set('price_per_run', e.target.value)} />
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Step: AI & Prompt */}
          {step === promptStep && (
            <>
              {/* Inline test panel — shown once a prompt exists */}
              {form.system_prompt.trim() && !showPreview && (
                <div className="bg-green-500/8 border border-green-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
                  <p className="text-xs text-green-400">Your prompt is ready to test as an end user.</p>
                  <button onClick={() => { setShowPreview(true); setPreviewResult('') }}
                    className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap">
                    ▶ Test it
                  </button>
                </div>
              )}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">System Prompt <span className="text-red-400">*</span></label>
                {isNative && (
                  <p className="text-[11px] text-slate-500 mb-2">
                    The form fields you define in the next step will be combined and sent to the AI automatically. Use <code className="text-[#6C5CE7] bg-[#1F2444] px-1 rounded">{"{{Field Name}}"}</code> to reference specific fields.
                  </p>
                )}
              {isChatbot && (
                <p className="text-[11px] text-slate-500 mb-2">
                  Define the chatbot persona, boundaries, greeting style, and when it should ask a follow-up question. Memory is enabled by default for this app type.
                </p>
              )}
                <textarea className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors leading-relaxed"
                  rows={6} value={form.system_prompt} onChange={e => set('system_prompt', e.target.value)}
                  placeholder={isChatbot
                    ? `You are Nova, a warm customer support chatbot for Acme. Greet users briefly, answer from the product context, ask one clarifying question when needed, and hand off when the request needs a human.`
                    : isNative
                    ? `You are an expert assistant. The user will provide structured information via a form. Use all provided fields to generate a comprehensive, tailored response.`
                    : `You are a helpful assistant. Be specific, accurate, and actionable in your responses.`} />
              </div>
              {isChatbot && (
                <>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Greeting message <span className="text-slate-600">(first message users see)</span></label>
                    <textarea className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors leading-relaxed"
                      rows={2} maxLength={1000} value={form.greeting} onChange={e => set('greeting', e.target.value)}
                      placeholder="Hi! I'm Nova from Acme. Ask me about orders, returns or our products." />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Tone</label>
                    <select className={inputCls} value={form.tone} onChange={e => set('tone', e.target.value)}>
                      <option value="">Follow the system prompt</option>
                      <option value="friendly">Friendly</option>
                      <option value="professional">Professional</option>
                      <option value="concise">Concise</option>
                      <option value="playful">Playful</option>
                      <option value="empathetic">Empathetic</option>
                    </select>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">AI Provider</label>
                  <select className={inputCls} value={form.ai_provider} onChange={e => set('ai_provider', e.target.value)}>
                    <option value="claude">🟣 Claude</option>
                    <option value="openai">🟢 GPT</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Model</label>
                  <select className={inputCls} value={form.ai_model} onChange={e => set('ai_model', e.target.value)}>
                    {MODELS[form.ai_provider].map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              {hasOutputSchema && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Output fields {isApi && <span className="text-slate-600">(optional — makes responses validated JSON)</span>}
                  </label>
                  <p className="text-[10px] text-slate-500 mb-2 leading-relaxed">
                    Every response is checked against these fields. If the model gets it wrong, Aistrix asks it to fix the
                    response once; if it still fails, the caller gets a clear contract error instead of bad data.
                  </p>
                  <OutputSchemaEditor fields={outputFields} onChange={setOutputFields} accent={typeColor} />
                </div>
              )}

              {!isStructured && <div>
                <label className="text-xs text-slate-400 block mb-2">Output format</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'markdown', icon: '¶',   label: 'Markdown',  desc: 'Prose, lists, headings' },
                    { id: 'table',    icon: '⊟',   label: 'Table',     desc: 'Rows and columns' },
                    { id: 'cards',    icon: '⊞',   label: 'Cards',     desc: 'Item cards grid' },
                    { id: 'key_value',icon: '≡',   label: 'Key-Value', desc: 'Field: value pairs' },
                    { id: 'json',     icon: '{ }', label: 'JSON',      desc: 'Structured data' },
                    { id: 'chart',    icon: '▦',   label: 'Chart',     desc: 'Bar or line chart' },
                  ].map(o => (
                    <button key={o.id} type="button" onClick={() => set('output_type', o.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${form.output_type === o.id ? 'border-[#6C5CE7] text-white' : 'border-white/5 bg-[#1F2444] text-slate-400 hover:border-white/20'}`}
                      style={form.output_type === o.id ? { background: typeColor + '18', borderColor: typeColor + '60' } : {}}>
                      <span className="font-mono text-sm block mb-0.5" style={form.output_type === o.id ? { color: typeColor } : {}}>{o.icon}</span>
                      <p className="text-[11px] font-medium">{o.label}</p>
                      <p className="text-[10px] text-slate-600">{o.desc}</p>
                    </button>
                  ))}
                </div>
              </div>}

              {/* Memory toggle */}
              <div className="flex items-center justify-between bg-[#1F2444] border border-white/10 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm text-white font-medium">Conversation Memory</p>
                  <p className="text-xs text-slate-400 mt-0.5">{isChatbot ? 'Required for chatbot-style back-and-forth conversations' : 'AI remembers previous messages in the same session'}</p>
                </div>
                <button type="button" onClick={() => !isChatbot && set('has_memory', !form.has_memory)}
                  disabled={isChatbot}
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${form.has_memory ? 'bg-[#6C5CE7]' : 'bg-[#0F1225]'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.has_memory ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {/* Custom model */}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Custom model endpoint <span className="text-slate-600">(optional — OpenAI-compatible)</span></label>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputCls} placeholder="https://api.together.xyz/v1"
                    value={form.custom_model_url} onChange={e => set('custom_model_url', e.target.value)} />
                  <input className={inputCls} placeholder="meta-llama/Llama-3-70b"
                    value={form.custom_model_name} onChange={e => set('custom_model_name', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1.5">
                  Sample input <span className="text-slate-600">(shown to users as a placeholder example)</span>
                </label>
                <div className="relative">
                  <input className={inputCls} placeholder={`e.g. ${isNative ? 'Pre-fill form fields for demo' : 'Analyze the Q3 revenue trends for our SaaS product...'}`}
                    value={form.sample_input} onChange={e => set('sample_input', e.target.value)} />
                  {form.sample_input.trim() && !showPreview && (
                    <button
                      onClick={() => { setShowPreview(true); setPreviewInput(form.sample_input); setPreviewResult('') }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] bg-green-600/80 hover:bg-green-500 text-white px-2 py-1 rounded-lg transition-colors">
                      ▶ Test
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Webhook URL <span className="text-slate-600">(optional — receives POST after every run)</span></label>
                <input className={inputCls} placeholder="https://your-server.com/webhook"
                  value={form.webhook_url || ''}
                  onChange={e => set('webhook_url', e.target.value)} />
                {form.webhook_url && (
                  <p className="text-[10px] text-slate-500 mt-1">Aistrix will POST the result to this URL after every run. Payload includes: input, result, provider, timestamp.</p>
                )}
              </div>

              <QualityScore form={form} appType={appType} formSchema={formSchema} />

              {isData && (
                <div className="bg-[#E17055]/10 border border-[#E17055]/20 rounded-xl p-3">
                  <p className="text-xs text-[#E17055] font-medium mb-1">Data App tip</p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Your system prompt should describe what to do with the data. Examples:<br />
                    <span className="text-slate-300">• "Analyze this CSV and identify trends in the data"</span><br />
                    <span className="text-slate-300">• "Extract all dates, names, and amounts from this document"</span><br />
                    <span className="text-slate-300">• "Summarize this research paper in bullet points"</span>
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs text-slate-400 block mb-2">Auto-inject context</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { id: 'career_profile', label: '💼 Career Profile' },
                    { id: 'business_profile', label: '🏢 Business Profile' },
                    { id: 'memory', label: '🧠 AI Memory' },
                  ].map(ctx => {
                    const active = form.required_context.includes(ctx.id)
                    return (
                      <button key={ctx.id} type="button"
                        onClick={() => set('required_context', active ? form.required_context.filter(c => c !== ctx.id) : [...form.required_context, ctx.id])}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${active ? 'border-[#6C5CE7]/40 text-[#6C5CE7]' : 'bg-[#1F2444] border-white/10 text-slate-400 hover:text-white'}`}
                        style={active ? { background: typeColor + '18', borderColor: typeColor + '44', color: typeColor } : {}}>
                        {ctx.label} {active && '✓'}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {/* Step 3 (Native / API): Form Fields / API Parameters */}
          {step === 3 && (isNative || isApi) && (
            <div className="space-y-4">
              <div className="bg-[#1F2444] border border-white/5 rounded-xl p-4">
                {isApi ? (
                  <>
                    <p className="text-sm text-white font-medium mb-1">Define API parameters</p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      These become the parameters of your REST endpoint. Developers will pass them in the request body.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-white font-medium mb-1">Design your input form</p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Add fields for users to fill in. All values are combined and sent to the AI.
                    </p>
                  </>
                )}
              </div>
              <FormBuilder fields={formSchema} onChange={setFormSchema} />
              {isApi && (
                <div className="bg-[#0984E3]/10 border border-[#0984E3]/20 rounded-xl p-3">
                  <p className="text-[10px] text-[#0984E3] leading-relaxed">
                    💡 API Apps always return JSON. The system prompt in the next step will automatically include instructions to return a JSON response matching your parameter structure.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Last step: Tools */}
          {step === STEPS && !isEdit && (
            <div className="space-y-4">
              <div className="bg-[#1F2444] border border-white/5 rounded-xl p-4">
                <p className="text-sm text-white font-medium mb-0.5">Add tools <span className="text-slate-500 font-normal text-xs">— optional</span></p>
                <p className="text-xs text-slate-400">Give the AI real capabilities: web search, API calls, math. Skip and add from Developer Dashboard anytime.</p>
              </div>
              <LocalToolBuilder tools={pendingTools} onChange={setPendingTools} />
            </div>
          )}

          {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">{error}</div>}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-white/5 flex items-center gap-3">
          {/* Step dots */}
          <div className="flex gap-1.5 flex-1">
            {Array.from({ length: STEPS }, (_, i) => (
              <div key={i} className="h-1.5 w-8 rounded-full transition-colors"
                style={{ background: step > i ? typeColor : 'rgba(255,255,255,0.1)' }} />
            ))}
          </div>

          {isWebsite && step === 1 ? null
          : step === infoStep ? (
            <button onClick={nextStep} disabled={!form.name.trim()}
              className="text-white text-sm px-5 py-2 rounded-xl font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: typeColor }}>
              Next →
            </button>
          ) : step < STEPS ? (
            <>
              <button onClick={() => { setError(''); setStep(s => s - 1) }}
                className="bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm px-4 py-2 rounded-xl transition-colors">
                ← Back
              </button>
              <button onClick={nextStep} disabled={step === promptStep && !form.system_prompt.trim()}
                className="text-white text-sm px-5 py-2 rounded-xl font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: typeColor }}>
                Next →
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setError(''); setStep(s => s - 1) }}
                className="bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm px-4 py-2 rounded-xl transition-colors">
                ← Back
              </button>
              <button onClick={handleSave} disabled={saving}
                className="text-white text-sm px-5 py-2 rounded-xl font-medium transition-colors disabled:opacity-40"
                style={{ background: typeColor }}>
                {saving ? 'Creating...' : isEdit ? '✓ Save Changes' : pendingTools.length > 0 ? `✓ Create + ${pendingTools.length} tool${pendingTools.length > 1 ? 's' : ''}` : '✓ Create App'}
              </button>
            </>
          )}
        </div>
        </>)}
        </div>
    </>
  )
  if (embedded) return content
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={isEdit ? `Edit ${typeLabel}` : `New ${typeLabel}`}
        className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-xl flex flex-col" style={{ maxHeight: '92vh' }}>
        {content}
      </div>
    </div>
  )
}
