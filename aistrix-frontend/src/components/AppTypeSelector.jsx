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
  },
  {
    id: 'workspace',
    icon: '🧩',
    label: 'Workflow',
    desc: 'Chain multiple apps into a pipeline. Build end-to-end automation without code.',
    color: '#6C5CE7',
    bestFor: 'Multi-step tasks: Research → Draft → Review → Send.',
  },
  {
    id: 'website',
    icon: '🌐',
    label: 'From Website',
    desc: 'Enter a URL. We\'ll read the site and generate a ready-to-run app for it.',
    color: '#00B894',
    bestFor: 'Small businesses, service pages, product docs, knowledge bases.',
  },
  {
    id: 'native',
    icon: '⊞',
    label: 'Form App',
    desc: 'Design a custom form with typed fields. Feels like real software, not a chatbox.',
    color: '#00B894',
    bestFor: 'Job applications, report generators, structured intake forms.',
  },
  {
    id: 'prompt',
    icon: '✦',
    label: 'Prompt App',
    desc: 'Write a system prompt. Users type input, AI responds. Fastest to build.',
    color: '#A29BFE',
    bestFor: 'Open-ended assistants, chatbots, quick text transformations.',
  },
  {
    id: 'api',
    icon: '{ }',
    label: 'API App',
    desc: 'Define parameters and output schema. Expose as a REST endpoint.',
    color: '#0984E3',
    bestFor: 'Developer integrations, webhook consumers, headless AI endpoints.',
  },
  {
    id: 'data',
    icon: '▦',
    label: 'Data App',
    desc: 'Paste CSV, upload a file, or provide a URL. AI analyzes and transforms it.',
    color: '#E17055',
    bestFor: 'CSV analysis, document extraction, report summarization.',
  },
  {
    id: 'agent',
    icon: '◈',
    label: 'Agent',
    desc: 'Give it a goal. It plans, uses tools, and executes autonomously until done.',
    color: '#FDCB6E',
    bestFor: 'Autonomous tasks: web research, sending emails, multi-step execution.',
  },
  {
    id: 'iframe',
    icon: '⬡',
    label: 'Embeddable Widget',
    desc: 'Build a widget you can drop into any website with one line of code.',
    color: '#E84393',
    bestFor: 'Website widgets, customer support tools, embedded calculators.',
  },
  {
    id: 'vision',
    icon: '👁',
    label: 'Vision / Image',
    desc: 'Upload images and let AI analyse, describe, extract data, or flag issues.',
    color: '#00CEC9',
    bestFor: 'Invoice OCR, product quality checks, diagram analysis, accessibility audits.',
  },
  {
    id: 'structured',
    icon: '{ }',
    label: 'Structured Output',
    desc: 'Always returns valid JSON matching a schema you define. Zero parsing errors.',
    color: '#0984E3',
    bestFor: 'Data extraction, entity recognition, classification, form parsing.',
  },
  {
    id: 'document',
    icon: '📄',
    label: 'Document / PDF',
    desc: 'Upload PDFs or Word docs. Ask questions, extract tables, or summarise sections.',
    color: '#E17055',
    bestFor: 'Contract Q&A, research summaries, policy lookup, report extraction.',
  },
  {
    id: 'batch',
    icon: '⊞',
    label: 'Batch Processor',
    desc: 'Run the same prompt over hundreds of rows at once. Upload a CSV, get results.',
    color: '#6C5CE7',
    bestFor: 'Lead scoring, bulk translation, mass email personalisation, categorisation.',
  },
  {
    id: 'voice',
    icon: '🎙',
    label: 'Voice / Audio',
    desc: 'Upload audio files. Transcribe with Whisper, then summarise or extract insights.',
    color: '#A29BFE',
    bestFor: 'Meeting notes, call summaries, podcast transcripts, lecture highlights.',
  },
  {
    id: 'translation',
    icon: '🌐',
    label: 'Translation',
    desc: 'Translate text or documents across 100+ languages with glossary control.',
    color: '#00B894',
    bestFor: 'Localising products, legal docs, customer support, marketing copy.',
  },
  {
    id: 'code',
    icon: '</> ',
    label: 'Code Gen / Review',
    desc: 'Generate code, review PRs, explain functions, or auto-write tests.',
    color: '#FDCB6E',
    bestFor: 'PR review bots, test generators, documentation writers, snippet assistants.',
  },
  {
    id: 'chatbot',
    icon: '💬',
    label: 'Chatbot with Persona',
    desc: 'A named assistant with a custom personality, greeting, and tone presets.',
    color: '#E84393',
    bestFor: 'Customer support bots, onboarding assistants, product guide chatbots.',
  },
]

