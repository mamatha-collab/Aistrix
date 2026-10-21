import { useState, lazy } from 'react'
import { inferPromptOutputFormat } from '../../utils/starterBlueprint'

import { BRAND } from '../../lib/brand'
import { isFileApp } from '../../lib/fileApps'
export const PUBLIC_API_URL = (import.meta.env.VITE_PUBLIC_API_URL || import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

export const PromptStudio = lazy(() => import('../../components/PromptStudio'))
export const DiffEditor   = lazy(() => import('@monaco-editor/react').then(m => ({ default: m.DiffEditor })))
export const DeveloperProfileEditor = lazy(() => import('../DeveloperProfilePage').then(m => ({ default: m.DeveloperProfileEditor })))

// ─── Onboarding: what you can build ──────────────────────────────────────────

const APP_TYPES = [
  { icon: '📝', label: 'Text apps',          desc: 'Summarise, rewrite, translate, classify — any text-in / text-out task.' },
  { icon: '📊', label: 'Data apps',          desc: 'Drop in a PDF, Word or Excel file, a CSV or a link: the AI reads, analyses and extracts from it.' },
  { icon: '💬', label: 'Chat / Persona',     desc: 'Conversational assistants with persistent memory and a custom personality.' },
  { icon: '🤖', label: 'Agent apps',         desc: 'Apps that call tools, search the web, run code, or read files autonomously.' },
  { icon: '🔌', label: 'API / Webhook',      desc: 'Headless apps triggered by external services — Zapier, Slack, your own code.' },
  { icon: '👁', label: 'Vision / Image',     desc: 'Send images in — AI describes, inspects quality, or reads receipts.' },
  { icon: '{ }', label: 'Structured Output', desc: 'Always returns valid JSON matching a schema — zero parsing errors.' },
  { icon: '⊞', label: 'Batch Processor',    desc: 'Run any prompt over hundreds of CSV rows in parallel — get results back.' },
  { icon: '🎙', label: 'Voice / Audio',      desc: 'Upload a recording: it\'s transcribed (OpenAI), then summarised or turned into action items.' },
  { icon: '</>', label: 'Code Gen / Review', desc: 'Generate functions, review PRs, explain code, or auto-write tests.' },
  { icon: '🌍', label: 'Translation',        desc: 'Translate text or docs across 100+ languages with glossary control.' },
]

const LIFECYCLE_STEPS = [
  { step: 1, icon: '✏️',  label: 'Design',   desc: 'Write a system prompt, pick a model (Claude, GPT-4o, …), set input fields.' },
  { step: 2, icon: '🧪',  label: 'Test',      desc: 'Create test cases with pass/fail rules. Run them any time — or auto-run before saving a version.' },
  { step: 3, icon: '🚀',  label: 'Deploy',    desc: 'Publish the app so users can run it from their dashboard or via a public link.' },
  { step: 4, icon: '🛒',  label: 'Marketplace', desc: 'List your app on the Marketplace and set pricing — free, one-time, or subscription.' },
  { step: 5, icon: '📡',  label: 'Monitor',   desc: 'Watch run volume, ratings, token usage, and subscriber counts in real time.' },
  { step: 6, icon: '🎯',  label: 'Evaluate',  desc: 'Deep-dive into quality: per-prompt scoring, failure analysis, regression tracking.' },
  { step: 7, icon: '🔬',  label: 'Improve',   desc: 'A/B-test prompt variants and compare output quality before shipping changes.' },
  { step: 8, icon: '📦',  label: 'Version',   desc: 'Snapshot any working state. Roll back in one click. See the full change history.' },
  { step: 9, icon: '💰',  label: 'Revenue',   desc: 'See real margin: estimated revenue vs. AI cost per run, broken down by app.' },
]

const FEATURES = [
  { icon: '🛒', label: 'Marketplace',    desc: 'List your app publicly so anyone can discover and launch it.' },
  { icon: '💳', label: 'Stripe billing', desc: 'Per-run payments and subscriptions wired up out of the box.' },
  { icon: '🗄️', label: 'Data sources',  desc: 'Inject your own docs, CSVs, or Google Sheets as context into any run.' },
  { icon: '📈', label: 'Analytics',      desc: 'PostHog funnel events from first run to payment, no setup needed.' },
  { icon: '🐍', label: 'SDK / CLI',      desc: 'pip install aistrix then run any app from your terminal or scripts.' },
  { icon: '👤', label: 'Dev profile',    desc: 'Public profile page with your published apps and bio.' },
]

// Hints for the platform's short list; other models (from a developer's own
// key) are shown by name.
export const MODEL_HINTS = {
  'claude-sonnet-5-5': 'Best default for quality', 'claude-haiku-5-5': 'Fast and lower cost',
  'claude-opus-5-5': 'Highest reasoning cost', 'gpt-4o-mini': 'Fast and lower cost',
  'gpt-4o': 'Higher quality multimodal model', 'gemini-3.8-flash': 'Fast and lower cost',
}

const APP_TYPE_META = {
  prompt:    { label: 'Prompt',    icon: '💬', color: '#A29BFE', bg: 'rgba(108,92,231,0.15)',  border: 'rgba(108,92,231,0.3)'  },
  agent:     { label: 'Agent',     icon: '🤖', color: '#74B9FF', bg: 'rgba(116,185,255,0.12)', border: 'rgba(116,185,255,0.3)' },
  data:      { label: 'Data',      icon: '📊', color: '#55EFC4', bg: 'rgba(85,239,196,0.12)',  border: 'rgba(85,239,196,0.3)'  },
  api:       { label: 'API',       icon: '🔌', color: '#FDCB6E', bg: 'rgba(253,203,110,0.12)', border: 'rgba(253,203,110,0.3)' },
  chat:      { label: 'Chat',      icon: '💭', color: '#81ECEC', bg: 'rgba(129,236,236,0.12)', border: 'rgba(129,236,236,0.3)' },
  native:    { label: 'Native UI', icon: '🖥️', color: '#B2BEC3', bg: 'rgba(178,190,195,0.12)', border: 'rgba(178,190,195,0.3)' },
  website:   { label: 'Website',   icon: '🌐', color: '#00CEC9', bg: 'rgba(0,206,201,0.12)',   border: 'rgba(0,206,201,0.3)'   },
  multipage: { label: 'Multi-page',icon: '📄', color: '#6C5CE7', bg: 'rgba(108,92,231,0.12)',  border: 'rgba(108,92,231,0.25)' },
}

export function getAppTypeLabel(app) {
  const key = app?.app_type || app?.type
  return APP_TYPE_META[key]?.label ? APP_TYPE_META[key].label + ' app' : 'AI app'
}

export function AppEmojiWithType({ app, size = 'sm' }) {
  const key = app?.app_type || app?.type
  const meta = APP_TYPE_META[key] || { icon: '✨', color: '#A29BFE', bg: 'rgba(108,92,231,0.2)', border: 'rgba(108,92,231,0.4)' }
  const emojiSize = size === 'lg' ? 'text-2xl' : 'text-base'
  const badgeSize = size === 'lg' ? 'text-[10px] w-4 h-4' : 'text-[8px] w-3.5 h-3.5'
  return (
    <span className="relative shrink-0 inline-flex items-center justify-center">
      <span className={`${emojiSize} leading-none`}>{app?.emoji}</span>
      <span className={`absolute -bottom-1 -right-1 ${badgeSize} rounded-full flex items-center justify-center font-bold leading-none`}
        style={{ background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color }}>
        {meta.icon}
      </span>
    </span>
  )
}

export const DEV_PHASES = {
  design: {
    label: 'Design', icon: '✏️',
    color: 'text-[#A29BFE]', bg: 'bg-[#6C5CE7]/15', border: 'border-[#6C5CE7]/25',
    help: 'Blueprint, input/output schema, prompt, and AI behavior are being defined. App is not yet testable.',
  },
  test: {
    label: 'Test', icon: '🧪',
    color: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/25',
    help: 'Blueprint is complete. Run generated and manual test cases to validate behavior before publishing.',
  },
  deploy: {
    label: 'Deploy', icon: '🚀',
    color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25',
    help: 'App is live. Monitor usage, evaluate quality, and publish updates via the Version tab.',
  },
}

const PHASE_ORDER = ['design', 'test', 'deploy']

export function normalizeDevPhase(phase) {
  return PHASE_ORDER.includes(phase) ? phase : null
}

export function getDevPhase(app, phaseByAppId = {}) {
  if (normalizeDevPhase(phaseByAppId[app?.id])) return phaseByAppId[app?.id]
  if (app?.is_published) return 'deploy'
  return 'design'
}

// ─── Phase Rail ───────────────────────────────────────────────────────────────

export function AppNavigator({ apps, phaseByAppId, activeAppId, activeTab, onSelectApp, onSwitchTab, onMovePhase, onCreateApp, onOpenApp, compact = false }) {
  const grouped = { design: [], test: [], deploy: [] }
  for (const a of apps) grouped[getDevPhase(a, phaseByAppId)]?.push(a)

  const PREV = { test: 'design', deploy: 'test' }
  const NEXT = { design: 'test', test: 'deploy' }
  const SECTION_LABEL = { design: 'Still Designing', test: 'Testing', deploy: 'Deployed' }
  const activeApp = apps.find(a => a.id === activeAppId)

  return (
    <div className={`${compact ? 'developer-app-navigator w-full px-0 py-2' : 'w-[340px] px-4 py-5'} max-w-full shrink-0 space-y-5`}>
      {compact && <div className="flex items-center justify-between px-2"><h2 className="text-sm text-white font-semibold">Your apps</h2><button onClick={onCreateApp} aria-label="Create an app" className="text-slate-400 hover:text-white text-lg px-2">+</button></div>}
      <details open={!compact || undefined} className="rounded-2xl border border-white/8 bg-[#111827] p-3 space-y-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-400">App pipeline</summary>
        <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-white text-sm font-bold">App Pipeline</p>
            <p className="text-slate-400 text-xs mt-1 leading-relaxed">Move apps through Design, Test, and Deploy without losing your current context.</p>
          </div>
          <button onClick={onCreateApp}
            className="shrink-0 bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors">
            New
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PHASE_ORDER.map(phase => {
            const p = DEV_PHASES[phase]
            return (
              <button key={phase} onClick={() => onSwitchTab(phase)}
                className={`rounded-xl border px-2 py-2 text-left transition-colors ${
                  activeTab === phase ? `${p.bg} ${p.border}` : 'bg-[#0E1424] border-white/6 hover:border-white/15'
                }`}>
                <p className={`text-[10px] font-bold ${p.color}`}>{p.icon} {p.label}</p>
                <p className="text-white text-lg font-bold leading-none mt-1">{grouped[phase]?.length || 0}</p>
              </button>
            )
          })}
        </div>
        {activeApp ? (
          <div className="rounded-xl bg-[#0E1424] border border-white/6 px-3 py-2">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">Selected app</p>
            <div className="mt-1 flex items-center gap-2 min-w-0">
              <AppEmojiWithType app={activeApp} />
              <div className="min-w-0">
                <p className="text-white text-xs font-semibold truncate">{activeApp.name}</p>
                <p className="text-slate-500 text-[10px] truncate">{getAppTypeLabel(activeApp)}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500 leading-relaxed">Select an app below to edit, test, deploy, version, or manage secrets.</p>
        )}
        </div>
      </details>

      {PHASE_ORDER.map(phase => {
        const p = DEV_PHASES[phase]
        const phaseApps = grouped[phase] || []
        return (
          <div key={phase} className="space-y-1.5">
            <div className="flex items-center justify-between px-1 pb-0.5">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${p.color}`}>
                {p.icon} {SECTION_LABEL[phase]}
              </span>
              {phaseApps.length > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${p.bg} ${p.color}`}>
                  {phaseApps.length}
                </span>
              )}
            </div>

            {phaseApps.length === 0 ? (
              <p className="text-[11px] text-slate-600 italic pl-2 pb-1">No apps here yet</p>
            ) : (
              phaseApps.map(a => {
                const isActive = activeAppId === a.id
                return (
                  <div key={a.id} className="group/app relative">
                    <button
                      onClick={() => { if (onOpenApp) onOpenApp(a.id, phase); else { onSelectApp(a.id); onSwitchTab(phase) } }}
                      className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm transition-colors ${
                        isActive
                          ? `${p.bg} ${p.border} ${p.color} font-semibold`
                          : 'bg-[#0E1424] border-white/6 text-slate-200 hover:text-white hover:border-white/18 hover:bg-[#151B33]'
                      }`}
                    >
                      <AppEmojiWithType app={a} />
                      <span className="truncate text-sm leading-tight flex-1 pr-10">{a.name}</span>
                      {a.is_published
                        ? a.has_draft_changes
                          ? <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">DRAFT</span>
                          : <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">LIVE</span>
                        : null}
                    </button>

                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover/app:flex items-center gap-0.5">
                      {PREV[phase] && (
                        <button
                          onClick={() => onMovePhase(a.id, PREV[phase])}
                          title={`Move back to ${DEV_PHASES[PREV[phase]].label}`}
                          className="text-[9px] text-slate-500 hover:text-amber-300 transition-colors px-1.5 py-0.5 rounded bg-[#0E1424] border border-white/8"
                        >
                          ←
                        </button>
                      )}
                      {NEXT[phase] && (
                        <button
                          onClick={() => onMovePhase(a.id, NEXT[phase])}
                          title={`Move to ${DEV_PHASES[NEXT[phase]].label}`}
                          className="text-[9px] text-slate-500 hover:text-emerald-300 transition-colors px-1.5 py-0.5 rounded bg-[#0E1424] border border-white/8"
                        >
                          →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )
      })}
    </div>
  )
}

export function WelcomeScreen({ onCreateApp }) {
  return (
    <div className="space-y-8 pb-10">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#6C5CE7]/20 to-[#0E1424] border border-[#6C5CE7]/20 rounded-2xl p-8 text-center">
        <div className="text-5xl mb-3">🧩</div>
        <h2 className="text-2xl font-bold text-white mb-2">Welcome to {BRAND} Dev Studio</h2>
        <p className="text-slate-400 text-sm max-w-lg mx-auto leading-relaxed">
          Build, test, and sell AI-powered apps — without managing any infrastructure.
          Write a prompt, pick a model, and you have a live app in minutes.
        </p>
        <button onClick={onCreateApp}
          className="mt-6 inline-flex items-center gap-2 bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white text-sm font-semibold px-6 py-3 rounded-xl transition-colors shadow-lg shadow-[#6C5CE7]/25">
          + Create your first app
        </button>
      </div>

      {/* What you can build */}
      <div>
        <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-3">What can you build?</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {APP_TYPES.map(({ icon, label, desc }) => (
            <div key={label} className="bg-[#171B33] border border-white/5 hover:border-[#6C5CE7]/20 rounded-2xl p-4 transition-colors">
              <div className="text-2xl mb-2">{icon}</div>
              <p className="text-white text-sm font-semibold mb-1">{label}</p>
              <p className="text-slate-500 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works — 9 steps */}
      <div>
        <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-3">How it works — 9 lifecycle stages</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {LIFECYCLE_STEPS.map(({ step, icon, label, desc }) => (
            <div key={step} className="bg-[#171B33] border border-white/5 rounded-2xl p-4 flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-[#6C5CE7]/20 flex items-center justify-center text-[11px] font-bold text-[#A29BFE]">{step}</div>
              <div>
                <p className="text-white text-xs font-semibold mb-0.5">{icon} {label}</p>
                <p className="text-slate-500 text-[11px] leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <div>
        <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-3">Built-in features</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {FEATURES.map(({ icon, label, desc }) => (
            <div key={label} className="bg-[#171B33] border border-white/5 rounded-xl p-4 flex gap-3 items-start">
              <span className="text-xl shrink-0">{icon}</span>
              <div>
                <p className="text-white text-xs font-semibold">{label}</p>
                <p className="text-slate-500 text-[11px] leading-relaxed mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function HelpPanel({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-[#0E1424] border-l border-white/5 h-full overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[#0E1424]/95 backdrop-blur-sm px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <p className="text-white font-semibold text-sm">Developer Guide</p>
          <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none transition-colors">×</button>
        </div>

        <div className="px-5 py-5 space-y-6">
          {/* Quick start */}
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-3">Quick start</p>
            <ol className="space-y-3">
              {[
                { n: 1, t: 'Create an app', d: 'Go to Design → click "+ New app". Pick a type, write a system prompt, choose a model.' },
                { n: 2, t: 'Run and iterate', d: 'Open the app and test your prompt. Tweak in PromptStudio until results are good.' },
                { n: 3, t: 'Add test cases', d: 'Go to Test → add cases with expected pass/fail rules. Auto-runs before every version save.' },
                { n: 4, t: 'Deploy', d: 'Flip "Published" in Deploy. Users can now run it. Share the app link.' },
                { n: 5, t: 'List on Marketplace', d: 'Set a price in Marketplace. Stripe handles payment; entitlements are created automatically.' },
              ].map(({ n, t, d }) => (
                <li key={n} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[#6C5CE7]/20 text-[#A29BFE] text-[10px] font-bold flex items-center justify-center mt-0.5">{n}</span>
                  <div>
                    <p className="text-white text-xs font-semibold">{t}</p>
                    <p className="text-slate-500 text-[11px] leading-relaxed mt-0.5">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* 9 stages */}
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-3">The 9 lifecycle stages</p>
            <div className="space-y-3">
              {LIFECYCLE_STEPS.map(({ step, icon, label, desc }) => (
                <div key={step} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[#1F2444] text-slate-400 text-[10px] font-bold flex items-center justify-center mt-0.5">{step}</span>
                  <div>
                    <p className="text-white text-xs font-semibold">{icon} {label}</p>
                    <p className="text-slate-500 text-[11px] leading-relaxed mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* App types */}
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-3">App types</p>
            <div className="space-y-2">
              {APP_TYPES.map(({ icon, label, desc }) => (
                <div key={label} className="flex gap-2 items-start">
                  <span className="shrink-0 text-base mt-0.5">{icon}</span>
                  <div>
                    <p className="text-white text-xs font-semibold">{label}</p>
                    <p className="text-slate-500 text-[11px] leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SDK */}
          <div className="bg-[#171B33] border border-white/5 rounded-xl p-4">
            <p className="text-white text-xs font-semibold mb-2">🐍 Use from your terminal</p>
            <pre className="text-[11px] text-[#A29BFE] font-mono leading-relaxed whitespace-pre-wrap">
{`pip install aistrix
aistrix configure
aistrix apps
aistrix run <app-id> -i "your input"`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Per-tab technical notes ─────────────────────────────────────────────────

export const TAB_NOTES = {
  design: {
    color: '#6C5CE7',
    title: 'How Design works technically',
    points: [
      'Your **system prompt** is injected as the first message in every API call — it defines the AI\'s role, constraints, and output format.',
      '**App types** determine the runner: text (single prompt), data (CSV/Sheet context), chat (conversation history), agent (tool calls), multi-page (chained steps), API/webhook (headless).',
      '**Model selection** routes to Anthropic (Claude) or OpenAI (GPT-4o) via the backend `/run` endpoint with SSE streaming.',
      '**Tools** (web search, code exec, file read) are injected as function definitions into the model\'s tool-use API; results are fed back as tool-result messages automatically.',
      'Apps are stored in the `apps` table with `system_prompt`, `ai_model`, `ai_provider`, `app_type`, and metadata fields.',
    ],
  },
  test: {
    color: '#00B894',
    title: 'How Test works technically',
    points: [
      'Test cases are stored in the `app_test_cases` table: each row has a name, input text, pass/fail rules, and optional context.',
      'Each rule is evaluated with regex matching (for exact patterns) or semantic soft-matching (for meaning-based checks).',
      '**Auto-gate**: when you hit "Save version", the suite runs first — each test fires a real `/run` call with the current prompt. All pass → version saved automatically. Any fail → you see results and choose to fix or override.',
      'You can abort a running suite mid-way; each test uses an `AbortController` tied to the cancel button.',
      'Results are not stored — they are ephemeral per-run. Use the Version tab to save a snapshot after passing tests.',
    ],
  },
  deploy: {
    color: '#0984E3',
    title: 'How Deploy works technically',
    points: [
      'Setting `is_published = true` on an app row makes it visible to all authenticated users in their app list.',
      'A **share link** points to `/app/{id}` — the AppPage loads the app by ID and checks the published flag before rendering.',
      'You can restrict visibility: private (owner only), published (all users), or marketplace (public + listed).',
      '**Inbound trigger**: an app can have a secret trigger link (Deploy → Share links). POST to `/webhooks/{token}` with `{ "input": "..." }` to run the live version headlessly, on the developer\'s key and limits.',
      'The backend enforces rate limits (hourly + daily) per user, tracked in-memory with a rolling window.',
    ],
  },
  sell: {
    color: '#FDCB6E',
    title: 'How Marketplace works technically',
    points: [
      '`apps.is_paid` + `apps.price_per_run` control access. When `is_paid = true`, the runner checks `app_entitlements` before executing.',
      '**Stripe Checkout** (redirect flow): frontend calls `/create-checkout-session`, backend creates a Stripe Session and returns the URL. On return, `?checkout=success` triggers a PostHog event.',
      '**Stripe Elements** (embedded card): uses `@stripe/react-stripe-js` to collect card data client-side; `/create-payment-intent` on the backend creates the intent server-side.',
      'On payment success, the backend webhook handler (`checkout.session.completed`, `payment_intent.succeeded`) upserts a row in `app_entitlements` with plan, quota, and period dates.',
      'Subscriptions use a dynamically created recurring Stripe Price (per-app, created on first checkout). `customer.subscription.updated/deleted` events sync entitlement status.',
    ],
  },
  monitor: {
    color: '#E84393',
    title: 'Monitor → Evaluate',
    points: [
      'Choose an app and review negative feedback in Needs attention. Review run carries that app and example into Evaluate.',
      'Refresh feedback reloads the latest 500 runs you can access across your apps. Charts describe this sample, not necessarily all customer runs.',
      'Useful feedback is positive ratings divided by positive and negative ratings. Unrated runs are excluded from that percentage.',
      'Run history does not identify the published version or reliably record production failures and latency. Do not interpret these charts as a before/after release comparison.',
    ],
  },
  evaluate: {
    color: '#A29BFE',
    title: 'Evaluate → regression coverage',
    points: [
      'Inspect the recorded input, answer, and written feedback. A negative rating is an issue to investigate, not proof of its cause.',
      'Review the regression input and define a phrase the corrected answer must contain or must avoid. The observed bad answer is never used as the expected answer automatically.',
      'Save regression test stores the case in your existing Build test suite. Repeated saves preserve the existing case and its edits.',
      'Continue to Improve to plan a draft fix, or Validate in Test to reproduce the issue. Saving a case does not mean the app has passed its tests.',
    ],
  },
  improve: {
    color: '#74B9FF',
    title: 'Improve → Build → Monitor',
    points: [
      'Open draft fix in Design records the originating run and regression case in the change note. For a deployed app, confirm the reason before moving it back to Design.',
      'The live snapshot remains available while you edit. Save the draft, run Build tests, and use Deploy to publish an update through the release checks.',
      'The AI suggestion action uses the selected app prompt and its accessible negative-feedback examples. Suggestions do not change or publish the prompt automatically.',
      'After publishing, Monitor this app returns to the same app so you can collect further feedback. Marketplace is an optional distribution step after quality review.',
    ],
  },
  version: {
    color: '#55EFC4',
    title: 'How Version works technically',
    points: [
      'Versions are stored in `app_versions`: each row captures `system_prompt`, `ai_model`, `ai_provider`, `semver`, `label`, `changelog`, and a `version_num` auto-increment.',
      '**Semver bump**: you choose major/minor/patch — the new version is computed from the latest `semver` in the table using string split + increment.',
      '**Auto-test gate**: before saving, the version manager runs the full test suite (same logic as the Test tab). All pass → saved automatically. Any fail → results shown with a "Save anyway" override.',
      'Rolling back applies the selected version\'s `system_prompt`/model back to the live `apps` row — the app immediately runs the rolled-back prompt.',
      'Version history is append-only — nothing is deleted. You always have a full audit trail of every prompt + model configuration you\'ve shipped.',
    ],
  },
  monetize: {
    color: '#FD79A8',
    title: 'How Revenue works technically',
    points: [
      '**AI cost estimation**: for each run, `input_tokens × input_rate + output_tokens × output_rate` using a hard-coded model cost table (USD per 1M tokens).',
      'Cost rates are stored client-side in `MODEL_COSTS` — updated manually as provider pricing changes. Rates cover Claude (Haiku, Sonnet, Opus) and OpenAI (GPT-4o, GPT-4o-mini).',
      '**Revenue** is estimated as `price_per_run × total_run_count`. This is a projection — actual Stripe revenue depends on entitlement purchases, not run count.',
      '**Margin %** = `(revenue − cost) / revenue × 100`. A healthy paid app should be above 60% margin; below 0% means you\'re losing money per run.',
      'Token counts come from `run_history` — only runs with `input_tokens` / `output_tokens` populated are included in cost calculations. Runs without token data are excluded.',
    ],
  },
  secrets: {
    color: '#FDCB6E',
    title: 'How Secrets works technically',
    points: [
      'App secrets are encrypted by the server (`app_secrets`) and given to the app tools at run time instead of being hard-coded into prompts. Browsers only ever see their names and dates.',
      '**Secret keys** are normalized to uppercase names like `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, or `GITHUB_TOKEN` so apps can declare predictable requirements.',
      'The Secrets tab separates platform keys from app requirements: developers can save reusable keys once, then attach required secrets per app.',
      'Apps should fail with a friendly missing-secret message instead of exposing raw provider errors or secret names to end users.',
    ],
  },
}

export function TabNoteFolderTab({ id }) {
  const [open, setOpen] = useState(false)
  const note = TAB_NOTES[id]
  if (!note) return null
  const shortLabel = note.title.replace('How ', '').replace(' works technically', '').replace(' works', '')
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        title={note.title}
        className={`group h-10 min-w-[116px] max-w-[136px] overflow-hidden flex items-center gap-2 px-3 rounded-xl transition-all duration-200 active:scale-[0.98] ${open ? 'aistrix-ribbon-tab-active' : 'aistrix-ribbon-tab'}`}
        style={{
          background: open ? note.color + '22' : note.color + '0C',
          border: `1px solid ${note.color}${open ? '55' : '25'}`,
          boxShadow: open ? `0 0 26px ${note.color}33` : 'none',
        }}
      >
        <span className="w-2 h-2 rounded-full shrink-0 transition-all duration-200" style={{ background: note.color, opacity: open ? 1 : 0.75 }} />
        <span
          className="text-[11px] font-bold whitespace-nowrap truncate select-none transition-colors duration-200"
          style={{ color: open ? note.color : 'rgb(148 163 184)', lineHeight: 1 }}
        >
          {shortLabel}
        </span>
        <span className="ml-auto text-[10px]" style={{ color: open ? note.color : 'rgb(100 116 139)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Panel is anchored to this tab so it opens from the control that owns it. */}
      {open && (
        <div
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-72 rounded-2xl border p-4 space-y-3 shadow-2xl aistrix-popover-in"
          style={{ background: '#0C1120', borderColor: note.color + '40', boxShadow: `0 22px 60px rgba(0,0,0,0.45), 0 0 32px ${note.color}22` }}
        >
          <div className="absolute -top-2 right-4 h-4 w-4 rotate-45 border-l border-t" style={{ background: '#0C1120', borderColor: note.color + '40' }} />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: note.color }} />
              <p className="text-xs font-bold text-white">{note.title}</p>
            </div>
            <button aria-label="Close" onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-sm leading-none transition-colors">✕</button>
          </div>
          <ul className="space-y-2">
            {note.points.map((pt, i) => (
              <li key={i} className="flex gap-2 text-xs text-slate-300 leading-relaxed">
                <span className="shrink-0 mt-0.5 font-bold" style={{ color: note.color }}>›</span>
                <span dangerouslySetInnerHTML={{ __html: pt.replace(/\*\*(.+?)\*\*/g, `<strong class="text-white font-semibold">$1</strong>`) }} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Model cost table (USD per 1M tokens) ────────────────────────────────────
const MODEL_COSTS = {
  'gpt-4o':                  { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':             { input: 0.15,  output: 0.60  },
  'gpt-4o-2024-11-20':       { input: 2.50,  output: 10.00 },
  'claude-3-haiku-20240307': { input: 0.25,  output: 1.25  },
  'claude-haiku-4-5':        { input: 0.80,  output: 4.00  },
  'claude-3-5-haiku-20241022':{ input: 0.80, output: 4.00  },
  'claude-3-5-sonnet-20241022':{ input: 3.00,output: 15.00 },
  'claude-sonnet-4-5':       { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5-20251001':{ input: 3.00,output: 15.00 },
  'claude-sonnet-5':         { input: 3.00,  output: 15.00 },
  'claude-opus-4-5':         { input: 15.00, output: 75.00 },
  'claude-opus-5':           { input: 15.00, output: 75.00 },
}

export function modelCost(model) {
  if (!model) return null
  const exact = MODEL_COSTS[model]
  if (exact) return exact
  const key = Object.keys(MODEL_COSTS).find(k => model.includes(k) || k.includes(model))
  return key ? MODEL_COSTS[key] : null
}

// ─── Shared primitives ────────────────────────────────────────────────────────

export function StatTile({ label, value, color = '#6C5CE7', sub }) {
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 min-w-0">
      <p className="text-xs text-slate-400 mb-2">{label}</p>
      <p className="text-2xl font-bold text-white truncate">{value ?? '—'}</p>
      {sub && <p className="text-[11px] text-slate-300 mt-1">{sub}</p>}
      <div className="h-0.5 w-8 rounded-full mt-3" style={{ background: color }} />
    </div>
  )
}

export const RUNTIME_TYPES = [
  { id: 'prompt',    label: 'Prompt app',     desc: 'Single model call with generated UI' },
  { id: 'workflow',  label: 'Workflow app',   desc: 'Multi-step AI/API flow' },
  { id: 'agent',     label: 'Agent app',      desc: 'Tool-calling app with decisions' },
  { id: 'api',       label: 'API app',        desc: 'External API or headless endpoint' },
  { id: 'file',      label: 'File app',       desc: 'File upload, parsing, generated files' },
  { id: 'media',     label: 'Media app',      desc: 'Image/audio/video generation pipeline' },
  { id: 'cli',       label: 'CLI app',        desc: 'Command-line tool wrapped as an app' },
  { id: 'container', label: 'Container app',  desc: 'Dockerized GitHub or custom app' },
  { id: 'webui',     label: 'Hosted WebUI',   desc: `Full web app hosted behind ${BRAND} auth` },
]

export const COMMON_SECRET_TEMPLATES = [
  { key: 'OPENAI_API_KEY',       label: 'OpenAI API key',       provider: 'OpenAI',    required: true  },
  { key: 'ANTHROPIC_API_KEY',    label: 'Anthropic API key',    provider: 'Anthropic', required: false },
  { key: 'ELEVENLABS_API_KEY',   label: 'ElevenLabs API key',   provider: 'ElevenLabs',required: false },
  { key: 'PEXELS_API_KEY',       label: 'Pexels API key',       provider: 'Pexels',    required: false },
  { key: 'STRIPE_SECRET_KEY',    label: 'Stripe secret key',    provider: 'Stripe',    required: false },
  { key: 'GITHUB_TOKEN',         label: 'GitHub token',         provider: 'GitHub',    required: false },
]

export function validInputFields(bp) {
  return (bp.inputs || []).filter(f =>
    f?.key?.trim() &&
    /^[a-z][a-z0-9_]*$/.test(f.key.trim()) &&
    f?.label?.trim() &&
    f?.type
  )
}

export function invalidInputFields(bp) {
  return (bp.inputs || []).filter(f =>
    !f?.key?.trim() ||
    !/^[a-z][a-z0-9_]*$/.test(f.key.trim()) ||
    !f?.label?.trim() ||
    !f?.type
  )
}

// ─── Schema utilities ─────────────────────────────────────────────────────────

const SCALAR_TYPES = ['string','number','boolean','string_array','number_array','enum']
export const ALL_FIELD_TYPES = [...SCALAR_TYPES, 'object']

// Map blueprint input types → schema field types
const INPUT_TO_SCHEMA = {
  short_text: 'string', long_text: 'string', url: 'string', date: 'string',
  number: 'number', boolean: 'boolean',
  select: 'enum', multi_select: 'string_array',
  json: 'object', csv: 'string_array',
  file: 'string', image: 'string', audio: 'string', video: 'string', document: 'string',
}

export function inputsToSchema(inputs = []) {
  return inputs.map(f => ({
    field: f.key, type: INPUT_TO_SCHEMA[f.type] || 'string',
    description: f.label, required: f.required !== false,
    enum_values: f.options || [],
  }))
}

function schemaToInputFields(fields = []) {
  return fields.map(f => ({
    key: f.field || f.name || '',
    label: f.label || f.description || f.field || f.name || '',
    type: f.type === 'number' ? 'number'
      : f.type === 'boolean' ? 'boolean'
      : f.type === 'enum' ? 'select'
      : f.type === 'string_array' ? 'multi_select'
      : f.type === 'object' ? 'json'
      : 'short_text',
    required: f.required !== false,
    pii: !!f.pii,
    placeholder: f.placeholder || '',
    options: f.enum_values || [],
  }))
}

export function getInputSchemaFields(bp = {}) {
  return bp.input_schema?.fields?.length ? bp.input_schema.fields : inputsToSchema(bp.inputs || [])
}

export function getOutputSchemaFields(bp = {}) {
  return bp.output_schema?.fields?.length
    ? bp.output_schema.fields
    : bp.output_contract?.fields || bp.output_contract?.required_fields || []
}

// Migrate old blueprint shape into first-class schema objects.
export function migrateBlueprint(raw) {
  if (!raw) return raw
  const normalizeSchemaFields = fields => (fields || []).map(f => ({
    ...f,
    field: f.field || f.name || '',
    description: f.description || f.label || '',
    nested_fields: f.nested_fields?.length ? normalizeSchemaFields(f.nested_fields) : f.nested_fields,
  }))
  const oc = raw.output_contract || {}
  const outputFields = raw.output_schema?.fields?.length
    ? normalizeSchemaFields(raw.output_schema.fields)
    : normalizeSchemaFields(oc.fields || oc.required_fields || [])
  const inputFields = raw.input_schema?.fields?.length
    ? normalizeSchemaFields(raw.input_schema.fields)
    : inputsToSchema(raw.inputs || [])
  const inputs = raw.inputs?.length ? raw.inputs : schemaToInputFields(inputFields)
  return {
    ...raw,
    inputs,
    production_modules: moduleIds(raw.production_modules || []),
    deployment: normalizeDeployment(raw.deployment, raw.app || {}),
    input_schema: { type: 'object', ...(raw.input_schema || {}), fields: inputFields },
    output_schema: { type: 'object', ...(raw.output_schema || {}), fields: outputFields },
    output_contract: { ...oc, fields: outputFields, required_fields: undefined },
  }
}

function outputContractHasRules(oc = {}) {
  if (oc.format === 'json') {
    return (oc.fields || oc.required_fields || []).some(f => f?.field?.trim() && f?.type)
  }
  return !!(oc.format_rules && Object.values(oc.format_rules).some(v => {
    if (Array.isArray(v)) return v.length > 0
    return String(v || '').trim()
  }))
}

// The app's own output setting (apps.output_type) for a Design output format.
// JSON and tables are their own kinds; everything else is written text, so a
// key-value, cards or markdown app keeps its setting.
export function appOutputTypeFor(format, current) {
  if (format === 'json') return 'json'
  if (format === 'table') return 'table'
  return current === 'json' || current === 'table' ? 'markdown' : current || 'markdown'
}

export function outputContractMismatch(app, bp) {
  const contractFormat = bp?.output_contract?.format
  if (contractFormat && app?.output_type && appOutputTypeFor(contractFormat, app.output_type) !== app.output_type) {
    return { kind: 'app', appFormat: app.output_type, contractFormat }
  }
  const promptFormat = inferPromptOutputFormat(app?.system_prompt || '')
  if (!promptFormat || !contractFormat || promptFormat === contractFormat) return null
  return { promptFormat, contractFormat }
}

export const mismatchLabel = m => m.kind === 'app'
  ? `App returns ${m.appFormat === 'json' ? 'JSON' : m.appFormat}, contract is ${m.contractFormat}`
  : `Prompt expects ${m.promptFormat}, contract is ${m.contractFormat}`

export function moduleIds(raw = []) {
  return raw.map(m => typeof m === 'string' ? m : m?.id).filter(Boolean)
}

function defaultDeployment(app = {}) {
  return {
    runtime_type: app.app_type === 'api' ? 'api' : app.app_type === 'agent' ? 'agent' : isFileApp(app) ? 'file' : 'prompt',
    entrypoint: '',
    port: '',
    command: '',
    job_mode: 'sync',
    timeout_seconds: 120,
    cpu: '1',
    memory_mb: 1024,
    gpu: false,
    scale_to_zero: true,
    storage: { input_files: false, output_files: false, persistent: false, retention_days: 30 },
    outputs: [],
    secrets: [],
    cost: { estimated_model_usd: 0.02, estimated_runtime_usd: 0, estimated_storage_usd: 0 },
  }
}

export function normalizeDeployment(dep = {}, app = {}) {
  const d = { ...defaultDeployment(app), ...(dep || {}) }
  return {
    ...d,
    storage: { ...defaultDeployment(app).storage, ...(d.storage || {}) },
    cost: { ...defaultDeployment(app).cost, ...(d.cost || {}) },
    outputs: Array.isArray(d.outputs) ? d.outputs : [],
    secrets: Array.isArray(d.secrets) ? d.secrets : [],
  }
}

export function estimateMonthlyCost(dep = {}, runs = 1000) {
  const cost = normalizeDeployment(dep).cost
  const perRun = Number(cost.estimated_model_usd || 0) + Number(cost.estimated_runtime_usd || 0) + Number(cost.estimated_storage_usd || 0)
  return { perRun, monthly: perRun * runs }
}

export function isMissingBlueprintTable(error) {
  return error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.message?.includes('app_blueprints') ||
    error?.message?.includes('schema cache') ||
    error?.message?.includes('does not exist')
}

// Chatbots answer in short conversational replies: an output format is enough,
// they don't need required sections (which their replies would never contain).
export function outputRulesSatisfied(app, oc) {
  return outputContractHasRules(oc) || (app?.app_type === 'chatbot' && !!oc.format)
}

// The same rules the server applies before publishing
// (validate_app_publish_ready), checked live while editing.
const FIELD_NAME_RE = /^[a-z][a-z0-9_]*$/
export function readinessChecks(app, bp) {
  const oc = bp.output_contract || {}
  const hasValidInputs = validInputFields(bp).length > 0 && invalidInputFields(bp).length === 0
  const hasFormatRules = outputRulesSatisfied(app, oc)
  const mismatch = outputContractMismatch(app, bp)
  const outFields = getOutputSchemaFields(bp)
  const jsonFieldsOk = oc.format !== 'json' || (outFields.length > 0 && outFields.every(f => FIELD_NAME_RE.test((f.field || f.name || '').trim()) && f.type))
  return [
    { key: 'business', label: 'Business',   ok: !!(bp.business_problem?.trim() && bp.audience?.trim()) },
    { key: 'inputs',   label: 'Inputs',     ok: hasValidInputs },
    { key: 'output',   label: 'Output',     ok: !!(oc.format && hasFormatRules && !mismatch && jsonFieldsOk) },
    { key: 'prompt',   label: 'Prompt',     ok: !!(app?.system_prompt?.trim()?.length > 200) },
    { key: 'details',  label: 'Description & model', ok: !!(app?.description?.trim() && app?.ai_model && (!app?.is_paid || app?.price_per_run != null)) },
    { key: 'perms',    label: 'Permissions',ok: bp.permissions !== undefined },
  ]
}

const READINESS_WEIGHTS = { business: 15, inputs: 20, output: 20, prompt: 20, details: 15, perms: 10 }
export function calcReadiness(app, bp) {
  return readinessChecks(app, bp).reduce((s, c) => s + (c.ok ? READINESS_WEIGHTS[c.key] : 0), 0)
}

export const EMPTY_BP = {
  business_problem: '',
  audience: '',
  inputs: [],
  input_schema: { type: 'object', fields: [] },
  output_schema: { type: 'object', fields: [] },
  output_contract: { format: 'markdown', fields: [], format_rules: {} },
  ai_behavior: { tone_preset: '', refusal_rules: '', fallback_behavior: '' },
  permissions: { stores_user_data: false, requires_external_api: false, handles_sensitive_data: false },
  production_modules: [],
  deployment: defaultDeployment(),
  copilot_suggestions: {},
}

// ─── Move back from Deploy ───────────────────────────────────────────────────
// Asked whenever an app in Deploy goes back to Test or Design: says what
// happens to the live version and records why it's changing (written into the
// next published version's history).
const CHANGE_REASONS = ['Bug fix', 'Improve answers', 'New feature', 'User feedback', 'Other']

export function MoveBackModal({ app, phase, initialNote, onCancel, onConfirm }) {
  const previous = initialNote || app.change_note || {}
  const [reason, setReason] = useState(previous.reason || '')
  const [note, setNote] = useState(previous.note || '')
  const [saving, setSaving] = useState(false)
  const target = phase === 'test' ? 'Test' : 'Design'
  const live = app.is_published
  const ready = reason && note.trim().length >= 10

  async function confirm() {
    setSaving(true)
    try { await onConfirm({ reason, note: note.trim() }) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-[#141828] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div>
            <p className="text-white font-semibold text-sm">Move back to {target}?</p>
            <p className="text-slate-400 text-xs mt-0.5">{app.emoji} {app.name}</p>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-slate-500 hover:text-white text-lg leading-none px-1">×</button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3">
            {live ? (
              <>
                <p className="text-amber-200 text-sm font-semibold">{app.live_version ? `v${app.live_version}` : 'The live version'} stays live</p>
                <p className="text-slate-300 text-xs mt-1 leading-relaxed">
                  End users keep using it while you work. Your changes are a draft: they must pass the tests again before you can publish them as a new version.
                </p>
              </>
            ) : (
              <>
                <p className="text-amber-200 text-sm font-semibold">This app isn't live</p>
                <p className="text-slate-300 text-xs mt-1 leading-relaxed">Nothing changes for end users. The app will need to pass its tests again before it can be published.</p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Why are you changing it?</p>
            <div className="flex flex-wrap gap-2">
              {CHANGE_REASONS.map(r => (
                <button key={r} onClick={() => setReason(r)}
                  className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${reason === r ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-[#A29BFE]' : 'bg-white/3 border-white/8 text-slate-400 hover:text-white hover:border-white/20'}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">What will change?</p>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500}
              placeholder="e.g. Replies are too long. Shorten them and always include the order number."
              className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-[#6C5CE7]/50 resize-none" />
            <p className="text-[11px] text-slate-500">Saved with the draft and added to the next version's history.</p>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-white/8">
          <button onClick={onCancel} className="text-xs text-slate-500 hover:text-white transition-colors">Cancel</button>
          <button onClick={confirm} disabled={!ready || saving}
            className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] disabled:opacity-40 text-white transition-colors">
            {saving ? 'Moving…' : `Move to ${target}`}
          </button>
        </div>
      </div>
    </div>
  )
}
