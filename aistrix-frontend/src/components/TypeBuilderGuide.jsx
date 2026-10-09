import { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { supabase } from '../supabase'

const TYPE_GUIDES = {
  ai_builder: {
    icon: '✦',
    label: 'Build with AI',
    color: '#E84393',
    tagline: 'Describe the app. Aistrix drafts the build.',
    what: 'Use the guided AI builder when you know the business outcome but do not want to choose every app setting manually. Aistrix asks clarifying questions, proposes the app structure, and creates the first version for you.',
    steps: [
      'Describe the problem, audience, and output you want',
      'Answer the builder questions so Aistrix can shape the app',
      'Review the generated prompt, inputs, and app details',
      'Create the app, then test and refine it in Developer Studio',
    ],
    examples: ['Recruiter resume screener', 'Realtor listing writer', 'Support reply assistant', 'Market research helper'],
    testTip: 'Give the AI builder a real business scenario, not just a generic app idea. Specific users and outputs create better first drafts.',
  },
  website: {
    icon: '🌐',
    label: 'From Website',
    color: '#00B894',
    tagline: 'Turn a website into an AI app.',
    what: 'Start from a company page, product site, documentation page, or service landing page. Aistrix reads the URL and drafts an app using the site content as source context.',
    steps: [
      'Paste the public website URL',
      'Let Aistrix analyse the page and generate app details',
      'Review the name, description, prompt, and source knowledge',
      'Create the app and test it against realistic customer questions',
    ],
    examples: ['Service business assistant', 'Product documentation helper', 'FAQ generator', 'Lead capture support app'],
    testTip: 'Use a page with clear service or product content. Thin landing pages usually need manual prompt editing after generation.',
  },
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
  vision: {
    icon: '👁',
    label: 'Vision / Image',
    color: '#00CEC9',
    tagline: 'Upload an image. Get instant insight.',
    what: 'Users upload one or more images. The AI analyses, describes, extracts data, or flags issues based on your instructions. No ML training required.',
    steps: [
      'Describe what the AI should look for in images',
      'Set the output format (description, JSON fields, pass/fail)',
      'Write a system prompt with specific visual criteria',
      'Test with a real sample image before publishing',
    ],
    examples: ['Invoice OCR extractor', 'Product quality checker', 'Diagram analyser', 'Receipt data parser'],
    testTip: 'Test with images of varying quality and lighting. Vision models can struggle with blurry or low-contrast images.',
  },
  structured: {
    icon: '{ }',
    label: 'Structured Output',
    color: '#0984E3',
    tagline: 'Always returns valid JSON.',
    what: 'Every response is guaranteed to match a JSON schema you define. Zero parsing errors — perfect for feeding AI output into databases, APIs, or spreadsheets.',
    steps: [
      'Define the JSON schema (field names, types, required)',
      'Write the extraction or classification system prompt',
      'Test with edge cases to verify the schema holds',
      'Connect the output to your downstream system',
    ],
    examples: ['Lead data extractor', 'Entity recogniser', 'Document classifier', 'Form field parser'],
    testTip: 'Include optional fields in your schema for data that might be missing. Test with messy input to find schema gaps.',
  },
  document: {
    icon: '📄',
    label: 'Document / PDF',
    color: '#E17055',
    tagline: 'Upload docs. Ask anything.',
    what: 'Users upload PDFs, Word docs, or text files. The AI reads the content and answers questions, extracts tables, summarises sections, or flags key clauses.',
    steps: [
      'Decide what users will ask (Q&A, summary, extraction)',
      'Write a system prompt focused on the document type',
      'Set the expected output format',
      'Test with a real document from your domain',
    ],
    examples: ['Contract Q&A bot', 'Policy lookup tool', 'Research summariser', 'Report section extractor'],
    testTip: 'Test with multi-page documents and tables. Ask edge-case questions the AI might not find answers to.',
  },
  batch: {
    icon: '⊞',
    label: 'Batch Processor',
    color: '#6C5CE7',
    tagline: 'Run AI over hundreds of rows at once.',
    what: 'Upload a CSV and the same prompt runs against every row automatically. Get back a new CSV with AI-generated columns alongside your original data.',
    steps: [
      'Define the column(s) users will provide as input',
      'Write the per-row system prompt',
      'Set the output column name and format',
      'Test with a 5-row sample before running at scale',
    ],
    examples: ['Lead scorer', 'Bulk email personaliser', 'Mass categoriser', 'Sentiment analyser'],
    testTip: 'Always test with a small sample first. A prompt that works on one row may behave differently across 500 rows.',
  },
  voice: {
    icon: '🎙',
    label: 'Voice / Audio',
    color: '#A29BFE',
    tagline: 'Upload audio. Get the transcript and more.',
    what: 'Users upload audio files (MP3, WAV, M4A). Whisper transcribes them, then your system prompt transforms the transcript — summaries, action items, key quotes.',
    steps: [
      'Choose what happens after transcription (summary, actions, insights)',
      'Write the post-transcription system prompt',
      'Set the output format for the processed transcript',
      'Test with a real audio file from your use case',
    ],
    examples: ['Meeting notes generator', 'Call summary tool', 'Podcast highlight extractor', 'Lecture summariser'],
    testTip: 'Test with audio that has multiple speakers or background noise. Whisper handles accents well but struggles with very low quality audio.',
  },
  translation: {
    icon: '🌐',
    label: 'Translation',
    color: '#00B894',
    tagline: 'Translate text with glossary control.',
    what: 'Users paste text or upload a document. The AI translates into the target language while respecting any glossary or tone instructions you define.',
    steps: [
      'Set the target language (or let users choose)',
      'Define any glossary terms that must stay consistent',
      'Set tone instructions (formal, casual, technical)',
      'Test with a real sample from your domain',
    ],
    examples: ['Marketing copy translator', 'Legal doc localiser', 'Product UI string translator', 'Support reply translator'],
    testTip: 'Include 5–10 glossary terms specific to your domain. Generic translations miss brand voice and technical terminology.',
  },
  code: {
    icon: '</>',
    label: 'Code Gen / Review',
    color: '#FDCB6E',
    tagline: 'Generate, review, and explain code.',
    what: 'Users paste code, describe a feature, or share a PR diff. The AI generates new code, reviews for bugs, explains functions, or writes tests according to your guidelines.',
    steps: [
      'Define the coding task (generate, review, explain, test)',
      'Set the language and any style guide rules',
      'Write the system prompt with quality criteria',
      'Test with real code snippets from your codebase',
    ],
    examples: ['PR review bot', 'Test generator', 'Code explainer', 'Refactor assistant'],
    testTip: 'Include language version and framework in your system prompt. GPT-4 and Claude can produce outdated syntax without that context.',
  },
  chatbot: {
    icon: '💬',
    label: 'Chatbot with Persona',
    color: '#E84393',
    tagline: 'A named assistant with personality.',
    what: 'A multi-turn chat assistant with a custom name, avatar, greeting, and tone. Users have back-and-forth conversations — the chatbot remembers context within the session.',
    steps: [
      'Name the chatbot and write its persona description',
      'Set the greeting message users see on open',
      'Define the scope (what it can and cannot discuss)',
      'Choose the tone preset and test the conversation flow',
    ],
    examples: ['Customer support bot', 'Onboarding assistant', 'Product guide chatbot', 'HR FAQ bot'],
    testTip: 'Test the full conversation arc — not just the first reply. Ask off-topic questions to verify the bot stays in scope.',
  },
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const fmtTokens = ([lo, hi]) => (lo === hi ? lo.toLocaleString() : `${lo.toLocaleString()}–${hi.toLocaleString()}`)
const fmtUsdOne = v => (v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`)
const fmtUsd = ([lo, hi]) => (fmtUsdOne(lo) === fmtUsdOne(hi) ? fmtUsdOne(hi) : `${fmtUsdOne(lo)}–${fmtUsdOne(hi)}`)

// What starting to build this type uses (tokens, ≈cost, who pays), from the
// backend so prices and the user's key/allowance are always current.
function useBuildEstimate(type) {
  const [estimate, setEstimate] = useState(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`${API_URL}/v1/build-estimate?type=${encodeURIComponent(type)}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        })
        if (res.ok && !cancelled) setEstimate(await res.json())
      } catch { /* estimate is informational — hide it if unavailable */ }
    })()
    return () => { cancelled = true }
  }, [type])
  return estimate
}