// Business-language examples shown as quick-pick chips
const EXAMPLES = [
  { label: 'Qualify my sales leads', type: 'workspace' },
  { label: 'Screen resumes for a role', type: 'workspace' },
  { label: 'Draft support replies', type: 'prompt' },
  { label: 'Summarise invoices', type: 'data' },
  { label: 'Write cold outreach emails', type: 'prompt' },
  { label: 'Build a pipeline from my website', type: 'website' },
  { label: 'Analyse a CSV spreadsheet', type: 'batch' },
  { label: 'Create a lead capture form', type: 'native' },
  { label: 'Automate a multi-step workflow', type: 'workspace' },
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
  { words: ['chain', 'pipeline', 'workflow', 'sequence', 'multi-step', 'steps', 'qualify', 'screen', 'triage', 'outreach'], type: 'workspace' },
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
  workspace:   'Best for chaining steps: qualify → outreach → log.',
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

export default function AppTypeSelector({ onSelect, onClose }) {
  const panelRef = useRef(null)
  const [intent, setIntent] = useState('')
  const [suggestion, setSuggestion] = useState(null)
  useFocusTrap(panelRef, { onEscape: onClose })

  function handleIntentSubmit(e) {
    e?.preventDefault()
    if (!intent.trim()) return
    const typeId = suggestType(intent)
    setSuggestion(TYPES.find(t => t.id === typeId))
  }

  function pickExample(ex) {
    setIntent(ex.label)
    setSuggestion(TYPES.find(t => t.id === ex.type))
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="What do you want to automate?"
        className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-5xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 pt-6 pb-5 shrink-0">
          <div className="flex items-start justify-between mb-1">
            <div>
              <p className="text-white font-bold text-xl leading-snug">What do you want to automate?</p>
              <p className="text-slate-400 text-sm mt-1">Describe it in plain language — we'll pick the right type for you.</p>
            </div>
            <button aria-label="Close" onClick={onClose}
              className="text-slate-500 hover:text-white transition-colors p-1 shrink-0 ml-4">✕</button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-6 space-y-5">
          {/* Primary input */}
          <form onSubmit={handleIntentSubmit} className="space-y-3">
            <textarea
              value={intent}
              onChange={e => { setIntent(e.target.value); setSuggestion(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleIntentSubmit() } }}
              placeholder="e.g. I want to qualify sales leads, write personalised emails, and log notes to my CRM…"
              rows={3}
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
                  </div>
                  <p className="text-slate-400 text-xs">{TYPE_REASON[suggestion.id]}</p>
                </div>
              </div>
              <div className="px-4 pb-4 flex gap-2">
                <button onClick={() => onSelect(suggestion.id)}
                  className="flex-1 text-sm font-bold py-2.5 rounded-xl transition-all text-white"
                  style={{ background: `linear-gradient(135deg, ${suggestion.color}, ${suggestion.color}CC)` }}>
                  Start building →
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
              Or choose a type directly
            </span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          {/* App type grid — always visible */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TYPES.map(t => (
              <button key={t.id} onClick={() => onSelect(t.id)}
                className="text-left flex flex-col gap-1.5 p-3 rounded-xl border border-white/8 hover:border-white/25 bg-[#1A2038] hover:bg-[#1E2444] transition-all group relative overflow-hidden">
                {/* subtle colour bar at top */}
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: t.color }} />
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0"
                  style={{ background: t.color + '22', color: t.color }}>
                  {t.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs font-semibold leading-snug">{t.label}</p>
                  <p className="text-slate-500 text-[10px] leading-snug mt-0.5 line-clamp-2">{t.bestFor}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
