import { useRef } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

const TYPE_GUIDES = {
  native: {
    icon: '⊞',
    label: 'Form App',
    color: '#00B894',
    tagline: 'Structured inputs. Professional output.',
    what: 'Users fill in labelled fields — the AI processes each one and returns formatted results. Feels like real software, not a chatbox.',
    steps: [
      'Define your form fields (name, job title, budget range…)',
      'Write a system prompt that uses those fields',
      'Choose the output format (Markdown, Table, JSON)',
      'Publish — your app has a shareable URL',
    ],
    examples: ['Invoice data extractor', 'Job application screener', 'Intake form analyzer', 'Quote generator'],
    testTip: 'After creating, fill in the form yourself to verify the AI output looks right.',
  },
  data: {
    icon: '▦',
    label: 'Data App',
    color: '#E17055',
    tagline: 'Paste data. Get insight.',
    what: 'Users paste CSV, upload a file, or drop in a URL. The AI analyzes, transforms, or extracts from it. No spreadsheet skills required.',
    steps: [
      'Describe what data users will bring (CSV, text, URL)',
      'Define what output you want (summary, table, key facts)',
      'Set the system prompt to handle the data format',
      'Test with a real CSV or text sample',
    ],
    examples: ['Sales pipeline CSV summarizer', 'Invoice batch reviewer', 'Survey response analyzer', 'Competitor website extractor'],
    testTip: 'Paste a small real sample during test run to validate column names and output format.',
  },
  api: {
    icon: '{}',
    label: 'API App',
    color: '#0984E3',
    tagline: 'AI as a REST endpoint.',
    what: 'Define parameters and an output schema. Aistrix exposes a REST endpoint developers can call from any codebase, webhook, or automation.',
    steps: [
      'Define the input parameters (name, type, required)',
      'Write the system prompt that processes those params',
      'Choose the JSON output schema',
      'Copy the endpoint URL and auth token after publishing',
    ],
    examples: ['Lead scoring endpoint', 'Sentiment analysis API', 'Product description generator', 'Document classifier'],
    testTip: 'Use the built-in API tester to send a sample payload and inspect the JSON response.',
  },
  agent: {
    icon: '◈',
    label: 'Agent',
    color: '#FDCB6E',
    tagline: 'Give it a goal. It figures out the rest.',
    what: 'An agent receives a goal, plans a series of steps, uses tools (web search, calculator, HTTP calls), and runs until the task is complete.',
    steps: [
      'Describe the goal the agent should achieve',
      'Select the tools it can use (search, calculator, fetch)',
      'Set constraints (max steps, output format)',
      'Test with a real goal to watch it plan and execute',
    ],
    examples: ['Market research agent', 'Competitor monitoring agent', 'Lead enrichment agent', 'Email outreach agent'],
    testTip: 'Start with a narrow, well-defined goal. Broad goals like "grow my business" won\'t produce useful output.',
  },
  iframe: {
    icon: '⬡',
    label: 'Embeddable Widget',
    color: '#E84393',
    tagline: 'One line of code. Anywhere.',
    what: 'Build a widget that runs inside any website. Paste the <iframe> snippet into your site — your users get an AI assistant without leaving your page.',
    steps: [
      'Design the app (prompt or form input)',
      'Set the embed style (floating widget or inline)',
      'Publish — you get an embeddable URL',
      'Paste the snippet into your site\'s HTML',
    ],
    examples: ['Website chatbot', 'Product configurator', 'Support FAQ widget', 'Quote calculator'],
    testTip: 'Test the iframe URL directly in your browser before embedding. Check it on mobile width too.',
  },
  prompt: {
    icon: '✦',
    label: 'Prompt App',
    color: '#A29BFE',
    tagline: 'Type in. Get the perfect output.',
    what: 'The simplest type. Users type a single input; the AI responds according to your system prompt. Ideal for text generation, transformation, and Q&A.',
    steps: [
      'Write a precise system prompt (the heart of the app)',
      'Choose the AI model and output format',
      'Add example placeholder text to guide users',
      'Publish and share the URL',
    ],
    examples: ['Cold email writer', 'Meeting notes summarizer', 'Tone rewriter', 'Blog post generator'],
    testTip: 'Try at least 3 different inputs before publishing. Edge cases reveal gaps in your system prompt.',
  },
}

export default function TypeBuilderGuide({ type, onContinue, onClose }) {
  const panelRef = useRef(null)
  useFocusTrap(panelRef, { onEscape: onClose })
  const guide = TYPE_GUIDES[type]
  if (!guide) { onContinue(); return null }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-60 p-4" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true"
        className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-lg flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="p-5 border-b border-white/5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-bold shrink-0"
              style={{ background: guide.color + '22', color: guide.color }}>
              {guide.icon}
            </div>
            <div>
              <p className="text-white font-bold text-base">{guide.label}</p>
              <p className="text-slate-400 text-xs mt-0.5">{guide.tagline}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 shrink-0">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* What it is */}
          <p className="text-slate-300 text-sm leading-relaxed">{guide.what}</p>

          {/* How it works */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">How it works</p>
            <ol className="space-y-2">
              {guide.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                    style={{ background: guide.color + '22', color: guide.color }}>
                    {i + 1}
                  </span>
                  <span className="text-sm text-slate-300">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Examples */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">Use case examples</p>
            <div className="flex flex-wrap gap-2">
              {guide.examples.map(ex => (
                <span key={ex} className="text-xs text-slate-300 bg-white/6 border border-white/10 px-3 py-1.5 rounded-full">
                  {ex}
                </span>
              ))}
            </div>
          </div>

          {/* Test tip */}
          <div className="bg-[#6C5CE7]/8 border border-[#6C5CE7]/20 rounded-xl p-3">
            <p className="text-[10px] text-[#A29BFE] font-semibold uppercase tracking-wide mb-1">Testing tip</p>
            <p className="text-xs text-slate-300 leading-relaxed">{guide.testTip}</p>
          </div>
        </div>

        {/* CTA */}
        <div className="p-5 border-t border-white/5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-sm py-2.5 rounded-xl transition-colors border border-white/10">
            ← Change type
          </button>
          <button onClick={onContinue}
            className="flex-1 text-white text-sm py-2.5 rounded-xl font-semibold transition-all"
            style={{ background: `linear-gradient(135deg, ${guide.color}, ${guide.color}BB)` }}>
            Start building →
          </button>
        </div>
      </div>
    </div>
  )
}