function BuildEstimate({ estimate }) {
  if (!estimate) return null
  const { total, billing, steps } = estimate
  const optional = steps.filter(st => st.optional)
  const runs = `${total.runs} AI call${total.runs === 1 ? '' : 's'}`
  return (
    <div className="bg-white/4 border border-white/10 rounded-xl p-3">
      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Estimated AI usage</p>
      {estimate.uses_ai_to_create ? (
        <>
          <p className="text-sm text-white">≈ {fmtTokens(total.tokens)} tokens · ≈ {fmtUsd(total.usd)}</p>
          {billing.billed_to === 'your_key' ? (
            <p className="text-xs text-slate-400 mt-0.5">Billed to your Claude API key ({runs}).</p>
          ) : billing.enough_runs ? (
            <p className="text-xs text-slate-400 mt-0.5">
              Free for you — uses {runs}{billing.runs_left != null ? ` of your ${billing.runs_left} platform runs left` : ' from your platform allowance'}.
            </p>
          ) : (
            <p className="text-xs text-amber-300 mt-0.5">
              You have {billing.runs_left} platform run{billing.runs_left === 1 ? '' : 's'} left; this needs {total.runs}. Add your own API key in Settings → Keys, or try again later.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-white">Creating this app uses no AI — no tokens, no cost.</p>
      )}
      {optional.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {optional.map(st => (
            <li key={st.label} className="text-[11px] text-slate-500">
              Optional · {st.label}: ≈ {fmtTokens(st.tokens)} tokens (≈ {fmtUsd(st.usd)})
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-slate-600 mt-2">Estimate — actual usage depends on what you enter. Runs on your own key are billed by your provider.</p>
    </div>
  )
}

// The guide's body and footer. Used by the guide popup below, and by
// AIAppBuilder as its first screen so Build with AI stays one popup.
export function TypeGuideSteps({ type, onBack, onContinue }) {
  const guide = TYPE_GUIDES[type]
  const estimate = useBuildEstimate(type)
  if (!guide) return null
  return (
    <>
        <div className="overflow-y-auto flex-1 px-6 pb-6 pt-5 space-y-5">
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

        {/* Footer — matches AppTypeSelector style */}
        <div className="px-6 py-4 border-t border-white/5 shrink-0 space-y-3">
          {/* Shown right above the button so the cost is visible before starting */}
          <BuildEstimate estimate={estimate} />
          <div className="flex gap-3">
          <button onClick={onBack}
            className="px-5 bg-white/5 hover:bg-white/10 text-slate-300 text-sm py-2.5 rounded-xl transition-colors border border-white/10">
            ← Back
          </button>
          <button onClick={onContinue}
            className="flex-1 text-white text-sm py-2.5 rounded-xl font-semibold transition-all"
            style={{ background: `linear-gradient(135deg, ${guide.color}, ${guide.color}BB)` }}>
            Start building →
          </button>
          </div>
        </div>
    </>
  )
}

export default function TypeBuilderGuide({ type, onContinue, onClose }) {
  const panelRef = useRef(null)
  useFocusTrap(panelRef, { onEscape: onClose })
  const guide = TYPE_GUIDES[type]
  if (!guide) { onContinue(); return null }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true"
        className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Header — matches AppTypeSelector */}
        <div className="px-6 pt-6 pb-5 shrink-0 border-b border-white/5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-bold shrink-0"
                style={{ background: guide.color + '22', color: guide.color }}>
                {guide.icon}
              </div>
              <div>
                <p className="text-white font-bold text-xl leading-snug">{guide.label}</p>
                <p className="text-slate-400 text-sm mt-0.5">{guide.tagline}</p>
              </div>
            </div>
            <button aria-label="Close" onClick={onClose}
              className="text-slate-500 hover:text-white transition-colors p-1 shrink-0 ml-4">✕</button>
          </div>
        </div>

        <TypeGuideSteps type={type} onBack={onClose} onContinue={onContinue} />
      </div>
    </div>
  )
}
