import { useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

const TYPES = [
  {
    id: 'ai_builder',
    icon: '✦',
    label: 'Build with AI',
    desc: 'Describe your app in plain language. AI asks questions and configures everything.',
    color: '#E84393',
    bestFor: 'First-timers, rapid prototyping, or when you\'re unsure which type to pick.',
    status: 'ready',
  },
  {
    id: 'website',
    icon: '🌐',
    label: 'From Website',
    desc: 'Enter a URL. We\'ll read the site and generate a ready-to-run app for it.',
    color: '#00B894',
    bestFor: 'Small businesses, service pages, product docs, knowledge bases.',
    status: 'ready',
  },
  {
    id: 'native',
    icon: '⊞',
    label: 'Form App',
    desc: 'Design a custom form with typed fields. Feels like real software, not a chatbox.',
    color: '#00B894',
    bestFor: 'Job applications, report generators, structured intake forms.',
    status: 'ready',
  },
  {
    id: 'prompt',
    icon: '✦',
    label: 'Prompt App',
    desc: 'Write a system prompt. Users type input, AI responds. Fastest to build.',
    color: '#A29BFE',
    bestFor: 'Open-ended assistants, chatbots, quick text transformations.',
    status: 'ready',
  },
  {
    id: 'api',
    icon: '{ }',
    label: 'API App',
    desc: 'Define parameters and output schema. Expose as a REST endpoint.',
    color: '#0984E3',
    bestFor: 'Developer integrations, webhook consumers, headless AI endpoints.',
    status: 'ready',
  },
  {
    id: 'data',
    icon: '▦',
    label: 'Data App',
    desc: 'Paste CSV, upload a file, or provide a URL. AI analyzes and transforms it.',
    color: '#E17055',
    bestFor: 'CSV analysis, document extraction, report summarization.',
    status: 'ready',
  },
  {
    id: 'agent',
    icon: '◈',
    label: 'Agent',
    desc: 'Give it a goal. It plans, uses tools, and executes autonomously until done.',
    color: '#FDCB6E',
    bestFor: 'Autonomous tasks: web research, sending emails, multi-step execution.',
    status: 'ready',
  },
  {
    id: 'iframe',
    icon: '⬡',
    label: 'Embeddable Widget',
    desc: 'Build a widget you can drop into any website with one line of code.',
    color: '#E84393',
    bestFor: 'Website widgets, customer support tools, embedded calculators.',
    status: 'ready',
  },
  {
    id: 'vision',
    icon: '👁',
    label: 'Vision / Image',
    desc: 'Upload images and let AI analyse, describe, extract data, or flag issues.',
    color: '#00CEC9',
    bestFor: 'Invoice OCR, product quality checks, diagram analysis, accessibility audits.',
    status: 'soon',
  },
  {
    id: 'structured',
    icon: '{ }',
    label: 'Structured Output',
    desc: 'Always returns valid JSON matching a schema you define. Zero parsing errors.',
    color: '#0984E3',
    bestFor: 'Data extraction, entity recognition, classification, form parsing.',
    status: 'ready',
  },
  {
    id: 'document',
    icon: '📄',
    label: 'Document / PDF',
    desc: 'Upload PDFs or Word docs. Ask questions, extract tables, or summarise sections.',
    color: '#E17055',
    bestFor: 'Contract Q&A, research summaries, policy lookup, report extraction.',
    status: 'soon',
  },
  {
    id: 'batch',
    icon: '⊞',
    label: 'Batch Processor',
    desc: 'Run the same prompt over hundreds of rows at once. Upload a CSV, get results.',
    color: '#6C5CE7',
    bestFor: 'Lead scoring, bulk translation, mass email personalisation, categorisation.',
    status: 'ready',
  },
  {
    id: 'voice',
    icon: '🎙',
    label: 'Voice / Audio',
    desc: 'Upload audio files. Transcribe with Whisper, then summarise or extract insights.',
    color: '#A29BFE',
    bestFor: 'Meeting notes, call summaries, podcast transcripts, lecture highlights.',
    status: 'soon',
  },
  {
    id: 'translation',
    icon: '🌐',
    label: 'Translation',
    desc: 'Translate text or documents across 100+ languages with glossary control.',
    color: '#00B894',
    bestFor: 'Localising products, legal docs, customer support, marketing copy.',
    status: 'preview',
  },
  {
    id: 'code',
    icon: '</> ',
    label: 'Code Gen / Review',
    desc: 'Generate code, review PRs, explain functions, or auto-write tests.',
    color: '#FDCB6E',
    bestFor: 'PR review bots, test generators, documentation writers, snippet assistants.',
    status: 'preview',
  },
  {
    id: 'chatbot',
    icon: '💬',
    label: 'Chatbot with Persona',
    desc: 'A named assistant with a custom personality, greeting, and tone presets.',
    color: '#E84393',
    bestFor: 'Customer support bots, onboarding assistants, product guide chatbots.',
    status: 'ready',
  },
]

const STATUS_META = {
  ready:   { label: 'Ready',       cls: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25' },
  preview: { label: 'Prompt-ready',cls: 'bg-amber-500/12 text-amber-300 border-amber-500/25' },
  soon:    { label: 'Coming soon', cls: 'bg-slate-500/10 text-slate-400 border-white/10' },
}

const TYPE_GROUPS = [
  {
    id: 'no_code',
    short: 'No-Code',
    label: 'No-Code AI Apps',
    desc: 'Build useful AI apps without code: prompts, forms, website-powered assistants, structured outputs, and data tools.',
    typeIds: ['ai_builder', 'prompt', 'native', 'structured', 'data', 'website', 'chatbot'],
  },
  {
    id: 'automation',
    short: 'Automation',
    label: 'Automation Apps',
    desc: 'Create apps that perform repeatable work, run across many inputs, or complete multi-step goals.',
    typeIds: ['agent', 'batch'],
  },
  {
    id: 'developer',
    short: 'Developer',
    label: 'Developer Apps',
    desc: 'Package AI capabilities as APIs, embeddable widgets, or developer-focused code assistants.',
    typeIds: ['api', 'iframe', 'code'],
  },
  {
    id: 'media_file',
    short: 'Media & File',
    label: 'Media & File Apps',
    desc: 'Work with documents, images, voice, translation, and other file-heavy AI use cases.',
    typeIds: ['document', 'vision', 'voice', 'translation'],
  },
]

function findTypeGroup(typeId) {
  return TYPE_GROUPS.find(group => group.typeIds.includes(typeId)) || TYPE_GROUPS[0]
}

// Business-language examples shown as quick-pick chips
const EXAMPLES = [
  { label: 'Qualify my sales leads', type: 'native' },
  { label: 'Screen resumes for a role', type: 'native' },
  { label: 'Draft support replies', type: 'prompt' },
  { label: 'Summarise invoices', type: 'data' },
  { label: 'Write cold outreach emails', type: 'prompt' },
  { label: 'Build an app from my website', type: 'website' },
  { label: 'Analyse a CSV spreadsheet', type: 'batch' },
  { label: 'Create a lead capture form', type: 'native' },
  { label: 'Extract data from a PDF contract', type: 'document' },
  { label: 'Transcribe and summarise meetings', type: 'voice' },
  { label: 'Review and explain code', type: 'code' },
  { label: 'Analyse a product image', type: 'vision' },
  { label: 'Translate my marketing copy', type: 'translation' },
  { label: 'Not sure — help me decide', type: 'ai_builder' },
]

const INTENT_RULES = [
  { words: ['image', 'photo', 'picture', 'vision', 'visual', 'scan', 'ocr', 'screenshot', 'camera', 'detect', 'inspect'], type: 'vision' },
  { words: ['pdf', 'document', 'word', 'docx', 'contract', 'upload doc', 'policy', 'manual', 'file q&a', 'rag'], type: 'document' },
  { words: ['batch', 'bulk', 'mass', 'rows', 'many inputs', 'process multiple', 'hundred', 'thousands'], type: 'batch' },
  { words: ['audio', 'voice', 'transcribe', 'recording', 'meeting', 'call', 'podcast', 'whisper', 'speech'], type: 'voice' },
  { words: ['translat', 'language', 'localiz', 'localis', 'multilingual', 'chinese', 'spanish', 'french', 'german'], type: 'translation' },
  { words: ['code', 'function', 'pull request', 'pr review', 'test', 'bug', 'debug', 'snippet', 'script', 'refactor'], type: 'code' },
  { words: ['always return json', 'json schema', 'structured output', 'extract fields', 'entity extract', 'classification schema'], type: 'structured' },
  { words: ['persona', 'chatbot', 'support bot', 'customer chat', 'greet', 'onboarding bot'], type: 'chatbot' },
  { words: ['website', 'site', 'url', 'page', 'landing', 'web page'], type: 'website' },
  { words: ['form', 'structured', 'fields', 'intake', 'capture', 'survey'], type: 'native' },
  { words: ['chain', 'pipeline', 'workflow', 'sequence', 'multi-step', 'steps', 'qualify', 'screen', 'triage', 'outreach'], type: 'agent' },
  { words: ['api', 'endpoint', 'webhook', 'rest', 'developer', 'headless'], type: 'api' },
  { words: ['agent', 'browse', 'autonomous', 'web search', 'action', 'research'], type: 'agent' },
  { words: ['csv', 'data', 'spreadsheet', 'analyse', 'analyze', 'invoice', 'report'], type: 'data' },
  { words: ['embed', 'widget', 'iframe', 'plugin', 'install on'], type: 'iframe' },
  { words: ['chat', 'assistant', 'reply', 'draft', 'write', 'email', 'respond', 'summarise', 'summarize'], type: 'prompt' },
]

function suggestType(input) {
  const lower = input.toLowerCase()
  for (const { words, type } of INTENT_RULES) {
    if (words.some(w => lower.includes(w))) return type
  }
  return 'ai_builder'
}

// Explanations shown next to suggestions in plain English
const TYPE_REASON = {
  prompt:      'Best for text generation and reply drafting.',
  data:        'Best for processing files, CSVs, and documents.',
  website:     'We\'ll read the URL and generate the app for you.',
  native:      'Best for structured forms with defined fields.',
  api:         'Best for developer-facing endpoints.',
  agent:       'Best for autonomous, multi-action tasks.',
  iframe:      'Best for embedding into an existing website.',
  ai_builder:  'Tell AI what you need — it will configure everything.',
  vision:      'Best for image analysis, OCR, and visual inspection.',
  structured:  'Best when you need guaranteed JSON output for integrations.',
  document:    'Best for PDF Q&A, contract extraction, or doc summaries.',
  batch:       'Best for processing many rows or inputs at once.',
  voice:       'Best for transcribing and summarising audio files.',
  translation: 'Best for translating text or documents into other languages.',
  code:        'Best for code generation, review, and explanation.',
  chatbot:     'Best for persona-driven customer-facing chat experiences.',
}

// `step`: the chosen type's builder, shown inside this same popup (same
// size) instead of the picker, so building is one popup start to finish.
export default function AppTypeSelector({ onSelect, onClose, step = null }) {
  const panelRef = useRef(null)
  const [intent, setIntent] = useState('')
  const [suggestion, setSuggestion] = useState(null)
  const [activeGroup, setActiveGroup] = useState(TYPE_GROUPS[0].id)
  useFocusTrap(panelRef, { onEscape: onClose })
  const selectedGroup = TYPE_GROUPS.find(group => group.id === activeGroup) || TYPE_GROUPS[0]
  const selectedTypes = selectedGroup.typeIds.map(typeId => TYPES.find(type => type.id === typeId)).filter(Boolean)

  function handleIntentSubmit(e) {
    e?.preventDefault()
    if (!intent.trim()) return
    const typeId = suggestType(intent)
    setSuggestion(TYPES.find(t => t.id === typeId))
    setActiveGroup(findTypeGroup(typeId).id)
  }

  function pickExample(ex) {
    setIntent(ex.label)
    setSuggestion(TYPES.find(t => t.id === ex.type))
    setActiveGroup(findTypeGroup(ex.type).id)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={step ? undefined : onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="What do you want to automate?"
        className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-6xl flex flex-col overflow-hidden"
        style={{ height: 'min(94vh, 840px)' }}
        onClick={e => e.stopPropagation()}>

        {step || (<>
        {/* Header */}
        <div className="px-6 pt-5 pb-4 shrink-0 border-b border-white/8">
          <div className="flex items-start justify-between mb-1">
            <div>
              <p className="text-white font-bold text-xl leading-snug">What do you want to automate?</p>
              <p className="text-slate-400 text-sm mt-1">Describe it in plain language — we'll pick the right type for you.</p>
            </div>
            <button aria-label="Close" onClick={onClose}
              className="text-slate-500 hover:text-white transition-colors p-1 shrink-0 ml-4">✕</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-6 pb-6 flex flex-col gap-5">
          {/* Primary input */}
          <form onSubmit={handleIntentSubmit} className="grid lg:grid-cols-[1fr_220px] gap-3 pt-5">
            <textarea
              value={intent}
              onChange={e => { setIntent(e.target.value); setSuggestion(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleIntentSubmit() } }}
              placeholder="e.g. I want to qualify sales leads, write personalised emails, and log notes to my CRM…"
              rows={2}
              autoFocus
              className="w-full bg-[#1A2038] border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors resize-none leading-relaxed"
            />
            <button type="submit"
              disabled={!intent.trim()}
              className="w-full bg-gradient-to-r from-[#6C5CE7] to-[#8B5CF6] hover:from-[#7D6FF0] hover:to-[#9D70FF] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-3 rounded-xl transition-all font-semibold">
              Suggest the best app type →
            </button>
          </form>

          {/* Recommendation */}
          {suggestion && (
            <div className="rounded-xl border overflow-hidden"
              style={{ borderColor: suggestion.color + '40', background: suggestion.color + '0D' }}>
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
                  style={{ background: suggestion.color + '22', color: suggestion.color }}>
                  {suggestion.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-white text-sm font-bold">{suggestion.label}</p>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: suggestion.color + '25', color: suggestion.color }}>
                      Recommended
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${STATUS_META[suggestion.status || 'preview'].cls}`}>
                      {STATUS_META[suggestion.status || 'preview'].label}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs">{TYPE_REASON[suggestion.id]}</p>
                </div>
              </div>
              <div className="px-4 pb-4 flex gap-2">
                <button onClick={() => suggestion.status !== 'soon' && onSelect(suggestion.id)}
                  disabled={suggestion.status === 'soon'}
                  className="flex-1 text-sm font-bold py-2.5 rounded-xl transition-all text-white disabled:opacity-45 disabled:cursor-not-allowed"
                  style={{ background: suggestion.status === 'soon' ? '#1F2444' : `linear-gradient(135deg, ${suggestion.color}, ${suggestion.color}CC)` }}>
                  {suggestion.status === 'soon' ? 'Runtime coming soon' : 'Start building →'}
                </button>
                <button onClick={() => setSuggestion(null)}
                  className="text-xs text-slate-500 hover:text-white px-3 py-2 rounded-xl hover:bg-white/5 transition-colors">
                  Change
                </button>
              </div>
            </div>
          )}

          {/* Example chips */}
          {!suggestion && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2.5">Common automations</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map(ex => (
                  <button key={ex.label} onClick={() => pickExample(ex)}
                    className="text-xs text-slate-300 hover:text-white bg-[#1A2038] hover:bg-[#222A48] border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-full transition-all">
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-sm font-extrabold tracking-wide uppercase shrink-0 px-4 py-1.5 rounded-full"
              style={{ background: 'linear-gradient(135deg, #6C5CE722, #8B5CF622)', color: '#A29BFE', border: '1px solid #6C5CE740' }}>
              Or choose from the app catalog
            </span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#11162A]/70 p-4 flex-1 min-h-0 grid lg:grid-cols-[230px_1fr] gap-4">
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wide px-1">App families</p>
              {TYPE_GROUPS.map(group => {
                const isActive = group.id === selectedGroup.id
                const readyCount = group.typeIds
                  .map(typeId => TYPES.find(type => type.id === typeId))
                  .filter(type => type?.status === 'ready').length
                return (
                  <button key={group.id} onClick={() => setActiveGroup(group.id)}
                    className={`w-full px-3 py-3 rounded-xl border text-left transition-all min-h-[70px] ${
                      isActive
                        ? 'bg-[#6C5CE7]/18 border-[#6C5CE7]/50 text-white shadow-lg shadow-[#6C5CE7]/10'
                        : 'bg-[#1A2038] border-white/8 text-slate-300 hover:text-white hover:border-white/20'
                    }`}>
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold leading-tight">{group.short}</span>
                      <span className={`text-[11px] font-bold px-2 py-1 rounded-full border ${
                        isActive
                          ? 'bg-emerald-400/16 text-emerald-200 border-emerald-300/30'
                          : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                      }`}>
                        {readyCount} ready
                      </span>
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-1 leading-snug">{group.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="space-y-4 min-w-0 min-h-0 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-1 min-h-[82px]">
                <div className="max-w-3xl">
                  <p className="text-white text-lg font-bold leading-tight">{selectedGroup.label}</p>
                  <p className="text-slate-300 text-sm leading-relaxed mt-1.5">{selectedGroup.desc}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500 shrink-0">
                  <span className="px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Ready now</span>
                  <span className="px-2 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">Prompt-ready</span>
                  <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10">Coming soon</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start overflow-y-auto pr-1 min-h-0 flex-1">
                {selectedTypes.map(t => {
                  const status = STATUS_META[t.status || 'preview']
                  const disabled = t.status === 'soon'
                  return (
                    <button key={t.id} onClick={() => !disabled && onSelect(t.id)}
                      disabled={disabled}
                      className="text-left flex flex-col gap-2.5 p-4 rounded-xl border border-white/8 hover:border-white/25 bg-[#1A2038] hover:bg-[#1E2444] transition-all group relative overflow-hidden hover:scale-[1.018] hover:shadow-lg hover:z-10 min-h-[140px]"
                      style={{ transitionProperty: 'transform, box-shadow, background-color, border-color', transitionDuration: '120ms, 120ms, 120ms, 120ms', transitionDelay: '80ms, 80ms, 0ms, 0ms', opacity: disabled ? 0.62 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: t.color }} />
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm shrink-0"
                          style={{ background: t.color + '22', color: t.color }}>
                          {t.icon}
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${status.cls}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-bold leading-snug">{t.label}</p>
                        <p className="text-slate-300 text-xs leading-relaxed mt-1">{t.desc}</p>
                        <p className="text-slate-500 text-[11px] leading-snug mt-2">Best for: {t.bestFor}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        </>)}
      </div>
    </div>
  )
}
