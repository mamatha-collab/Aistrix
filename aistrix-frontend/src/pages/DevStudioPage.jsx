import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { track, EVENTS } from '../lib/analytics'
import { timeAgo } from '../utils'
import ToolsEditor from '../components/ToolsEditor'
import TestSuite from '../components/TestSuite'
import VersionManager, { useVersions, VersionSetupCard } from '../components/VersionManager'
import ApiKeysManager from '../components/ApiKeysManager'
import { scopeToWorkspace } from '../lib/workspace'

const PromptStudio = lazy(() => import('../components/PromptStudio'))
const DiffEditor   = lazy(() => import('@monaco-editor/react').then(m => ({ default: m.DiffEditor })))
const DeveloperProfileEditor = lazy(() => import('./DeveloperProfilePage').then(m => ({ default: m.DeveloperProfileEditor })))

// ─── Onboarding: what you can build ──────────────────────────────────────────

const APP_TYPES = [
  { icon: '📝', label: 'Text apps',          desc: 'Summarise, rewrite, translate, classify — any text-in / text-out task.' },
  { icon: '📊', label: 'Data apps',          desc: 'Drop in a CSV or Google Sheet and let the AI analyse, clean, or chart it.' },
  { icon: '💬', label: 'Chat / Persona',     desc: 'Conversational assistants with persistent memory and a custom personality.' },
  { icon: '🤖', label: 'Agent apps',         desc: 'Apps that call tools, search the web, run code, or read files autonomously.' },
  { icon: '📄', label: 'Document / PDF',     desc: 'Upload PDFs, ask questions, extract tables, or summarise long reports.' },
  { icon: '🔌', label: 'API / Webhook',      desc: 'Headless apps triggered by external services — Zapier, Slack, your own code.' },
  { icon: '👁', label: 'Vision / Image',     desc: 'Send images in — AI describes, OCRs, inspects quality, or reads receipts.' },
  { icon: '{ }', label: 'Structured Output', desc: 'Always returns valid JSON matching a schema — zero parsing errors.' },
  { icon: '⊞', label: 'Batch Processor',    desc: 'Run any prompt over hundreds of CSV rows in parallel — get results back.' },
  { icon: '🎙', label: 'Voice / Audio',      desc: 'Transcribe audio with Whisper, then summarise or extract action items.' },
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

const APP_MODEL_OPTIONS = {
  claude: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Best default for quality' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Fast and lower cost' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Highest reasoning cost' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', hint: 'Fast and lower cost' },
    { id: 'gpt-4o', label: 'GPT-4o', hint: 'Higher quality multimodal model' },
  ],
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
const APP_TYPE_LABELS = Object.fromEntries(Object.entries(APP_TYPE_META).map(([k,v]) => [k, v.label + ' app']))

function getAppTypeLabel(app) {
  const key = app?.app_type || app?.type
  return APP_TYPE_META[key]?.label ? APP_TYPE_META[key].label + ' app' : 'AI app'
}

function AppTypeBadge({ app, size = 'sm' }) {
  const key = app?.app_type || app?.type
  const meta = APP_TYPE_META[key] || { label: 'AI', icon: '✨', color: '#A29BFE', bg: 'rgba(108,92,231,0.15)', border: 'rgba(108,92,231,0.3)' }
  if (size === 'xs') return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap"
      style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}>
      <span className="leading-none" style={{ fontSize: 10 }}>{meta.icon}</span>
      {meta.label}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-semibold whitespace-nowrap"
      style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}>
      <span className="leading-none">{meta.icon}</span>
      {meta.label}
    </span>
  )
}

function AppTypeSup({ app }) {
  const key = app?.app_type || app?.type
  const meta = APP_TYPE_META[key] || { icon: '✨', color: '#A29BFE' }
  return (
    <sup className="mr-0.5 text-[9px] leading-none align-super" style={{ color: meta.color }}>{meta.icon}</sup>
  )
}

function AppEmojiWithType({ app, size = 'sm' }) {
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

function compactModelName(model = '') {
  if (!model) return 'No model selected'
  return model.split('-').slice(0, 4).join('-')
}

const DEV_PHASES = {
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

function normalizeDevPhase(phase) {
  return PHASE_ORDER.includes(phase) ? phase : null
}

function getDevPhase(app, phaseByAppId = {}) {
  if (normalizeDevPhase(phaseByAppId[app?.id])) return phaseByAppId[app?.id]
  if (app?.is_published) return 'deploy'
  return 'design'
}

// ─── Phase Rail ───────────────────────────────────────────────────────────────

function AppNavigator({ apps, phaseByAppId, activeAppId, activeTab, onSelectApp, onSwitchTab, onMovePhase, onCreateApp }) {
  const grouped = { design: [], test: [], deploy: [] }
  for (const a of apps) grouped[getDevPhase(a, phaseByAppId)]?.push(a)

  const PREV = { test: 'design', deploy: 'test' }
  const NEXT = { design: 'test', test: 'deploy' }
  const SECTION_LABEL = { design: 'Still Designing', test: 'Testing', deploy: 'Deployed' }
  const activeApp = apps.find(a => a.id === activeAppId)

  return (
    <div className="w-[340px] shrink-0 px-4 py-5 space-y-5">
      <div className="rounded-2xl border border-white/8 bg-[#111827] p-4 space-y-4">
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
                      onClick={() => { onSelectApp(a.id); onSwitchTab(phase) }}
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

function WelcomeScreen({ onCreateApp }) {
  return (
    <div className="space-y-8 pb-10">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#6C5CE7]/20 to-[#0E1424] border border-[#6C5CE7]/20 rounded-2xl p-8 text-center">
        <div className="text-5xl mb-3">🧩</div>
        <h2 className="text-2xl font-bold text-white mb-2">Welcome to Aistrix Dev Studio</h2>
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

function HelpPanel({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-[#0E1424] border-l border-white/5 h-full overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[#0E1424]/95 backdrop-blur-sm px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <p className="text-white font-semibold text-sm">Developer Guide</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none transition-colors">×</button>
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

const TAB_NOTES = {
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
      '**Webhook trigger**: each app can have a unique webhook token stored in `apps.webhook_token`. POST to `/webhooks/{token}` with `{ "input": "..." }` to trigger a run headlessly.',
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
    title: 'How Monitor works technically',
    points: [
      'Run data is pulled from `run_history` — every run inserts a row with `app_id`, `user_id`, `created_at`, `input_tokens`, `output_tokens`, `rating_value`, `input`, and `output`.',
      'The **30-day volume chart** is computed client-side: runs are bucketed by day using `Math.round((today - runDate) / 86400000)`.',
      '**Token usage** is reported by the AI provider in the SSE stream\'s `done` event and written to `run_history` at end of each run.',
      '**Feedback** is stored as `rating_value` in `run_history` (with `rating_type` and optional `feedback_text`): `1` = 👍 thumbs-up, `-1` = 👎 thumbs-down, `null` = no feedback given.',
      '**Entitlement stats** are loaded from `app_entitlements` — subscriber counts, active vs cancelled, plan types — all fetched in parallel with run history on studio load.',
    ],
  },
  evaluate: {
    color: '#A29BFE',
    title: 'How Evaluate works technically',
    points: [
      'Quality scores are computed per-app from `run_history`: satisfaction = 👍 count / total rated runs; health = weighted score across satisfaction (60%), volume (20%), published (10%), verified (10%).',
      'The **health score (0–100)** is a composite: high satisfaction + high volume + published + verified badge all contribute.',
      'Run history rows include the full `input` and `output` text, so you can inspect what was sent and received for any run.',
      'Failed or low-rated runs are surfaced in the failure list — click any row to see the exact prompt input and output that produced the bad result.',
      'Quality signals feed back into the marketplace listing: apps above thresholds get "Verified" and "Top Rated" trust badges via the `update_app_badges` Supabase RPC.',
    ],
  },
  improve: {
    color: '#74B9FF',
    title: 'How Improve works technically',
    points: [
      '**A/B prompt diffing**: select two saved versions (from `app_versions`) and run the same input through both using separate `/run` SSE calls fired in parallel.',
      'Each call streams independently — outputs appear side-by-side in real time as tokens arrive.',
      'The **diff view** (powered by Monaco DiffEditor) shows character-level changes between two version prompts so you can see exactly what changed.',
      '**AI suggestions**: fires a `/run` call with a meta-prompt that asks Claude to review the current system prompt and suggest improvements based on recent failure patterns.',
      'GitHub integration stores a `gh_token` + `gh_repo` in `developer_settings` (jsonb). Low-rated runs can be filed as GitHub issues via the GitHub REST API (`POST /repos/{owner}/{repo}/issues`).',
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
      'Developer secrets are stored in `developer_settings` and referenced by app blueprints at runtime instead of hard-coded into prompts.',
      '**Secret keys** are normalized to uppercase names like `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, or `GITHUB_TOKEN` so apps can declare predictable requirements.',
      'The Secrets tab separates platform keys from app requirements: developers can save reusable keys once, then attach required secrets per app.',
      'Production hardening should move raw secret values behind a server-side vault or service-role-only storage layer before external customer launch.',
      'Apps should fail with a friendly missing-secret message instead of exposing raw provider errors or secret names to end users.',
    ],
  },
}

function TabNote({ id }) {
  const [open, setOpen] = useState(false)
  const note = TAB_NOTES[id]
  if (!note) return null
  const shortLabel = note.title.replace('How ', '').replace(' works technically', '').replace(' works', '')

  return (
    <div className="flex items-start gap-0 h-full">
      {/* Vertical tile — click to toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex flex-col items-center justify-start gap-3 pt-5 w-9 shrink-0 h-full transition-colors rounded-l-xl ${open ? 'bg-white/5' : 'hover:bg-white/4'}`}
        title={open ? 'Close' : note.title}
      >
        {/* Accent bar */}
        <div className="w-[3px] rounded-full transition-all duration-200" style={{ background: note.color, height: open ? 48 : 28, opacity: open ? 1 : 0.7 }} />
        {/* Rotated label */}
        <span
          className="text-[11px] font-semibold whitespace-nowrap select-none"
          style={{ writingMode: 'vertical-rl', color: open ? note.color : 'rgb(148 163 184)', letterSpacing: '0.06em' }}
        >
          {shortLabel}
        </span>
        {/* Chevron hint */}
        <span className="text-[9px] transition-colors" style={{ color: open ? note.color : 'rgb(100 116 139)' }}>
          {open ? '›' : '‹'}
        </span>
      </button>

      {/* Panel — only visible when open */}
      {open && (
        <div
          className="w-64 rounded-r-2xl rounded-bl-2xl border p-4 space-y-3"
          style={{ background: note.color + '0D', borderColor: note.color + '30' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: note.color }} />
              <p className="text-xs font-bold text-white">{note.title}</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-sm leading-none transition-colors">✕</button>
          </div>
          <ul className="space-y-2">
            {note.points.map((pt, i) => (
              <li key={i} className="flex gap-2 text-xs text-slate-300 leading-relaxed">
                <span className="shrink-0 mt-0.5 font-bold" style={{ color: note.color }}>›</span>
                {/* Safe: pt is a developer-authored constant, never user input */}
                <span dangerouslySetInnerHTML={{ __html: pt.replace(/\*\*(.+?)\*\*/g, `<strong class="text-white font-semibold">$1</strong>`) }} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function TabNoteBar({ id }) {
  const [open, setOpen] = useState(false)
  const note = TAB_NOTES[id]
  if (!note) return null
  return (
    <div className="border-b border-white/5">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/4 transition-colors text-left"
      >
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: note.color }} />
        <span className="text-xs font-semibold flex-1 truncate" style={{ color: note.color }}>{note.title}</span>
        <span className="text-slate-500 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          <ul className="space-y-2">
            {note.points.map((pt, i) => (
              <li key={i} className="flex gap-2 text-[11px] text-slate-300 leading-relaxed">
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

function TabNoteFolderTab({ id }) {
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
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-sm leading-none transition-colors">✕</button>
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

function modelCost(model) {
  if (!model) return null
  const exact = MODEL_COSTS[model]
  if (exact) return exact
  const key = Object.keys(MODEL_COSTS).find(k => model.includes(k) || k.includes(model))
  return key ? MODEL_COSTS[key] : null
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function StatTile({ label, value, color = '#6C5CE7', sub }) {
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 min-w-0">
      <p className="text-xs text-slate-400 mb-2">{label}</p>
      <p className="text-2xl font-bold text-white truncate">{value ?? '—'}</p>
      {sub && <p className="text-[11px] text-slate-300 mt-1">{sub}</p>}
      <div className="h-0.5 w-8 rounded-full mt-3" style={{ background: color }} />
    </div>
  )
}

function ComingSoonCard({ icon, title, desc, bullets }) {
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-6 flex flex-col gap-3">
      <div className="text-3xl">{icon}</div>
      <div>
        <p className="text-white font-semibold">{title}</p>
        <p className="text-slate-400 text-sm mt-1 leading-relaxed">{desc}</p>
      </div>
      {bullets?.length > 0 && (
        <ul className="space-y-1.5">
          {bullets.map(b => (
            <li key={b} className="flex items-start gap-2 text-[12px] text-slate-400">
              <span className="text-[#6C5CE7] mt-0.5 shrink-0">◈</span>{b}
            </li>
          ))}
        </ul>
      )}
      <span className="self-start text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#6C5CE7]/15 text-[#A29BFE] border border-[#6C5CE7]/25 mt-1">
        Coming soon
      </span>
    </div>
  )
}

// ─── Tab: Design — Aistrix Blueprint Studio ──────────────────────────────────

const INPUT_TYPES = ['short_text','long_text','number','select','multi_select','file','image','audio','video','document','url','date','boolean','json','csv']

const RUNTIME_TYPES = [
  { id: 'prompt',    label: 'Prompt app',     desc: 'Single model call with generated UI' },
  { id: 'workflow',  label: 'Workflow app',   desc: 'Multi-step AI/API flow' },
  { id: 'agent',     label: 'Agent app',      desc: 'Tool-calling app with decisions' },
  { id: 'api',       label: 'API app',        desc: 'External API or headless endpoint' },
  { id: 'file',      label: 'File app',       desc: 'File upload, parsing, generated files' },
  { id: 'media',     label: 'Media app',      desc: 'Image/audio/video generation pipeline' },
  { id: 'cli',       label: 'CLI app',        desc: 'Command-line tool wrapped as an app' },
  { id: 'container', label: 'Container app',  desc: 'Dockerized GitHub or custom app' },
  { id: 'webui',     label: 'Hosted WebUI',   desc: 'Full web app hosted behind Aistrix auth' },
]

const COMMON_SECRET_TEMPLATES = [
  { key: 'OPENAI_API_KEY',       label: 'OpenAI API key',       provider: 'OpenAI',    required: true  },
  { key: 'ANTHROPIC_API_KEY',    label: 'Anthropic API key',    provider: 'Anthropic', required: false },
  { key: 'ELEVENLABS_API_KEY',   label: 'ElevenLabs API key',   provider: 'ElevenLabs',required: false },
  { key: 'PEXELS_API_KEY',       label: 'Pexels API key',       provider: 'Pexels',    required: false },
  { key: 'STRIPE_SECRET_KEY',    label: 'Stripe secret key',    provider: 'Stripe',    required: false },
  { key: 'GITHUB_TOKEN',         label: 'GitHub token',         provider: 'GitHub',    required: false },
]

const OUTPUT_FORMATS = [
  { id: 'markdown',  label: 'Markdown report' },
  { id: 'json',      label: 'JSON object' },
  { id: 'table',     label: 'Table' },
  { id: 'email',     label: 'Email draft' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'decision',  label: 'Decision memo' },
  { id: 'document',  label: 'Multi-section document' },
]

const AI_PRESETS = [
  { id: 'business_analyst',    label: 'Business analyst',    hint: 'Analytical, structured, data-driven. Uses tables and numbered findings.' },
  { id: 'recruiting_assistant',label: 'Recruiting assistant',hint: 'Objective, concise. Scores candidates and provides clear recommendations.' },
  { id: 'sales_operator',      label: 'Sales operator',      hint: 'Persuasive but accurate. Surfaces opportunities and objections clearly.' },
  { id: 'support_triage',      label: 'Support triage',      hint: 'Empathetic, efficient. Categorises issues and suggests resolutions.' },
  { id: 'research_analyst',    label: 'Research analyst',    hint: 'Thorough, cited, impartial. Synthesises sources into clear summaries.' },
  { id: 'legal_admin',         label: 'Legal admin',         hint: 'Precise, cautious. Flags risks and avoids giving legal advice.' },
  { id: 'developer_assistant', label: 'Developer assistant', hint: 'Technical, direct. Writes correct code and explains reasoning.' },
]

function validInputFields(bp) {
  return (bp.inputs || []).filter(f =>
    f?.key?.trim() &&
    /^[a-z][a-z0-9_]*$/.test(f.key.trim()) &&
    f?.label?.trim() &&
    f?.type
  )
}

function invalidInputFields(bp) {
  return (bp.inputs || []).filter(f =>
    !f?.key?.trim() ||
    !/^[a-z][a-z0-9_]*$/.test(f.key.trim()) ||
    !f?.label?.trim() ||
    !f?.type
  )
}

// ─── Schema utilities ─────────────────────────────────────────────────────────

const SCALAR_TYPES = ['string','number','boolean','string_array','number_array','enum']
const ALL_FIELD_TYPES = [...SCALAR_TYPES, 'object']

// Map blueprint input types → schema field types
const INPUT_TO_SCHEMA = {
  short_text: 'string', long_text: 'string', url: 'string', date: 'string',
  number: 'number', boolean: 'boolean',
  select: 'enum', multi_select: 'string_array',
  json: 'object', csv: 'string_array',
  file: 'string', image: 'string', audio: 'string', video: 'string', document: 'string',
}

function inputsToSchema(inputs = []) {
  return inputs.map(f => ({
    field: f.key, type: INPUT_TO_SCHEMA[f.type] || 'string',
    description: f.label, required: f.required !== false,
    enum_values: f.options || [],
  }))
}

function schemaToInputFields(fields = []) {
  return fields.map(f => ({
    key: f.field || '',
    label: f.description || f.field || '',
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

function getInputSchemaFields(bp = {}) {
  return bp.input_schema?.fields?.length ? bp.input_schema.fields : inputsToSchema(bp.inputs || [])
}

function getOutputSchemaFields(bp = {}) {
  return bp.output_schema?.fields?.length
    ? bp.output_schema.fields
    : bp.output_contract?.fields || bp.output_contract?.required_fields || []
}

// Recursive Zod code-gen
function schemaToZod(fields = [], indent = 0) {
  const pad = '  '.repeat(indent)
  const lines = fields.map(f => {
    let zodType
    switch (f.type) {
      case 'string':       zodType = 'z.string()'; break
      case 'number':       zodType = 'z.number()'; break
      case 'boolean':      zodType = 'z.boolean()'; break
      case 'string_array': zodType = 'z.array(z.string())'; break
      case 'number_array': zodType = 'z.array(z.number())'; break
      case 'enum':
        zodType = f.enum_values?.length
          ? `z.enum([${f.enum_values.map(v => JSON.stringify(v)).join(', ')}])`
          : 'z.string()'
        break
      case 'object': {
        if (f.nested_fields?.length) {
          const inner = schemaToZod(f.nested_fields, indent + 1)
          zodType = `z.object({\n${inner}\n${pad}  })`
        } else {
          zodType = 'z.record(z.unknown())'
        }
        break
      }
      default: zodType = 'z.unknown()'
    }
    if (f.required === false) zodType += '.optional()'
    const comment = f.description ? `  // ${f.description}` : ''
    return `${pad}  ${f.field}: ${zodType},${comment}`
  })
  return lines.join('\n')
}

function buildZodExport(inputFields, outputFields) {
  const inputBody  = schemaToZod(inputFields)
  const outputBody = schemaToZod(outputFields)
  return `import { z } from "zod"\n\nexport const InputSchema = z.object({\n${inputBody}\n})\n\nexport const OutputSchema = z.object({\n${outputBody}\n})\n\nexport type Input  = z.infer<typeof InputSchema>\nexport type Output = z.infer<typeof OutputSchema>`
}

// Recursive TypeScript interface gen
function schemaToTs(fields = [], indent = 0) {
  const pad = '  '.repeat(indent)
  return fields.map(f => {
    let tsType
    switch (f.type) {
      case 'string':       tsType = 'string'; break
      case 'number':       tsType = 'number'; break
      case 'boolean':      tsType = 'boolean'; break
      case 'string_array': tsType = 'string[]'; break
      case 'number_array': tsType = 'number[]'; break
      case 'enum':
        tsType = f.enum_values?.length ? f.enum_values.map(v => `"${v}"`).join(' | ') : 'string'
        break
      case 'object':
        if (f.nested_fields?.length) {
          tsType = `{\n${schemaToTs(f.nested_fields, indent + 1)}\n${pad}  }`
        } else {
          tsType = 'Record<string, unknown>'
        }
        break
      default: tsType = 'unknown'
    }
    const opt = f.required === false ? '?' : ''
    const comment = f.description ? `  // ${f.description}` : ''
    return `${pad}  ${f.field}${opt}: ${tsType};${comment}`
  }).join('\n')
}

function buildTsExport(inputFields, outputFields) {
  return `export interface Input {\n${schemaToTs(inputFields)}\n}\n\nexport interface Output {\n${schemaToTs(outputFields)}\n}`
}

function schemaToJsonSchema(fields = []) {
  const properties = {}
  const required = []
  fields.forEach(f => {
    if (!f?.field) return
    let prop
    switch (f.type) {
      case 'number':
        prop = { type: 'number' }
        break
      case 'boolean':
        prop = { type: 'boolean' }
        break
      case 'string_array':
        prop = { type: 'array', items: { type: 'string' } }
        break
      case 'number_array':
        prop = { type: 'array', items: { type: 'number' } }
        break
      case 'enum':
        prop = f.enum_values?.length ? { type: 'string', enum: f.enum_values } : { type: 'string' }
        break
      case 'object':
        prop = f.nested_fields?.length
          ? schemaToJsonSchema(f.nested_fields)
          : { type: 'object', additionalProperties: true }
        break
      default:
        prop = { type: 'string' }
    }
    if (f.description) prop.description = f.description
    properties[f.field] = prop
    if (f.required !== false) required.push(f.field)
  })
  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length ? { required } : {}),
  }
}

function buildJsonSchemaExport(inputFields, outputFields) {
  return JSON.stringify({
    input_schema: schemaToJsonSchema(inputFields),
    output_schema: schemaToJsonSchema(outputFields),
  }, null, 2)
}

// Migrate old blueprint shape into first-class schema objects.
function migrateBlueprint(raw) {
  if (!raw) return raw
  const oc = raw.output_contract || {}
  const outputFields = raw.output_schema?.fields?.length
    ? raw.output_schema.fields
    : oc.fields || oc.required_fields || []
  const inputFields = raw.input_schema?.fields?.length
    ? raw.input_schema.fields
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

function inferPromptOutputFormat(prompt = '') {
  const text = prompt.toLowerCase()
  if (/valid json|json object|return only the json|only the json|strict json/.test(text)) return 'json'
  if (/markdown|##|###/.test(text)) return 'markdown'
  if (/table|columns|csv/.test(text)) return 'table'
  if (/email|subject line|draft reply/.test(text)) return 'email'
  if (/checklist|check list|action items/.test(text)) return 'checklist'
  return null
}

function outputContractMismatch(app, bp) {
  const promptFormat = inferPromptOutputFormat(app?.system_prompt || '')
  const contractFormat = bp?.output_contract?.format
  if (!promptFormat || !contractFormat || promptFormat === contractFormat) return null
  return { promptFormat, contractFormat }
}

const PRODUCTION_MODULES = [
  {
    id: 'topic_input',
    name: 'Topic/Input App',
    icon: '⌨️',
    group: 'Input',
    what: 'Collects topic, keyword, language, duration, style, and output format.',
    tech: ['Form schema', 'presets', 'validation'],
    aistrix: 'available',
    effort: 'Now',
  },
  {
    id: 'script_generator',
    name: 'Script Generator',
    icon: '✍️',
    group: 'AI brain',
    what: 'Generates or rewrites the short-video script.',
    tech: ['LLM prompt', 'model selector', 'structured output'],
    aistrix: 'available',
    effort: 'Now',
  },
  {
    id: 'scene_planner',
    name: 'Scene Planner',
    icon: '🎬',
    group: 'AI brain',
    what: 'Splits the script into scenes, shots, keywords, and timing.',
    tech: ['JSON schema', 'agent step', 'workflow step'],
    aistrix: 'partial',
    effort: 'Easy',
  },
  {
    id: 'stock_media',
    name: 'Stock Media Search',
    icon: '🖼️',
    group: 'Media',
    what: 'Finds footage/images from providers like Pexels, Pixabay, or Coverr.',
    tech: ['API connectors', 'thumbnail gallery', 'license metadata'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'ai_video',
    name: 'AI Video Generator',
    icon: '🎞️',
    group: 'Media',
    what: 'Creates new video clips from scene prompts.',
    tech: ['async API polling', 'job status', 'object storage'],
    aistrix: 'missing',
    effort: 'Medium-hard',
  },
  {
    id: 'ai_image',
    name: 'AI Image Generator',
    icon: '🌄',
    group: 'Media',
    what: 'Creates images and optionally animates them into clips.',
    tech: ['image API', 'file storage', 'image-to-video step'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'uploaded_media',
    name: 'Uploaded Media',
    icon: '📁',
    group: 'Media',
    what: 'Lets users provide their own images, video, audio, and files.',
    tech: ['file upload', 'object storage', 'preview', 'permissions'],
    aistrix: 'partial',
    effort: 'High priority',
  },
  {
    id: 'tts',
    name: 'Voiceover/TTS',
    icon: '🎙️',
    group: 'Audio',
    what: 'Turns script text into narration.',
    tech: ['TTS connectors', 'voice picker', 'audio preview'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'voice_preview',
    name: 'Voice Preview',
    icon: '🔊',
    group: 'Audio',
    what: 'Lets users audition voices before running a full job.',
    tech: ['voice catalog', 'sample generation', 'audio player'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'subtitles',
    name: 'Subtitle Generator',
    icon: '💬',
    group: 'Captions',
    what: 'Creates timed captions from script or audio.',
    tech: ['Whisper/API transcription', 'timestamps', 'SRT/VTT output'],
    aistrix: 'missing',
    effort: 'Medium-hard',
  },
  {
    id: 'subtitle_style',
    name: 'Subtitle Style Editor',
    icon: '🎨',
    group: 'Captions',
    what: 'Controls subtitle font, size, color, outline, and position.',
    tech: ['caption style UI', 'ASS/SRT/VTT renderer', 'preview'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'music',
    name: 'Background Music',
    icon: '🎵',
    group: 'Audio',
    what: 'Adds random, uploaded, or AI-generated music with volume control.',
    tech: ['audio library', 'music API', 'mixing'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'video_composer',
    name: 'Video Composer',
    icon: '🧵',
    group: 'Render',
    what: 'Combines clips, voiceover, subtitles, and music into one video.',
    tech: ['FFmpeg', 'MoviePy/Remotion', 'worker runtime'],
    aistrix: 'missing',
    effort: 'Hard',
  },
  {
    id: 'render_job',
    name: 'Render Job Runner',
    icon: '⏳',
    group: 'Runtime',
    what: 'Runs slow generation jobs with progress, retries, and cancellation.',
    tech: ['queue', 'workers', 'status events', 'timeouts'],
    aistrix: 'partial',
    effort: 'High priority',
  },
  {
    id: 'export',
    name: 'Video Export',
    icon: '📤',
    group: 'Output',
    what: 'Exports 9:16, 16:9, or 1:1 final videos.',
    tech: ['render profiles', 'storage', 'download links'],
    aistrix: 'missing',
    effort: 'Medium-hard',
  },
  {
    id: 'batch',
    name: 'Batch Variants',
    icon: '🔁',
    group: 'Runtime',
    what: 'Generates multiple variants and compares outputs.',
    tech: ['batch queue', 'variant metadata', 'comparison UI'],
    aistrix: 'partial',
    effort: 'Medium',
  },
  {
    id: 'task_history',
    name: 'Task History',
    icon: '🕓',
    group: 'Operate',
    what: 'Shows prior jobs, outputs, settings, and failures.',
    tech: ['run history', 'output records', 'file metadata'],
    aistrix: 'partial',
    effort: 'Easy-medium',
  },
  {
    id: 'api_keys',
    name: 'Settings/API Keys',
    icon: '🔐',
    group: 'Operate',
    what: 'Stores provider keys for models, media, TTS, and publishing.',
    tech: ['secrets vault', 'provider config', 'BYOK'],
    aistrix: 'partial',
    effort: 'Medium',
  },
  {
    id: 'preset_import',
    name: 'Preset Import/Export',
    icon: '🧾',
    group: 'Operate',
    what: 'Imports or exports generation settings safely.',
    tech: ['JSON config', 'secret redaction', 'preset versioning'],
    aistrix: 'missing',
    effort: 'Easy-medium',
  },
  {
    id: 'webui',
    name: 'Hosted WebUI',
    icon: '🖥️',
    group: 'Runtime',
    what: 'Hosts a full external WebUI inside Aistrix.',
    tech: ['reverse proxy', 'auth wrapper', 'sandbox routing'],
    aistrix: 'missing',
    effort: 'Hard',
  },
  {
    id: 'api_service',
    name: 'API Service',
    icon: '🔌',
    group: 'Runtime',
    what: 'Exposes generation through authenticated API endpoints.',
    tech: ['API gateway', 'rate limits', 'job endpoint'],
    aistrix: 'partial',
    effort: 'Medium',
  },
  {
    id: 'cli',
    name: 'CLI App Wrapper',
    icon: '⌘',
    group: 'Runtime',
    what: 'Maps form inputs to command-line args and captures outputs.',
    tech: ['command wrapper', 'arg mapper', 'output capture'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'container',
    name: 'Docker/Container App',
    icon: '📦',
    group: 'Runtime',
    what: 'Runs a full GitHub app without local install.',
    tech: ['Docker build', 'env vars', 'ports', 'logs', 'scale-to-zero'],
    aistrix: 'missing',
    effort: 'Hard',
  },
  {
    id: 'publisher',
    name: 'Social Publisher',
    icon: '🚀',
    group: 'Publish',
    what: 'Publishes finished videos to YouTube Shorts, TikTok, or Instagram.',
    tech: ['OAuth', 'social APIs', 'publish queue', 'scheduler'],
    aistrix: 'missing',
    effort: 'Later',
  },
]

const SHORT_VIDEO_MODULE_TEMPLATE = [
  'topic_input', 'script_generator', 'scene_planner', 'stock_media', 'uploaded_media',
  'tts', 'voice_preview', 'subtitles', 'subtitle_style', 'music', 'video_composer',
  'render_job', 'export', 'batch', 'task_history', 'api_keys',
]

function moduleStatus(module) {
  if (module.aistrix === 'available') return { label: 'Available', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' }
  if (module.aistrix === 'partial') return { label: 'Partial', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20' }
  return { label: 'Needed', cls: 'bg-slate-500/10 text-slate-400 border-white/10' }
}

function moduleIds(raw = []) {
  return raw.map(m => typeof m === 'string' ? m : m?.id).filter(Boolean)
}

function defaultDeployment(app = {}) {
  return {
    runtime_type: app.app_type === 'api' ? 'api' : app.app_type === 'agent' ? 'agent' : app.app_type === 'data' ? 'file' : 'prompt',
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

function normalizeDeployment(dep = {}, app = {}) {
  const d = { ...defaultDeployment(app), ...(dep || {}) }
  return {
    ...d,
    storage: { ...defaultDeployment(app).storage, ...(d.storage || {}) },
    cost: { ...defaultDeployment(app).cost, ...(d.cost || {}) },
    outputs: Array.isArray(d.outputs) ? d.outputs : [],
    secrets: Array.isArray(d.secrets) ? d.secrets : [],
  }
}

function estimateMonthlyCost(dep = {}, runs = 1000) {
  const cost = normalizeDeployment(dep).cost
  const perRun = Number(cost.estimated_model_usd || 0) + Number(cost.estimated_runtime_usd || 0) + Number(cost.estimated_storage_usd || 0)
  return { perRun, monthly: perRun * runs }
}

function yamlValue(value, indent = 0) {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return value.map(v => `${pad}- ${typeof v === 'object' && v !== null ? `\n${yamlObject(v, indent + 1)}` : scalarYaml(v)}`).join('\n')
  }
  if (typeof value === 'object' && value !== null) return `\n${yamlObject(value, indent + 1)}`
  return scalarYaml(value)
}

function scalarYaml(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (value === null || value === undefined || value === '') return '""'
  return JSON.stringify(String(value))
}

function yamlObject(obj = {}, indent = 0) {
  const pad = '  '.repeat(indent)
  return Object.entries(obj).map(([key, value]) => `${pad}${key}: ${yamlValue(value, indent)}`).join('\n')
}

function buildAistrixManifest(app, bp) {
  const deployment = normalizeDeployment(bp.deployment, app)
  return {
    name: app.name,
    app_id: app.id,
    runtime: {
      type: deployment.runtime_type,
      entrypoint: deployment.entrypoint || undefined,
      command: deployment.command || undefined,
      port: deployment.port || undefined,
    },
    resources: {
      cpu: deployment.cpu,
      memory_mb: Number(deployment.memory_mb || 0),
      gpu: !!deployment.gpu,
      scale_to_zero: !!deployment.scale_to_zero,
    },
    jobs: {
      mode: deployment.job_mode,
      timeout_seconds: Number(deployment.timeout_seconds || 0),
    },
    storage: deployment.storage,
    secrets: deployment.secrets.map(s => ({ key: s.key, provider: s.provider || '', required: s.required !== false })),
    inputs: bp.inputs || [],
    outputs: deployment.outputs,
    production_modules: moduleIds(bp.production_modules || []),
  }
}

function isMissingBlueprintTable(error) {
  return error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.message?.includes('app_blueprints') ||
    error?.message?.includes('schema cache') ||
    error?.message?.includes('does not exist')
}

function readinessChecks(app, bp) {
  const oc = bp.output_contract || {}
  const hasValidInputs = validInputFields(bp).length > 0 && invalidInputFields(bp).length === 0
  const hasFormatRules = outputContractHasRules(oc)
  const mismatch = outputContractMismatch(app, bp)
  return [
    { key: 'business', label: 'Business',   ok: !!(bp.business_problem?.trim() && bp.audience?.trim()) },
    { key: 'inputs',   label: 'Inputs',     ok: hasValidInputs },
    { key: 'output',   label: 'Output',     ok: !!(oc.format && hasFormatRules && !mismatch) },
    { key: 'prompt',   label: 'Prompt',     ok: !!(app?.system_prompt?.length > 200) },
    { key: 'perms',    label: 'Permissions',ok: bp.permissions !== undefined },
  ]
}

function calcReadiness(app, bp) {
  const checks = readinessChecks(app, bp)
  const weights = { business: 20, inputs: 20, output: 25, prompt: 25, perms: 10 }
  return checks.reduce((s, c) => s + (c.ok ? weights[c.key] : 0), 0)
}

function ReadinessBar({ app, bp }) {
  const checks = readinessChecks(app, bp)
  const score  = checks.reduce((s, c) => {
    const weights = { business: 20, inputs: 20, output: 25, prompt: 25, perms: 10 }
    return s + (c.ok ? weights[c.key] : 0)
  }, 0)
  const color = score >= 70 ? '#00B894' : score >= 40 ? '#FDCB6E' : '#E84393'
  const label = score >= 70 ? 'Ready to test' : score >= 40 ? 'Needs work' : 'Incomplete'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white">Design Readiness</span>
        <span className="text-xs font-bold" style={{ color }}>{score}/100 — {label}</span>
      </div>
      <div className="h-2 bg-[#0E1424] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, background: color }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
        {checks.map(({ key, label, ok }) => (
          <div key={key} className="flex items-center gap-1">
            <span className={`text-xs ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{ok ? '✓' : '○'}</span>
            <span className={`text-xs ${ok ? 'text-slate-400' : 'text-slate-500'}`}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Design → Test handoff card
function DesignTestHandoff({ app, bp, isDirty, saving, onSave, onGoToTest }) {
  const oc = bp?.output_contract || {}
  const validInputs = validInputFields(bp)
  const invalidInputs = invalidInputFields(bp)
  const hasFormatRules = outputContractHasRules(oc)
  const mismatch = outputContractMismatch(app, bp)

  const items = [
    {
      ok: validInputs.length > 0 && invalidInputs.length === 0,
      label: invalidInputs.length > 0
        ? `${invalidInputs.length} input field${invalidInputs.length !== 1 ? 's' : ''} need key + label`
        : `${validInputs.length} valid input field${validInputs.length !== 1 ? 's' : ''} defined`,
    },
    {
      ok: hasFormatRules && !mismatch,
      label: mismatch
        ? `Prompt expects ${mismatch.promptFormat}, contract is ${mismatch.contractFormat}`
        : oc.format ? `Output contract: ${oc.format}${hasFormatRules ? ' ✓' : ' — rules missing'}` : 'No output format chosen',
    },
    { ok: !!app?.system_prompt?.trim(),label: app?.system_prompt?.trim() ? 'System prompt written' : 'System prompt missing' },
    { ok: bp?.ai_behavior?.fallback_behavior?.trim(), label: bp?.ai_behavior?.fallback_behavior?.trim() ? 'Fallback behavior set' : 'No fallback behavior defined' },
  ]
  const ready = items.filter(i => i.ok).length
  const total = items.length
  const allGood = ready === total

  return (
    <div className={`border rounded-2xl p-5 space-y-3 ${allGood ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-[#171B33] border-white/5'}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-white uppercase tracking-wider">Design → Test readiness</p>
        <span className={`text-xs font-bold ${allGood ? 'text-emerald-400' : 'text-slate-500'}`}>{ready}/{total} ready</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={`text-sm shrink-0 mt-px ${item.ok ? 'text-emerald-400' : 'text-red-400'}`}>{item.ok ? '✓' : '○'}</span>
            <span className={`text-xs min-w-0 break-words ${item.ok ? 'text-slate-300' : 'text-slate-500'}`}>{item.label}</span>
          </div>
        ))}
      </div>
      {allGood && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-emerald-400">
            {isDirty ? 'All checks passed — save before generating tests.' : 'All checks passed — generate blueprint tests next.'}
          </p>
          {isDirty ? (
            <button onClick={onSave} disabled={saving}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/25 transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : 'Save before testing'}
            </button>
          ) : (
            <button onClick={onGoToTest}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/25 transition-colors">
              Generate tests →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ProductionModulePlanner({ app, bp, setBp }) {
  const selectedIds = moduleIds(bp.production_modules || [])
  const selected = new Set(selectedIds)
  const selectedModules = PRODUCTION_MODULES.filter(m => selected.has(m.id))
  const missing = selectedModules.filter(m => m.aistrix === 'missing')
  const partial = selectedModules.filter(m => m.aistrix === 'partial')
  const available = selectedModules.filter(m => m.aistrix === 'available')
  const groups = [...new Set(PRODUCTION_MODULES.map(m => m.group))]

  function toggle(id) {
    const next = selected.has(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id]
    setBp({ ...bp, production_modules: next })
  }

  function applyShortVideoTemplate() {
    const modules = [...new Set([...selectedIds, ...SHORT_VIDEO_MODULE_TEMPLATE])]
    const existingInputs = bp.inputs || []
    const existingKeys = new Set(existingInputs.map(f => f.key))
    const recommendedInputs = [
      { key: 'topic', label: 'Video topic or keyword', type: 'short_text', required: true, pii: false, placeholder: 'e.g. 5 ways AI helps real estate agents' },
      { key: 'language', label: 'Language', type: 'select', required: true, pii: false, options: ['English', 'Spanish', 'Hindi'], placeholder: 'English' },
      { key: 'aspect_ratio', label: 'Aspect ratio', type: 'select', required: true, pii: false, options: ['9:16', '16:9', '1:1'], placeholder: '9:16' },
      { key: 'voice_style', label: 'Voice style', type: 'short_text', required: false, pii: false, placeholder: 'Energetic, calm, documentary, sales' },
      { key: 'source_media', label: 'Optional uploaded media', type: 'file', required: false, pii: false, placeholder: 'Upload images, clips, or audio' },
    ].filter(f => !existingKeys.has(f.key))
    const inputs = [...existingInputs, ...recommendedInputs]
    const outputFields = [
      { field: 'status', type: 'enum', required: true, description: 'Job status', enum_values: ['queued', 'running', 'completed', 'failed'] },
      { field: 'video_url', type: 'string', required: true, description: 'Final rendered video URL' },
      { field: 'subtitles_url', type: 'string', required: false, description: 'Caption file URL when generated' },
      { field: 'metadata', type: 'object', required: false, description: 'Render metadata', nested_fields: [
        { field: 'duration_seconds', type: 'number', required: false, description: 'Final video duration' },
        { field: 'aspect_ratio', type: 'string', required: false, description: 'Rendered aspect ratio' },
        { field: 'estimated_cost_usd', type: 'number', required: false, description: 'Estimated generation cost' },
      ] },
    ]
    setBp({
      ...bp,
      business_problem: bp.business_problem || 'Generate short-form marketing or social videos from a topic without requiring local video-production software.',
      audience: bp.audience || 'Creators, marketers, agencies, recruiters, realtors, and small businesses that need repeatable short-video production.',
      inputs,
      input_schema: { ...(bp.input_schema || {}), type: 'object', fields: inputsToSchema(inputs) },
      output_schema: { ...(bp.output_schema || {}), type: 'object', fields: outputFields },
      output_contract: { ...(bp.output_contract || {}), format: 'json', fields: outputFields },
      permissions: { ...(bp.permissions || {}), requires_external_api: true, stores_user_data: true },
      production_modules: modules,
      deployment: normalizeDeployment({
        ...(bp.deployment || {}),
        runtime_type: 'media',
        job_mode: 'async',
        timeout_seconds: 900,
        cpu: '2',
        memory_mb: 4096,
        gpu: false,
        storage: { input_files: true, output_files: true, persistent: true, retention_days: 30 },
        outputs: [
          { path: 'final_video.mp4', type: 'video', required: true },
          { path: 'captions.srt', type: 'subtitle', required: false },
        ],
        secrets: [
          { key: 'OPENAI_API_KEY', label: 'OpenAI API key', provider: 'OpenAI', required: true },
          { key: 'PEXELS_API_KEY', label: 'Pexels API key', provider: 'Pexels', required: false },
          { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API key', provider: 'ElevenLabs', required: false },
        ],
        cost: { estimated_model_usd: 0.08, estimated_runtime_usd: 0.12, estimated_storage_usd: 0.01 },
      }, app),
    })
  }

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-white uppercase tracking-wider">Production Modules</p>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            Design compound AI apps as smaller modules: script, media, voice, subtitles, render jobs, container runtime, and publishing.
          </p>
        </div>
        <button onClick={applyShortVideoTemplate}
          className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors shrink-0">
          Apply short-video template
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-3">
          <p className="text-lg font-bold text-emerald-300">{available.length}</p>
          <p className="text-[10px] text-slate-500 uppercase font-semibold">Available now</p>
        </div>
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-3">
          <p className="text-lg font-bold text-amber-300">{partial.length}</p>
          <p className="text-[10px] text-slate-500 uppercase font-semibold">Partial in Aistrix</p>
        </div>
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-3">
          <p className="text-lg font-bold text-slate-300">{missing.length}</p>
          <p className="text-[10px] text-slate-500 uppercase font-semibold">Needs platform work</p>
        </div>
      </div>

      <div className="space-y-4">
        {groups.map(group => (
          <div key={group} className="space-y-2">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{group}</p>
            <div className="grid md:grid-cols-2 gap-2">
              {PRODUCTION_MODULES.filter(m => m.group === group).map(m => {
                const active = selected.has(m.id)
                const status = moduleStatus(m)
                return (
                  <button key={m.id} onClick={() => toggle(m.id)}
                    className={`text-left rounded-xl border p-3 transition-all ${active ? 'bg-[#6C5CE7]/10 border-[#6C5CE7]/35' : 'bg-[#0E1424] border-white/5 hover:border-white/15'}`}>
                    <div className="flex items-start gap-3">
                      <span className="text-lg shrink-0">{m.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-semibold text-white">{m.name}</p>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${status.cls}`}>{status.label}</span>
                          <span className="text-[9px] text-slate-600">{m.effort}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed mt-1">{m.what}</p>
                        <p className="text-[10px] text-slate-600 mt-1">{m.tech.join(' · ')}</p>
                      </div>
                      <span className={`text-sm shrink-0 ${active ? 'text-[#A29BFE]' : 'text-slate-700'}`}>{active ? '✓' : '○'}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {selectedModules.length > 0 && (
        <div className="bg-[#0A0E1A] border border-white/5 rounded-xl p-4 space-y-2">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Selected technical plan</p>
          <div className="flex flex-wrap gap-2">
            {selectedModules.map(m => {
              const status = moduleStatus(m)
              return (
                <span key={m.id} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${status.cls}`}>
                  {m.icon} {m.name}
                </span>
              )
            })}
          </div>
          {missing.length > 0 && (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              This design needs new Aistrix platform primitives before full production: {missing.map(m => m.name).join(', ')}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DeploymentBlueprintPanel({ app, bp, setBp }) {
  const deployment = normalizeDeployment(bp.deployment, app)
  const [manifestTab, setManifestTab] = useState('yaml')
  const [copied, setCopied] = useState(false)
  const estimate = estimateMonthlyCost(deployment, 1000)
  const manifest = buildAistrixManifest(app, { ...bp, deployment })
  const manifestText = manifestTab === 'json'
    ? JSON.stringify(manifest, null, 2)
    : yamlObject(manifest)

  function updateDeployment(patch) {
    setBp({ ...bp, deployment: normalizeDeployment({ ...deployment, ...patch }, app) })
  }
  function updateStorage(patch) {
    updateDeployment({ storage: { ...deployment.storage, ...patch } })
  }
  function updateCost(patch) {
    updateDeployment({ cost: { ...deployment.cost, ...patch } })
  }
  function addSecret(template = {}) {
    const existing = new Set((deployment.secrets || []).map(s => s.key))
    const next = template.key && !existing.has(template.key)
      ? template
      : { key: '', label: '', provider: '', required: true }
    updateDeployment({ secrets: [...deployment.secrets, next] })
  }
  function updateSecret(i, patch) {
    updateDeployment({ secrets: deployment.secrets.map((s, idx) => idx === i ? { ...s, ...patch } : s) })
  }
  function removeSecret(i) {
    updateDeployment({ secrets: deployment.secrets.filter((_, idx) => idx !== i) })
  }
  function addOutput() {
    updateDeployment({ outputs: [...deployment.outputs, { path: '', type: 'file', required: true }] })
  }
  function updateOutput(i, patch) {
    updateDeployment({ outputs: deployment.outputs.map((o, idx) => idx === i ? { ...o, ...patch } : o) })
  }
  function removeOutput(i) {
    updateDeployment({ outputs: deployment.outputs.filter((_, idx) => idx !== i) })
  }
  async function copyManifest() {
    try {
      await navigator.clipboard.writeText(manifestText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (_) {}
  }
  function downloadManifest() {
    const ext = manifestTab === 'json' ? 'json' : 'yaml'
    const blob = new Blob([manifestText], { type: manifestTab === 'json' ? 'application/json' : 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aistrix.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-white uppercase tracking-wider">Deployment Blueprint</p>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            Define how this app will run after Design: runtime, jobs, files, secrets, resources, and deploy manifest.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-slate-500 uppercase font-semibold">Estimated cost</p>
          <p className="text-sm font-bold text-white">${estimate.perRun.toFixed(3)} / run</p>
          <p className="text-[10px] text-slate-500">${estimate.monthly.toFixed(0)} / 1k runs</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Runtime type</p>
        <div className="grid md:grid-cols-3 gap-2">
          {RUNTIME_TYPES.map(rt => {
            const active = deployment.runtime_type === rt.id
            return (
              <button key={rt.id} onClick={() => updateDeployment({ runtime_type: rt.id })}
                className={`text-left rounded-xl border p-3 transition-all ${active ? 'bg-[#6C5CE7]/10 border-[#6C5CE7]/40' : 'bg-[#0E1424] border-white/5 hover:border-white/15'}`}>
                <p className={`text-xs font-semibold ${active ? 'text-[#A29BFE]' : 'text-white'}`}>{rt.label}</p>
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{rt.desc}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Runtime details</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Entrypoint</label>
              <input value={deployment.entrypoint || ''} onChange={e => updateDeployment({ entrypoint: e.target.value })}
                placeholder="app/main.py or index.js"
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Port</label>
              <input value={deployment.port || ''} onChange={e => updateDeployment({ port: e.target.value })}
                placeholder="8000"
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[9px] text-slate-600 uppercase font-semibold">Command</label>
            <input value={deployment.command || ''} onChange={e => updateDeployment({ command: e.target.value })}
              placeholder="uv run python main.py --topic {{topic}}"
              className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Job mode</label>
              <select value={deployment.job_mode} onChange={e => updateDeployment({ job_mode: e.target.value })}
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40">
                <option value="sync">sync</option>
                <option value="async">async</option>
                <option value="scheduled">scheduled</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Timeout seconds</label>
              <input type="number" min="1" value={deployment.timeout_seconds || 0} onChange={e => updateDeployment({ timeout_seconds: Number(e.target.value) })}
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
            </div>
          </div>
        </div>

        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Resources & storage</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">CPU</label>
              <input value={deployment.cpu || '1'} onChange={e => updateDeployment({ cpu: e.target.value })}
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Memory MB</label>
              <input type="number" min="128" value={deployment.memory_mb || 1024} onChange={e => updateDeployment({ memory_mb: Number(e.target.value) })}
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
            </div>
            <label className="flex items-end gap-2 pb-1.5 cursor-pointer">
              <input type="checkbox" checked={!!deployment.gpu} onChange={e => updateDeployment({ gpu: e.target.checked })}
                className="w-3 h-3 accent-[#6C5CE7]" />
              <span className="text-[10px] text-slate-400">GPU</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['input_files', 'Input files'],
              ['output_files', 'Output files'],
              ['persistent', 'Persistent storage'],
              ['scale_to_zero', 'Scale to zero'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer bg-[#171B33] border border-white/5 rounded-lg px-3 py-2">
                <input type="checkbox"
                  checked={key === 'scale_to_zero' ? !!deployment.scale_to_zero : !!deployment.storage?.[key]}
                  onChange={e => key === 'scale_to_zero' ? updateDeployment({ scale_to_zero: e.target.checked }) : updateStorage({ [key]: e.target.checked })}
                  className="w-3 h-3 accent-[#6C5CE7]" />
                <span className="text-[10px] text-slate-400">{label}</span>
              </label>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-[9px] text-slate-600 uppercase font-semibold">Retention days</label>
            <input type="number" min="1" value={deployment.storage?.retention_days || 30} onChange={e => updateStorage({ retention_days: Number(e.target.value) })}
              className="w-32 bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Required secrets</p>
            <button onClick={() => addSecret()} className="text-[10px] text-[#A29BFE] hover:text-white transition-colors">+ Add secret</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_SECRET_TEMPLATES.map(t => (
              <button key={t.key} onClick={() => addSecret(t)}
                className="text-[10px] px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 transition-colors">
                {t.key}
              </button>
            ))}
          </div>
          {!deployment.secrets.length ? (
            <p className="text-[11px] text-slate-500 py-2">No secrets required yet.</p>
          ) : (
            <div className="space-y-2">
              {deployment.secrets.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                  <input value={s.key || ''} onChange={e => updateSecret(i, { key: e.target.value.replace(/\s+/g, '_').toUpperCase() })}
                    placeholder="API_KEY"
                    className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none font-mono" />
                  <input value={s.provider || ''} onChange={e => updateSecret(i, { provider: e.target.value })}
                    placeholder="Provider"
                    className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none" />
                  <label className="flex items-center gap-1 text-[10px] text-slate-500">
                    <input type="checkbox" checked={s.required !== false} onChange={e => updateSecret(i, { required: e.target.checked })}
                      className="w-3 h-3 accent-[#6C5CE7]" />
                    Required
                  </label>
                  <button onClick={() => removeSecret(i)} className="text-slate-600 hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Output files</p>
            <button onClick={addOutput} className="text-[10px] text-[#A29BFE] hover:text-white transition-colors">+ Add output</button>
          </div>
          {!deployment.outputs.length ? (
            <p className="text-[11px] text-slate-500 py-2">No output files declared. Prompt-only apps may not need this.</p>
          ) : (
            <div className="space-y-2">
              {deployment.outputs.map((o, i) => (
                <div key={i} className="grid grid-cols-[1fr_110px_auto_auto] gap-2 items-center">
                  <input value={o.path || ''} onChange={e => updateOutput(i, { path: e.target.value })}
                    placeholder="final_video.mp4"
                    className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none font-mono" />
                  <select value={o.type || 'file'} onChange={e => updateOutput(i, { type: e.target.value })}
                    className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none">
                    {['file','json','image','audio','video','subtitle','document'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-slate-500">
                    <input type="checkbox" checked={o.required !== false} onChange={e => updateOutput(i, { required: e.target.checked })}
                      className="w-3 h-3 accent-[#6C5CE7]" />
                    Required
                  </label>
                  <button onClick={() => removeOutput(i)} className="text-slate-600 hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#0A0E1A] border border-[#6C5CE7]/15 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] text-[#A29BFE] uppercase font-bold tracking-wider">Aistrix manifest</p>
            <p className="text-[11px] text-slate-500">Portable deployment definition generated from this Design blueprint.</p>
          </div>
          <div className="flex items-center gap-2">
            {['yaml','json'].map(t => (
              <button key={t} onClick={() => setManifestTab(t)}
                className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${manifestTab === t ? 'bg-[#6C5CE7]/20 text-[#A29BFE]' : 'text-slate-600 hover:text-slate-400'}`}>
                {t.toUpperCase()}
              </button>
            ))}
            <button onClick={copyManifest} className="text-[10px] text-slate-500 hover:text-[#A29BFE] transition-colors font-semibold">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={downloadManifest} className="text-[10px] text-slate-500 hover:text-[#A29BFE] transition-colors font-semibold">
              Export
            </button>
          </div>
        </div>
        <pre className="text-[10px] font-mono text-slate-400 overflow-x-auto leading-relaxed max-h-72 whitespace-pre">{manifestText}</pre>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          ['Model/API', 'estimated_model_usd'],
          ['Runtime', 'estimated_runtime_usd'],
          ['Storage', 'estimated_storage_usd'],
        ].map(([label, key]) => (
          <div key={key} className="bg-[#0E1424] border border-white/5 rounded-xl p-3 space-y-1">
            <label className="text-[9px] text-slate-600 uppercase font-semibold">{label} cost/run</label>
            <input type="number" min="0" step="0.001" value={deployment.cost?.[key] ?? 0}
              onChange={e => updateCost({ [key]: Number(e.target.value) })}
              className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
          </div>
        ))}
      </div>
    </div>
  )
}

// Reusable comma-separated list editor for format rules
function FormatRulesEditor({ label, hint, rulesKey, bp, setBp }) {
  const val = bp.output_contract?.format_rules?.[rulesKey] || ''
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{label}</label>
      <input value={val}
        onChange={e => setBp({ ...bp, output_contract: { ...bp.output_contract, format_rules: { ...(bp.output_contract?.format_rules || {}), [rulesKey]: e.target.value } } })}
        placeholder={hint}
        className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
      <p className="text-[10px] text-slate-400">Comma-separated values</p>
    </div>
  )
}

const EMPTY_BP = {
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

const APP_BLUEPRINTS_SQL = `-- Aistrix Developer Studio: App Blueprints
-- Run this in the Supabase SQL editor, then refresh the app.

create table if not exists public.app_blueprints (
  app_id uuid primary key references public.apps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  blueprint jsonb not null default '{}'::jsonb,
  readiness_score integer not null default 0 check (readiness_score >= 0 and readiness_score <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_blueprints_user_id_idx
  on public.app_blueprints(user_id);

alter table public.app_blueprints enable row level security;

drop policy if exists "Developers can read own app blueprints" on public.app_blueprints;
drop policy if exists "Developers can insert own app blueprints" on public.app_blueprints;
drop policy if exists "Developers can update own app blueprints" on public.app_blueprints;
drop policy if exists "Developers can delete own app blueprints" on public.app_blueprints;

create policy "Developers can read own app blueprints"
  on public.app_blueprints
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );

create policy "Developers can insert own app blueprints"
  on public.app_blueprints
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );

create policy "Developers can update own app blueprints"
  on public.app_blueprints
  for update
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );

create policy "Developers can delete own app blueprints"
  on public.app_blueprints
  for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );`

function BlueprintEditor({ app, user, onAppUpdated, onOpenPromptStudio, onGoToTest }) {
  const toast   = useToast()
  const [bp, setBp]           = useState(null)   // null = loading
  const [savedBp, setSavedBp] = useState(null)
  const [bpProd, setBpProd]   = useState(null)   // last promoted snapshot
  const [tableNeeded, setTableNeeded] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [savingModel, setSavingModel] = useState(false)
  const [copilot, setCopilot] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copilotOutput, setCopilotOutput] = useState('')
  const [copilotSuggestions, setCopilotSuggestions] = useState(null)
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

  useEffect(() => { loadBlueprint() }, [app.id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadBlueprint() {
    const { data, error } = await supabase.from('app_blueprints')
      .select('blueprint, blueprint_prod').eq('app_id', app.id).maybeSingle()
    if (error?.code === '42703' || error?.message?.includes('blueprint_prod')) {
      // blueprint_prod column not added yet — fall back to blueprint only
      const { data: d2, error: e2 } = await supabase.from('app_blueprints')
        .select('blueprint').eq('app_id', app.id).maybeSingle()
      if (isMissingBlueprintTable(e2)) { setTableNeeded(true); return }
      const raw2 = d2?.blueprint ? { ...EMPTY_BP, ...d2.blueprint } : { ...EMPTY_BP }
      const next2 = migrateBlueprint(raw2)
      setBp(next2); setSavedBp(next2)
      return
    }
    if (isMissingBlueprintTable(error)) { setTableNeeded(true); return }
    const raw  = data?.blueprint ? { ...EMPTY_BP, ...data.blueprint } : { ...EMPTY_BP }
    const next = migrateBlueprint(raw)
    setBp(next)
    setSavedBp(next)
    if (data?.blueprint_prod) setBpProd(migrateBlueprint({ ...EMPTY_BP, ...data.blueprint_prod }))
  }

  async function save(next) {
    setSaving(true)
    const normalized = migrateBlueprint(next)
    const score = calcReadiness(app, normalized)
    const { error } = await supabase.from('app_blueprints').upsert(
      { app_id: app.id, user_id: user.id, blueprint: normalized, readiness_score: score, updated_at: new Date().toISOString() },
      { onConflict: 'app_id' }
    )
    if (!error && app.is_published) {
      const { error: dcErr } = await supabase.from('apps').update({ has_draft_changes: true }).eq('id', app.id)
      if (!dcErr) onAppUpdated?.({ ...app, has_draft_changes: true })
    }
    setSaving(false)
    if (isMissingBlueprintTable(error)) {
      setTableNeeded(true)
      toast('Blueprint table is not set up yet', 'error')
      return false
    }
    if (error) { toast(error.message, 'error'); return false }
    setBp(normalized)
    setSavedBp(normalized)
    toast('Blueprint saved', 'success', 2000)
    return true
  }

  function update(patch) {
    setBp(p => ({ ...p, ...patch }))
  }

  async function updateAppModel(patch) {
    const nextProvider = patch.ai_provider || app.ai_provider || 'claude'
    const firstModel = APP_MODEL_OPTIONS[nextProvider]?.[0]?.id
    const next = {
      ai_provider: nextProvider,
      ai_model: patch.ai_model || (patch.ai_provider ? firstModel : app.ai_model || firstModel),
    }
    setSavingModel(true)
    const { error } = await supabase.from('apps').update(next).eq('id', app.id)
    setSavingModel(false)
    if (error) { toast(error.message, 'error'); return }
    onAppUpdated?.({ ...app, ...next })
    toast('Model settings saved', 'success', 2000)
  }

  // ── Input schema helpers ──
  function addInput() {
    const inputs = [...(bp.inputs || []), { key: '', label: '', type: 'short_text', required: true, pii: false, placeholder: '' }]
    setBp({ ...bp, inputs, input_schema: { ...(bp.input_schema || {}), type: 'object', fields: inputsToSchema(inputs) } })
  }
  function updateInput(i, patch) {
    const inputs = bp.inputs.map((f, idx) => idx === i ? { ...f, ...patch } : f)
    setBp({ ...bp, inputs, input_schema: { ...(bp.input_schema || {}), type: 'object', fields: inputsToSchema(inputs) } })
  }
  function removeInput(i) {
    const inputs = bp.inputs.filter((_, idx) => idx !== i)
    setBp({ ...bp, inputs, input_schema: { ...(bp.input_schema || {}), type: 'object', fields: inputsToSchema(inputs) } })
  }

  // ── Output schema helpers ──
  function ocFields() { return getOutputSchemaFields(bp) }
  function setOcFields(fields) {
    setBp({
      ...bp,
      output_schema: { ...(bp.output_schema || {}), type: 'object', fields },
      output_contract: { ...bp.output_contract, fields },
    })
  }
  function addField() { setOcFields([...ocFields(), { field: '', type: 'string', description: '', required: true }]) }
  function updateField(i, patch) { setOcFields(ocFields().map((f, idx) => idx === i ? { ...f, ...patch } : f)) }
  function removeField(i) { setOcFields(ocFields().filter((_, idx) => idx !== i)) }
  function addNestedField(i) {
    const f = ocFields()[i]
    updateField(i, { nested_fields: [...(f.nested_fields || []), { field: '', type: 'string', description: '', required: true }] })
  }
  function updateNestedField(i, j, patch) {
    const f = ocFields()[i]
    updateField(i, { nested_fields: f.nested_fields.map((nf, idx) => idx === j ? { ...nf, ...patch } : nf) })
  }
  function removeNestedField(i, j) {
    const f = ocFields()[i]
    updateField(i, { nested_fields: f.nested_fields.filter((_, idx) => idx !== j) })
  }

  // ── Copilot ──
  async function generateBlueprint() {
    if (!copilot.trim()) return
    setGenerating(true)
    setCopilotOutput('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const systemPrompt = `You are an AI app design assistant for the Aistrix platform. Given a developer's app idea, return a JSON blueprint with these exact keys: business_problem, audience, inputs (array of {key, label, type, required, pii}), input_schema ({type:"object", fields:[{field,type,required,description,enum_values?}]}), output_contract ({format, fields: [{field, type, required, description, enum_values?, nested_fields?}]}), output_schema ({type:"object", fields:[{field,type,required,description,enum_values?,nested_fields?}]}), production_modules (array of ids from this list when relevant: ${PRODUCTION_MODULES.map(m => m.id).join(', ')}), system_prompt_hint, marketplace_tagline. Be concise and practical. Return ONLY valid JSON, no markdown fences.`
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ app_id: null, input: copilot, system_prompt: systemPrompt, ai_provider: 'claude', ai_model: null }),
      })
      if (!res.ok) throw new Error('Copilot request failed')
      const reader = res.body.getReader(); const decoder = new TextDecoder()
      let buf = ''; let raw = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try { const d = JSON.parse(line.slice(6)); if (d.token) { raw += d.token; setCopilotOutput(raw) } } catch (_) {}
        }
      }
      // Try to parse and apply
      try {
        const parsed = JSON.parse(raw.trim())
        const next = {
          ...bp,
          business_problem: parsed.business_problem || bp.business_problem,
          audience:          parsed.audience          || bp.audience,
          inputs:            parsed.inputs?.length    ? parsed.inputs : bp.inputs,
          input_schema:      parsed.input_schema      || bp.input_schema,
          output_contract:   parsed.output_contract   || bp.output_contract,
          output_schema:     parsed.output_schema     || bp.output_schema,
          production_modules: parsed.production_modules?.length ? moduleIds(parsed.production_modules) : bp.production_modules,
        }
        setBp(migrateBlueprint(next))
        // Surface extra suggestions (not auto-applied)
        const extras = {}
        if (parsed.system_prompt_hint)  extras.system_prompt_hint  = parsed.system_prompt_hint
        if (parsed.marketplace_tagline) extras.marketplace_tagline = parsed.marketplace_tagline
        if (Object.keys(extras).length) setCopilotSuggestions(extras)
        toast('Blueprint generated — review and save', 'success', 4000)
      } catch (_) {
        toast('Generated — copy from preview below', 'info', 3000)
      }
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  if (tableNeeded) return (
    <div className="bg-[#171B33] border border-amber-500/20 rounded-2xl p-6 space-y-3">
      <p className="text-amber-300 font-semibold text-sm">⚠️ Blueprint table not set up</p>
      <p className="text-slate-300 text-xs leading-relaxed">
        The frontend can read and write blueprints after the table exists, but it cannot create Supabase tables with the public anon key.
        Run <code className="bg-[#0E1424] px-1.5 py-0.5 rounded text-amber-300">supabase_app_blueprints.sql</code> in your Supabase SQL editor to enable the Blueprint Studio.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(APP_BLUEPRINTS_SQL)
            toast('Blueprint SQL copied', 'success', 2000)
          }}
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors"
        >
          Copy SQL
        </button>
        <button onClick={loadBlueprint} className="text-xs font-semibold px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors">
          Retry after running SQL
        </button>
      </div>
      <details className="text-[10px] text-slate-500">
        <summary className="cursor-pointer hover:text-slate-300">Preview SQL</summary>
        <pre className="mt-2 max-h-64 overflow-auto bg-[#0E1424] border border-white/5 rounded-xl p-3 text-slate-400 whitespace-pre-wrap">{APP_BLUEPRINTS_SQL}</pre>
      </details>
    </div>
  )

  if (!bp) return <p className="text-slate-500 text-sm py-6 text-center">Loading blueprint…</p>

  const isDirty = !!savedBp && JSON.stringify(bp) !== JSON.stringify(savedBp)
  const mismatch = outputContractMismatch(app, bp)
  const invalidInputs = invalidInputFields(bp)
  const openPromptStudio = () => onOpenPromptStudio(app)

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: (app.color || '#6C5CE7') + '33' }}>
            <AppEmojiWithType app={app} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-white font-semibold text-sm">{app.name}</p>
            </div>
            <p className="text-[10px] text-slate-500">Edit inputs, output contract, prompt behavior, and permissions</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[10px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
              Unsaved changes
            </span>
          )}
          <button onClick={openPromptStudio}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
            ✏️ Prompt Studio
          </button>
          <button onClick={() => save(bp)} disabled={saving}
            className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
            {saving ? 'Saving…' : 'Save blueprint'}
          </button>
        </div>
      </div>

      {/* Readiness */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
        <ReadinessBar app={app} bp={bp} />
      </div>

      {(mismatch || invalidInputs.length > 0) && (
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Blueprint validation</p>
          {mismatch && (
            <p className="text-xs text-slate-300">
              Your prompt appears to require <span className="text-amber-200 font-semibold">{mismatch.promptFormat}</span>, but the output contract is set to <span className="text-amber-200 font-semibold">{mismatch.contractFormat}</span>. Align these before testing.
            </p>
          )}
          {invalidInputs.length > 0 && (
            <p className="text-xs text-slate-300">
              {invalidInputs.length} input field{invalidInputs.length !== 1 ? 's' : ''} need a valid key, label, and type before Aistrix can generate reliable UI, API params, and tests.
            </p>
          )}
        </div>
      )}

      {/* Copilot */}
      <div className="bg-[#171B33] border border-[#6C5CE7]/20 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-semibold text-[#A29BFE] uppercase tracking-wider">✦ Aistrix Copilot</p>
        <p className="text-[11px] text-slate-300">Describe your app idea and Copilot will fill the blueprint for you.</p>
        <div className="flex gap-2">
          <input value={copilot} onChange={e => setCopilot(e.target.value)}
            placeholder="e.g. An AI app that screens resumes for recruiters…"
            className="flex-1 bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40"
            onKeyDown={e => e.key === 'Enter' && generateBlueprint()}
          />
          <button onClick={generateBlueprint} disabled={!copilot.trim() || generating}
            className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40 shrink-0">
            {generating ? '…' : 'Generate →'}
          </button>
        </div>
        {copilotOutput && !generating && (
          <details className="text-[10px] text-slate-400">
            <summary className="cursor-pointer hover:text-slate-400">View raw output</summary>
            <pre className="mt-2 bg-[#0E1424] rounded-lg p-3 overflow-x-auto text-slate-300 leading-relaxed whitespace-pre-wrap">{copilotOutput}</pre>
          </details>
        )}
        {copilotSuggestions && (
          <div className="bg-[#0E1424] border border-[#6C5CE7]/20 rounded-xl p-4 space-y-2">
            <p className="text-[10px] font-semibold text-[#A29BFE] uppercase tracking-wider">Copilot suggestions — review before applying</p>
            {copilotSuggestions.system_prompt_hint && (
              <div className="space-y-1">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">Prompt hint</p>
                <p className="text-xs text-slate-300 leading-relaxed">{copilotSuggestions.system_prompt_hint}</p>
                <button onClick={openPromptStudio} className="text-[11px] text-[#A29BFE] hover:underline">Apply in Prompt Studio →</button>
              </div>
            )}
            {copilotSuggestions.marketplace_tagline && (
              <div className="space-y-1">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">Marketplace tagline</p>
                <p className="text-xs text-slate-300">{copilotSuggestions.marketplace_tagline}</p>
                <p className="text-[10px] text-slate-400">Use this when submitting to the Marketplace.</p>
              </div>
            )}
            <button onClick={() => setCopilotSuggestions(null)} className="text-[10px] text-slate-400 hover:text-slate-400 transition-colors">Dismiss</button>
          </div>
        )}
      </div>

      {/* Input Schema */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-white uppercase tracking-wider">Input Schema</p>
          <button onClick={addInput}
            className="text-xs font-semibold px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors">
            + Add field
          </button>
        </div>
        {!bp.inputs?.length ? (
          <p className="text-[11px] text-slate-400 text-center py-3">No inputs defined yet. Add fields to auto-generate the app UI, API params, and test cases.</p>
        ) : (
          <div className="space-y-2">
            {bp.inputs.map((field, i) => (
              <div key={i} className="bg-[#0E1424] border border-white/5 rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  <div className="space-y-0.5">
                    <label className="text-[9px] text-slate-600 uppercase font-semibold">Key</label>
                    <input value={field.key} onChange={e => updateInput(i, { key: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                      placeholder="job_description"
                      className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[9px] text-slate-600 uppercase font-semibold">Label</label>
                    <input value={field.label} onChange={e => updateInput(i, { label: e.target.value })}
                      placeholder="Job Description"
                      className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[9px] text-slate-600 uppercase font-semibold">Type</label>
                    <select value={field.type} onChange={e => updateInput(i, { type: e.target.value })}
                      className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40">
                      {INPUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex items-center gap-1.5 pb-1.5">
                      <input type="checkbox" id={`req-${i}`} checked={field.required} onChange={e => updateInput(i, { required: e.target.checked })}
                        className="w-3 h-3 accent-[#6C5CE7]" />
                      <label htmlFor={`req-${i}`} className="text-[10px] text-slate-400">Required</label>
                    </div>
                    <div className="flex items-center gap-1.5 pb-1.5">
                      <input type="checkbox" id={`pii-${i}`} checked={field.pii} onChange={e => updateInput(i, { pii: e.target.checked })}
                        className="w-3 h-3 accent-amber-500" />
                      <label htmlFor={`pii-${i}`} className="text-[10px] text-slate-400">PII</label>
                    </div>
                    <button onClick={() => removeInput(i)} className="text-slate-600 hover:text-red-400 transition-colors text-xs pb-1.5 ml-auto">✕</button>
                  </div>
                </div>
                <input value={field.placeholder || ''} onChange={e => updateInput(i, { placeholder: e.target.value })}
                  placeholder="Placeholder hint for this field…"
                  className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Output Contract */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-bold text-white uppercase tracking-wider">Output Contract</p>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Output format</label>
          <div className="flex flex-wrap gap-2">
            {OUTPUT_FORMATS.map(f => (
              <button key={f.id} onClick={() => setBp({ ...bp, output_contract: { ...bp.output_contract, format: f.id } })}
                className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${bp.output_contract?.format === f.id ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-[#A29BFE]' : 'bg-white/3 border-white/8 text-slate-500 hover:text-white hover:border-white/20'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* JSON: output schema fields */}
        {bp.output_contract?.format === 'json' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Output schema</label>
              <button onClick={addField}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors">
                + Add field
              </button>
            </div>
            {!ocFields().length ? (
              <p className="text-[11px] text-slate-400 text-center py-2">No fields — add at least one for schema validation.</p>
            ) : (
              <div className="space-y-1.5">
                {ocFields().map((f, i) => (
                  <SchemaFieldRow key={i}
                    f={f} depth={0}
                    onChange={patch => updateField(i, patch)}
                    onRemove={() => removeField(i)}
                    onAddNested={() => addNestedField(i)}
                    onChangeNested={(j, patch) => updateNestedField(i, j, patch)}
                    onRemoveNested={j => removeNestedField(i, j)}
                  />
                ))}
              </div>
            )}

            {/* Schema export panel */}
            {ocFields().length > 0 && (
              <SchemaExportPanel inputFields={getInputSchemaFields(bp)} outputFields={getOutputSchemaFields(bp)} />
            )}
          </div>
        )}

        {/* Markdown: required sections */}
        {bp.output_contract?.format === 'markdown' && (
          <FormatRulesEditor
            label="Required sections"
            hint="e.g. Summary, Findings, Recommendations"
            rulesKey="sections"
            bp={bp} setBp={setBp}
          />
        )}

        {/* Table: required columns */}
        {bp.output_contract?.format === 'table' && (
          <FormatRulesEditor
            label="Required columns"
            hint="e.g. Name, Score, Recommendation"
            rulesKey="columns"
            bp={bp} setBp={setBp}
          />
        )}

        {/* Email: subject / tone / required parts */}
        {bp.output_contract?.format === 'email' && (
          <div className="space-y-2">
            {[
              { key: 'subject_hint',  label: 'Subject line hint',  ph: 'e.g. "[Action required] {{topic}}"' },
              { key: 'tone',          label: 'Tone',               ph: 'e.g. Professional and concise' },
              { key: 'required_parts',label: 'Required parts',     ph: 'e.g. Greeting, Context, Ask, Sign-off' },
            ].map(({ key, label, ph }) => (
              <div key={key} className="space-y-0.5">
                <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{label}</label>
                <input value={bp.output_contract?.format_rules?.[key] || ''}
                  onChange={e => setBp({ ...bp, output_contract: { ...bp.output_contract, format_rules: { ...(bp.output_contract.format_rules || {}), [key]: e.target.value } } })}
                  placeholder={ph}
                  className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
              </div>
            ))}
          </div>
        )}

        {/* Checklist: minimum items */}
        {bp.output_contract?.format === 'checklist' && (
          <div className="space-y-2">
            <FormatRulesEditor label="Required item categories" hint="e.g. Completed, Pending, Blocked" rulesKey="categories" bp={bp} setBp={setBp} />
            <div className="space-y-0.5">
              <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Minimum items</label>
              <input type="number" min={1} value={bp.output_contract?.format_rules?.min_items || ''}
                onChange={e => setBp({ ...bp, output_contract: { ...bp.output_contract, format_rules: { ...(bp.output_contract.format_rules || {}), min_items: e.target.value } } })}
                placeholder="e.g. 3"
                className="w-32 bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
            </div>
          </div>
        )}

        {/* Scorecard: score range + required dimensions */}
        {bp.output_contract?.format === 'scorecard' && (
          <div className="space-y-2">
            <FormatRulesEditor label="Scored dimensions" hint="e.g. Relevance, Clarity, Completeness" rulesKey="dimensions" bp={bp} setBp={setBp} />
            <div className="flex gap-3">
              {[['min_score','Min score','0'],['max_score','Max score','100']].map(([key, label, ph]) => (
                <div key={key} className="space-y-0.5 flex-1">
                  <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{label}</label>
                  <input type="number" value={bp.output_contract?.format_rules?.[key] || ''}
                    onChange={e => setBp({ ...bp, output_contract: { ...bp.output_contract, format_rules: { ...(bp.output_contract.format_rules || {}), [key]: e.target.value } } })}
                    placeholder={ph}
                    className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Decision memo: required sections */}
        {bp.output_contract?.format === 'decision' && (
          <FormatRulesEditor label="Required sections" hint="e.g. Context, Options, Recommendation, Risks" rulesKey="sections" bp={bp} setBp={setBp} />
        )}

        {/* Multi-section document */}
        {bp.output_contract?.format === 'document' && (
          <FormatRulesEditor label="Required sections" hint="e.g. Executive Summary, Analysis, Appendix" rulesKey="sections" bp={bp} setBp={setBp} />
        )}
      </div>

      {/* AI Behavior */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-white uppercase tracking-wider">AI Behavior</p>
          <button onClick={openPromptStudio}
            className="text-[11px] text-[#A29BFE] hover:text-white transition-colors">
            Edit full prompt →
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">AI provider</label>
            <select
              value={app.ai_provider || 'claude'}
              onChange={e => updateAppModel({ ai_provider: e.target.value })}
              disabled={savingModel}
              className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40 disabled:opacity-50">
              <option value="claude">Claude</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Model</label>
            <select
              value={app.ai_model || APP_MODEL_OPTIONS[app.ai_provider || 'claude']?.[0]?.id || ''}
              onChange={e => updateAppModel({ ai_model: e.target.value })}
              disabled={savingModel}
              className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40 disabled:opacity-50">
              {(APP_MODEL_OPTIONS[app.ai_provider || 'claude'] || []).map(m => (
                <option key={m.id} value={m.id}>{m.label} - {m.hint}</option>
              ))}
            </select>
          </div>
        </div>
        {(() => {
          const MODEL_COSTS = {
            'gpt-4o': { input: 2.50, output: 10.00 }, 'gpt-4o-mini': { input: 0.15, output: 0.60 },
            'claude-haiku-4-5': { input: 0.80, output: 4.00 }, 'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
            'claude-sonnet-5': { input: 3.00, output: 15.00 }, 'claude-opus-4-5': { input: 15.00, output: 75.00 },
            'claude-opus-5': { input: 15.00, output: 75.00 },
          }
          const model = app.ai_model || 'claude-sonnet-4-5'
          const rates = MODEL_COSTS[model] || Object.entries(MODEL_COSTS).find(([k]) => model.includes(k) || k.includes(model))?.[1]
          if (!rates) return null
          const promptChars = (app.system_prompt || '').length
          const promptTokens = Math.round(promptChars / 4)
          const avgOutput = 300
          const costPerRun = ((promptTokens / 1e6) * rates.input) + ((avgOutput / 1e6) * rates.output)
          const fmt = n => n < 0.001 ? `$${(n * 1000).toFixed(3)}m` : `$${n.toFixed(4)}`
          return (
            <div className="flex items-center gap-3 px-3 py-2 bg-[#0A0F1E] rounded-lg border border-white/5 text-[10px]">
              <span className="text-slate-500">~{promptTokens.toLocaleString()} prompt tokens</span>
              <span className="text-white/10">·</span>
              <span className="text-slate-500">~{avgOutput} avg output</span>
              <span className="text-white/10">·</span>
              <span className="text-green-400 font-semibold">Est. {fmt(costPerRun)} per run</span>
              <span className="text-white/10">·</span>
              <span className="text-slate-600">{fmt(rates.input * 1e-3)}/1K in · {fmt(rates.output * 1e-3)}/1K out</span>
            </div>
          )
        })()}
        <p className="text-[10px] text-slate-400">Model changes affect quality, cost, and test results. Run the Test tab again after switching.</p>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Tone preset</label>
          <div className="flex flex-wrap gap-2">
            {AI_PRESETS.map(p => (
              <button key={p.id}
                onClick={() => update({ ai_behavior: { ...bp.ai_behavior, tone_preset: bp.ai_behavior?.tone_preset === p.id ? '' : p.id } })}
                title={p.hint}
                className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${bp.ai_behavior?.tone_preset === p.id ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-[#A29BFE]' : 'bg-white/3 border-white/8 text-slate-500 hover:text-white hover:border-white/20'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Refusal rules</label>
          <textarea value={bp.ai_behavior?.refusal_rules || ''} onChange={e => update({ ai_behavior: { ...bp.ai_behavior, refusal_rules: e.target.value } })}
            placeholder="e.g. Never give legal advice. Refuse to process resumes without a job description."
            rows={2}
            className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Missing-data fallback</label>
          <input value={bp.ai_behavior?.fallback_behavior || ''} onChange={e => update({ ai_behavior: { ...bp.ai_behavior, fallback_behavior: e.target.value } })}
            placeholder="e.g. Ask for the missing job description before proceeding"
            className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
        </div>
        {app.system_prompt && (
          <div className="bg-[#0E1424] rounded-xl px-3 py-2 border border-white/5">
            <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1">Current system prompt (truncated)</p>
            <p className="text-[11px] text-slate-300 line-clamp-2 font-mono leading-relaxed">{app.system_prompt}</p>
          </div>
        )}
      </div>

      {/* Permissions */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-bold text-white uppercase tracking-wider">Permissions & Risk</p>
        <div className="space-y-2">
          {[
            { key: 'handles_sensitive_data', label: 'Handles sensitive or PII data',  color: 'amber' },
            { key: 'stores_user_data',        label: 'Stores user data',               color: 'amber' },
            { key: 'requires_external_api',   label: 'Calls external APIs or services',color: 'blue'  },
          ].map(({ key, label, color }) => {
            const on = bp.permissions?.[key]
            return (
              <label key={key} className="flex items-center gap-3 cursor-pointer group">
                <button onClick={() => update({ permissions: { ...bp.permissions, [key]: !on } })}
                  className={`w-9 h-5 rounded-full transition-all shrink-0 relative ${on ? (color === 'amber' ? 'bg-amber-500' : 'bg-blue-500') : 'bg-[#0E1424] border border-white/10'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`} />
                </button>
                <span className={`text-xs ${on ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'} transition-colors`}>{label}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* Tools */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-bold text-white uppercase tracking-wider">Tools & Capabilities</p>
        <ToolsEditor appId={app.id} />
      </div>

      {/* Design → Test handoff */}
      <DesignTestHandoff
        app={app}
        bp={bp}
        isDirty={isDirty}
        saving={saving}
        onSave={() => save(bp)}
        onGoToTest={() => onGoToTest?.(app.id)}
      />

      {/* App planning — collapsed by default */}
      <details className="group">
        <summary className="flex items-center justify-between px-4 py-3 bg-[#171B33] border border-white/5 rounded-2xl cursor-pointer hover:bg-[#1A2040] transition-colors list-none">
          <span className="text-xs font-semibold text-slate-400">App planning <span className="text-slate-600 font-normal">(business context, modules, deployment)</span></span>
          <span className="text-slate-600 text-[10px] group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="mt-2 space-y-4">
          {/* Business Problem */}
          <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
            <p className="text-xs font-bold text-white uppercase tracking-wider">Business Problem</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Problem this app solves</label>
                <textarea value={bp.business_problem} onChange={e => update({ business_problem: e.target.value })} rows={3}
                  placeholder="e.g. Screen resumes against job descriptions quickly and consistently"
                  className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Target audience</label>
                <textarea value={bp.audience} onChange={e => update({ audience: e.target.value })} rows={3}
                  placeholder="e.g. Recruiters and hiring managers at mid-size companies"
                  className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none" />
              </div>
            </div>
          </div>
          {/* Production modules */}
          <ProductionModulePlanner app={app} bp={bp} setBp={setBp} />
          {/* Deployment blueprint */}
          <DeploymentBlueprintPanel app={app} bp={bp} setBp={setBp} />
        </div>
      </details>

      {/* Save footer */}
      <div className="flex justify-end pt-2 pb-6">
        <button onClick={() => save(bp)} disabled={saving}
          className="text-sm font-semibold px-6 py-2.5 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
          {saving ? 'Saving…' : 'Save blueprint'}
        </button>
      </div>
    </div>
  )
}

// ─── Schema field row (recursive, supports one level of nesting) ──────────────

function SchemaFieldRow({ f, depth, onChange, onRemove, onAddNested, onChangeNested, onRemoveNested }) {
  const isNested = depth > 0
  function addChild() {
    onChange({ nested_fields: [...(f.nested_fields || []), { field: '', type: 'string', description: '', required: true }] })
  }
  function updateChild(j, patch) {
    onChange({ nested_fields: (f.nested_fields || []).map((nf, idx) => idx === j ? { ...nf, ...patch } : nf) })
  }
  function removeChild(j) {
    onChange({ nested_fields: (f.nested_fields || []).filter((_, idx) => idx !== j) })
  }
  return (
    <div className={`rounded-xl p-2.5 space-y-1.5 ${isNested ? 'bg-[#171B33] border border-white/5 ml-4' : 'bg-[#0E1424] border border-white/5'}`}>
      <div className="grid grid-cols-3 gap-2 items-center">
        <input value={f.field} onChange={e => onChange({ field: e.target.value })}
          placeholder={isNested ? 'nested_key' : 'field_name'}
          className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none font-mono" />
        <select value={f.type} onChange={e => onChange({ type: e.target.value, nested_fields: e.target.value !== 'object' ? undefined : (f.nested_fields || []) })}
          className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none">
          {ALL_FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex gap-2 items-center">
          <input value={f.description || ''} onChange={e => onChange({ description: e.target.value })}
            placeholder="Description"
            className="flex-1 bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 placeholder-slate-500 focus:outline-none" />
          <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors text-xs shrink-0">✕</button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={f.required !== false} onChange={e => onChange({ required: e.target.checked })}
            className="accent-[#6C5CE7] w-3 h-3" />
          <span className="text-[10px] text-slate-500">Required</span>
        </label>
        {f.type === 'enum' && (
          <div className="flex-1 flex items-center gap-2">
            <span className="text-[10px] text-slate-500 shrink-0">Allowed values</span>
            <input value={(f.enum_values || []).join(', ')}
              onChange={e => onChange({ enum_values: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              placeholder="low, medium, high"
              className="flex-1 bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none font-mono" />
          </div>
        )}
        {f.type === 'object' && (
          <button onClick={onAddNested || addChild}
            className="text-[10px] text-[#A29BFE] hover:text-white transition-colors">
            + Add nested field
          </button>
        )}
      </div>

      {/* Nested fields (one level deep) */}
      {f.type === 'object' && f.nested_fields?.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {f.nested_fields.map((nf, j) => (
            <SchemaFieldRow key={j} f={nf} depth={depth + 1}
              onChange={patch => onChangeNested ? onChangeNested(j, patch) : updateChild(j, patch)}
              onRemove={() => onRemoveNested ? onRemoveNested(j) : removeChild(j)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Schema export panel ───────────────────────────────────────────────────────

function SchemaExportPanel({ inputFields, outputFields }) {
  const [tab, setTab] = useState('zod')
  const [copied, setCopied] = useState(false)

  const code = tab === 'zod'
    ? buildZodExport(inputFields, outputFields)
    : tab === 'typescript'
      ? buildTsExport(inputFields, outputFields)
      : buildJsonSchemaExport(inputFields, outputFields)

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch (_) {}
  }

  function download() {
    const ext = tab === 'json_schema' ? 'json' : 'ts'
    const blob = new Blob([code], { type: tab === 'json_schema' ? 'application/json' : 'text/typescript' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aistrix-schema.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-[#0A0E1A] border border-[#6C5CE7]/15 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {['zod','typescript','json_schema'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${tab === t ? 'bg-[#6C5CE7]/20 text-[#A29BFE]' : 'text-slate-600 hover:text-slate-400'}`}>
              {t === 'zod' ? 'Zod' : t === 'typescript' ? 'TypeScript' : 'JSON Schema'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copy}
            className="text-[10px] text-slate-500 hover:text-[#A29BFE] transition-colors font-semibold">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button onClick={download}
            className="text-[10px] text-slate-500 hover:text-[#A29BFE] transition-colors font-semibold">
            Export
          </button>
        </div>
      </div>
      <pre className="text-[10px] font-mono text-slate-400 overflow-x-auto leading-relaxed max-h-48 whitespace-pre">{code}</pre>
    </div>
  )
}

// ─── Tab: Design ──────────────────────────────────────────────────────────────

function DesignTab({ apps, allApps = apps, loading, onOpenCreate, user, onAppUpdated, onGoToTest, selectedAppId, onSelectApp, deployFixReason, phaseByAppId = {} }) {
  const [studioApp, setStudioApp]     = useState(null)

  const app = apps.find(a => a.id === selectedAppId) || apps[0] || null

  useEffect(() => {
    if (studioApp && studioApp.id !== app?.id) setStudioApp(null)
  }, [app?.id, studioApp])

  if (loading) return <p className="text-slate-500 text-sm py-10 text-center">Loading…</p>

  if (!allApps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3">🧩</div>
      <p className="text-white font-medium mb-1">No apps yet</p>
      <p className="text-slate-400 text-sm mb-5">Create your first AI app to start building with the Blueprint Studio.</p>
      <button onClick={onOpenCreate}
        className="text-sm font-semibold px-5 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
        + Create app
      </button>
    </div>
  )

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3">✏️</div>
      <p className="text-white font-medium mb-1">No apps are in Design</p>
      <p className="text-slate-400 text-sm mb-5">Apps move out of Design when they enter Test or Deploy. Select an app from another phase to move it back here.</p>
      <div className="flex justify-center gap-2 flex-wrap">
        {allApps.map(a => (
          <button key={a.id} onClick={() => onSelectApp?.(a.id)}
            className="text-xs px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors">
            {a.emoji} {a.name} · {DEV_PHASES[getDevPhase(a, phaseByAppId)]?.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <div className="space-y-4">
        {deployFixReason && app?.id === selectedAppId && (
          <div className="bg-[#6C5CE7]/10 border border-[#6C5CE7]/30 rounded-2xl px-4 py-3 flex items-start gap-3">
            <span className="text-[#A29BFE] text-sm mt-0.5">↩</span>
            <div>
              <p className="text-white text-sm font-semibold">Fix publish blocker in Design</p>
              <p className="text-slate-300 text-xs mt-0.5">
                Update {deployFixReason}, save the app, then run the Test tab again before returning to Deploy.
              </p>
            </div>
          </div>
        )}

        {app?.is_published && (
          <div className={`rounded-2xl px-4 py-3 flex items-center justify-between gap-3 ${app.has_draft_changes ? 'bg-amber-500/8 border border-amber-500/20' : 'bg-green-500/8 border border-green-500/20'}`}>
            <div className="flex items-center gap-2">
              <span className={app.has_draft_changes ? 'text-amber-400' : 'text-green-400'}>{app.has_draft_changes ? '⚠' : '●'}</span>
              <div>
                <p className={`text-xs font-semibold ${app.has_draft_changes ? 'text-amber-300' : 'text-green-300'}`}>
                  {app.has_draft_changes ? 'Draft changes — not live yet' : 'Live — no pending changes'}
                </p>
                {app.has_draft_changes && <p className="text-slate-400 text-[11px]">Save, then go to Deploy to promote these changes to production.</p>}
              </div>
            </div>
          </div>
        )}


        {studioApp && (
          <Suspense fallback={null}>
            <PromptStudio
              mode="inline"
              app={studioApp}
              user={user}
              onClose={() => setStudioApp(null)}
              onSaved={updated => { onAppUpdated?.(updated); setStudioApp(updated) }}
            />
          </Suspense>
        )}

        {app ? (
          <BlueprintEditor
            key={app.id}
            app={app}
            user={user}
            onAppUpdated={onAppUpdated}
            onOpenPromptStudio={a => setStudioApp(a)}
            onGoToTest={onGoToTest}
          />
        ) : (
          <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
            <p className="text-slate-400 text-sm">Select an app above to open its Blueprint Studio.</p>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Blueprint-driven test panel ─────────────────────────────────────────────

function BlueprintTestPanel({ apps, user, selectedAppId, onSelectApp }) {
  const selectedApp_id = selectedAppId ?? apps[0]?.id ?? null
  const [bp, setBp]               = useState(undefined)  // undefined=loading, null=no saved blueprint, object=loaded
  const [cases, setCases]         = useState([])
  const [running, setRunning]     = useState(null)
  const [runResult, setRunResult] = useState({})
  const toast = useToast()
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

  const app = apps.find(a => a.id === selectedApp_id)

  useEffect(() => {
    if (!selectedApp_id) return
    setBp(undefined); setCases([]); setRunResult({})
    Promise.all([
      supabase.from('app_blueprints').select('blueprint').eq('app_id', selectedApp_id).maybeSingle(),
      supabase.from('blueprint_test_results').select('*').eq('app_id', selectedApp_id).order('created_at', { ascending: true }),
    ]).then(([{ data: bpData, error: bpErr }, { data: savedCases }]) => {
      setBp(isMissingBlueprintTable(bpErr) ? null : bpData?.blueprint ? migrateBlueprint({ ...EMPTY_BP, ...bpData.blueprint }) : null)
      if (savedCases?.length) {
        setCases(savedCases.map(r => ({ label: r.label, input: r.input, expected_checks: r.expected_checks, status: r.last_status, output: r.last_output || '' })))
        setRunResult(Object.fromEntries(savedCases.filter(r => r.last_status).map((r, i) => [i, { output: r.last_output || '', status: r.last_status, errors: r.last_errors || [] }])))
      }
    })
  }, [selectedApp_id])

  async function persistCaseResult(idx, result) {
    if (!selectedApp_id || !user?.id) return
    const tc = cases[idx]
    await supabase.from('blueprint_test_results').upsert({
      app_id: selectedApp_id, user_id: user.id,
      label: tc.label, input: tc.input, expected_checks: tc.expected_checks,
      last_status: result.status, last_output: result.output, last_errors: result.errors,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'app_id,label' })
  }

  function generateCasesFromBlueprint() {
    if (!bp?.inputs?.length) return
    const generated = []

    // One happy-path case per required input combination
    const happyInputs = bp.inputs.reduce((acc, f) => {
      acc[f.key] = sampleValue(f.type, f.label)
      return acc
    }, {})
    generated.push({ label: 'Happy path', input: formatInputs(happyInputs, bp), expected_checks: buildChecks(bp), status: null, output: '' })

    // One missing-required-field case
    const missingRequired = bp.inputs.find(f => f.required)
    if (missingRequired) {
      const partial = { ...happyInputs }
      delete partial[missingRequired.key]
      generated.push({ label: `Missing: ${missingRequired.label}`, input: formatInputs(partial, bp), expected_checks: [{ type: 'fallback', desc: 'Should ask for missing data or refuse gracefully' }], status: null, output: '' })
    }

    // One PII field edge case
    const piiField = bp.inputs.find(f => f.pii)
    if (piiField) {
      generated.push({ label: `PII field: ${piiField.label}`, input: formatInputs({ ...happyInputs, [piiField.key]: '[REDACTED]' }, bp), expected_checks: [{ type: 'safety', desc: 'Should handle redacted PII gracefully' }], status: null, output: '' })
    }

    setCases(generated)
    toast(`${generated.length} test cases generated from blueprint`, 'success', 3000)
  }

  function sampleValue(type, label) {
    const lbl = label.toLowerCase()
    if (type === 'long_text') return `Sample ${label} text for testing purposes. This is a realistic-length input to validate the app handles normal content correctly.`
    if (type === 'short_text') return `Sample ${label}`
    if (type === 'number') return 42
    if (type === 'boolean') return true
    if (type === 'url') return 'https://example.com'
    if (type === 'date') return new Date().toISOString().split('T')[0]
    if (type === 'email') return 'test@example.com'
    if (type === 'select' || type === 'multi_select') return `Option A`
    if (type === 'json') return '{"key": "value"}'
    if (type === 'csv') return 'name,value\nRow 1,100\nRow 2,200'
    return `Sample ${label}`
  }

  function formatInputs(inputs, bp) {
    return Object.entries(inputs).map(([k, v]) => {
      const field = bp.inputs.find(f => f.key === k)
      return `${field?.label || k}:\n${v}`
    }).join('\n\n')
  }

  // Returns { errors: string[], parseError: string|null, looksLikeMarkdown: boolean }
  // `nested` flag = called recursively, skip fence-stripping and markdown detection
  function validateJsonSchema(rawOutput, fields, nested = false) {
    const errors = []
    const raw = rawOutput.trim()

    const looksLikeMarkdown = !nested && (/^(#|\*\*|Here |Sure|I'll|The |This )/i.test(raw) || raw.startsWith('```'))
    const stripped = nested ? raw : raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    let parsed
    let parseError = null
    try {
      parsed = JSON.parse(stripped)
    } catch (e) {
      parseError = e.message  // exact V8 parser message, e.g. "Unexpected token 'H' at position 0"
      return { errors: [`Output is not valid JSON: ${e.message}`], parseError, looksLikeMarkdown }
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      return { errors: ['Output JSON must be a plain object, not an array or primitive'], parseError: null, looksLikeMarkdown }
    }
    for (const f of fields) {
      const isRequired = f.required !== false
      const present = f.field in parsed && parsed[f.field] !== null && parsed[f.field] !== undefined
      if (!present) {
        if (isRequired) errors.push(`Missing required field: "${f.field}"`)
        continue
      }
      const val = parsed[f.field]
      if (f.type === 'object') {
        if (typeof val !== 'object' || Array.isArray(val)) {
          errors.push(`"${f.field}": expected object, got ${typeof val}`)
        } else if (f.nested_fields?.length) {
          // recurse — prefix nested errors with parent key
          const nestedResult = validateJsonSchema(JSON.stringify(val), f.nested_fields, true)
          errors.push(...nestedResult.errors.map(e => `${f.field}.${e}`))
        }
        continue
      }
      const typeErrors = {
        string:       typeof val !== 'string'               && `"${f.field}": expected string, got ${typeof val}`,
        number:       typeof val !== 'number'               && `"${f.field}": expected number, got ${typeof val}`,
        boolean:      typeof val !== 'boolean'              && `"${f.field}": expected boolean, got ${typeof val}`,
        string_array: (!Array.isArray(val) || val.some(x => typeof x !== 'string')) && `"${f.field}": expected string[]`,
        number_array: (!Array.isArray(val) || val.some(x => typeof x !== 'number')) && `"${f.field}": expected number[]`,
        enum: (() => {
          if (typeof val !== 'string') return `"${f.field}": expected string (enum), got ${typeof val}`
          if (f.enum_values?.length && !f.enum_values.includes(val))
            return `"${f.field}": "${val}" not in allowed values [${f.enum_values.join(', ')}]`
          return false
        })(),
      }
      const err = typeErrors[f.type]
      if (err) errors.push(err)
    }
    return { errors, parseError, looksLikeMarkdown }
  }

  function buildChecks(bp) {
    const checks = []
    const oc = bp.output_contract || {}
    const schemaFields = getOutputSchemaFields(bp)
    if (oc.format === 'json' && schemaFields.length) {
      checks.push({
        type: 'json_schema',
        desc: `Valid JSON with schema: ${schemaFields.map(f => `${f.field}(${f.type}${f.required === false ? '?' : ''})`).join(', ')}`,
        fields: schemaFields,
      })
    } else if (oc.format && oc.format_rules) {
      const sections = oc.format_rules.sections || oc.format_rules.columns || ''
      if (sections) sections.split(',').map(s => s.trim()).filter(Boolean).forEach(s =>
        checks.push({ type: 'section_present', desc: `Output contains: ${s}`, section: s })
      )
    }
    if (bp.ai_behavior?.refusal_rules?.trim()) checks.push({ type: 'no_refusal_bypass', desc: 'Output respects refusal rules' })
    return checks
  }

  async function runCase(idx) {
    if (!app) return
    setRunning(idx)
    const tc = cases[idx]
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ app_id: app.id, input: tc.input, system_prompt: app.system_prompt, ai_provider: app.ai_provider || 'claude', ai_model: app.ai_model || null }),
      })
      if (!res.ok) throw new Error('Run failed')
      const reader = res.body.getReader(); const dec = new TextDecoder()
      let buf = ''; let output = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try { const d = JSON.parse(line.slice(6)); if (d.token) output += d.token; if (d.input_tokens) tc._inTok = d.input_tokens; if (d.output_tokens) tc._outTok = d.output_tokens } catch (_) {}
        }
      }
      if (!tc._inTok) tc._inTok = Math.round(((app.system_prompt||'').length + tc.input.length) / 4)
      if (!tc._outTok) tc._outTok = Math.round(output.length / 4)
      // Validate output against checks
      const errors = []
      let parseError = null, looksLikeMarkdown = false
      for (const chk of tc.expected_checks) {
        if (chk.type === 'json_schema') {
          const r = validateJsonSchema(output, chk.fields)
          errors.push(...r.errors)
          if (r.parseError) parseError = r.parseError
          if (r.looksLikeMarkdown) looksLikeMarkdown = true
        } else if (chk.type === 'field_present') {
          try { const parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); if (!(chk.field in parsed)) errors.push(`Missing field: ${chk.field}`) } catch (e) { errors.push(`Output is not valid JSON: ${e.message}`) }
        } else if (chk.type === 'section_present') {
          if (!output.toLowerCase().includes(chk.section.toLowerCase())) errors.push(`Missing section: ${chk.section}`)
        }
      }
      const status = errors.length === 0 ? 'pass' : 'fail'
      const MODEL_COSTS_BP = { 'gpt-4o': { input: 2.50, output: 10.00 }, 'gpt-4o-mini': { input: 0.15, output: 0.60 }, 'claude-haiku-4-5': { input: 0.80, output: 4.00 }, 'claude-sonnet-4-5': { input: 3.00, output: 15.00 }, 'claude-sonnet-5': { input: 3.00, output: 15.00 }, 'claude-opus-4-5': { input: 15.00, output: 75.00 }, 'claude-opus-5': { input: 15.00, output: 75.00 } }
      const bpRates = MODEL_COSTS_BP[app.ai_model] || Object.entries(MODEL_COSTS_BP).find(([k]) => (app.ai_model||'').includes(k) || k.includes(app.ai_model||''))?.[1]
      const cost = bpRates ? ((tc._inTok / 1e6) * bpRates.input) + ((tc._outTok / 1e6) * bpRates.output) : null
      const resultData = { output, status, errors, parseError, looksLikeMarkdown, inputTokens: tc._inTok, outputTokens: tc._outTok, cost }
      setRunResult(p => ({ ...p, [idx]: resultData }))
      persistCaseResult(idx, resultData)
    } catch (e) {
      setRunResult(p => ({ ...p, [idx]: { output: '', status: 'fail', errors: [e.message] } }))
    } finally {
      setRunning(null)
    }
  }

  async function runAll() {
    for (let i = 0; i < cases.length; i++) await runCase(i)
  }

  const passed   = Object.values(runResult).filter(r => r.status === 'pass').length
  const ran      = Object.values(runResult).length
  const passRate = ran > 0 ? Math.round((passed / ran) * 100) : null
  const gateColor = passRate === null ? null : passRate === 100 ? '#00B894' : passRate >= 50 ? '#FDCB6E' : '#E84393'

  // Collect suggested fixes from failed cases
  const suggestions = Object.entries(runResult)
    .filter(([, r]) => r.status === 'fail')
    .flatMap(([idx, r]) => r.errors.map(e => ({ case: cases[Number(idx)]?.label, error: e })))
    .slice(0, 5)

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold text-white uppercase tracking-wider">Blueprint-generated tests</p>
            {app && <span className="text-[10px] text-slate-500 font-medium">{app.emoji} {app.name}</span>}
          </div>
          <p className="text-[10px] text-slate-500">Generated from the saved Aistrix app blueprint, input schema, and output contract.</p>
        </div>
        {passRate !== null && (
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs font-bold" style={{ color: gateColor }}>{passed}/{ran} passed — {passRate}%</span>
            {passRate === 100 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">✓ Ready to publish</span>}
            {passRate < 100 && ran > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">Fix failures before publishing</span>}
          </div>
        )}
      </div>

      {bp === undefined && <p className="text-slate-600 text-xs text-center py-3">Loading blueprint…</p>}

      {bp === null && (
        <div className="bg-[#0E1424] border border-amber-500/20 rounded-xl px-4 py-3 space-y-1">
          <p className="text-amber-300 text-xs font-semibold">No saved blueprint</p>
          <p className="text-slate-500 text-xs">Go to the Design tab, fill in your app blueprint, and save it — then come back here to generate tests.</p>
        </div>
      )}

      {bp !== null && bp !== undefined && !bp.inputs?.length && (
        <div className="bg-[#0E1424] border border-amber-500/20 rounded-xl px-4 py-3">
          <p className="text-amber-300 text-xs">No input schema defined. Add fields in the Design tab and save the blueprint to generate test cases.</p>
        </div>
      )}

      {bp?.inputs?.length > 0 && (
        <div className="flex items-center gap-2">
          <button onClick={generateCasesFromBlueprint}
            className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
            ↺ Generate from blueprint
          </button>
          {cases.length > 0 && (
            <button onClick={runAll} disabled={running !== null}
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
              {running !== null ? 'Running…' : `▶ Run all (${cases.length})`}
            </button>
          )}
        </div>
      )}

      {/* Suggested fixes from failures */}
      {suggestions.length > 0 && (
        <div className="bg-[#0E1424] border border-red-500/15 rounded-xl px-4 py-3 space-y-2">
          <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">Suggested fixes</p>
          {suggestions.map((s, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="text-red-400 shrink-0">✕</span>
              <span className="text-slate-400"><span className="text-slate-500">{s.case}: </span>{s.error}</span>
            </div>
          ))}
          <p className="text-[10px] text-slate-400 pt-1">Fix these in the Design tab → AI Behavior or Output Contract, then re-run.</p>
        </div>
      )}

      {cases.length > 0 && (
        <div className="space-y-2">
          {cases.map((tc, i) => {
            const result = runResult[i]
            return (
              <div key={i} className={`border rounded-xl p-3 space-y-2 transition-colors ${result?.status === 'pass' ? 'border-emerald-500/20 bg-emerald-500/5' : result?.status === 'fail' ? 'border-red-500/20 bg-red-500/5' : 'border-white/5 bg-[#0E1424]'}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm shrink-0 ${result?.status === 'pass' ? 'text-emerald-400' : result?.status === 'fail' ? 'text-red-400' : 'text-slate-600'}`}>
                    {result?.status === 'pass' ? '✓' : result?.status === 'fail' ? '✕' : '○'}
                  </span>
                  <p className="text-xs font-semibold text-white flex-1">{tc.label}</p>
                  <button onClick={() => runCase(i)} disabled={running !== null}
                    className="text-[10px] text-slate-500 hover:text-[#A29BFE] transition-colors disabled:opacity-40 shrink-0">
                    {running === i ? '…' : 'Run'}
                  </button>
                </div>
                {/* Expected checks — show schema fields with optional badges */}
                <div className="text-[10px] text-slate-400 space-y-0.5">
                  {tc.expected_checks.map((chk, j) => (
                    <div key={j}>
                      {chk.type === 'json_schema' ? (
                        <div className="flex flex-wrap gap-1 items-center">
                          <span className="text-slate-600">✦ JSON schema:</span>
                          {chk.fields.map((f, k) => (
                            <span key={k} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono border ${f.required === false ? 'border-slate-700 text-slate-600' : 'border-slate-600 text-slate-400'}`}>
                              {f.field}
                              <span className="text-[8px] text-slate-700">{f.type}{f.enum_values?.length ? `(${f.enum_values.join('|')})` : ''}</span>
                              {f.required === false && <span className="text-[8px] text-slate-700">opt</span>}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p>✦ {chk.desc}</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Errors */}
                {result?.errors?.length > 0 && (
                  <div className="space-y-1">
                    {result.errors.map((e, j) => <p key={j} className="text-[10px] text-red-400">✕ {e}</p>)}
                    {result.parseError && (
                      <p className="text-[10px] text-orange-400 font-mono bg-orange-500/5 px-2 py-1 rounded border border-orange-500/15">
                        Parser: {result.parseError}
                      </p>
                    )}
                    {result.looksLikeMarkdown && (
                      <p className="text-[10px] text-amber-400 bg-amber-500/5 px-2 py-1 rounded border border-amber-500/15">
                        💡 Output starts with prose/markdown — add to system prompt: "Return ONLY valid JSON, no explanation, no markdown fences."
                      </p>
                    )}
                  </div>
                )}

                {/* Token + cost */}
                {result?.inputTokens && (
                  <div className="flex gap-4 text-[10px] bg-[#0A0F1E] rounded-lg px-3 py-1.5">
                    <span className="text-slate-500">In: <span className="text-slate-300">{result.inputTokens.toLocaleString()} tok</span></span>
                    <span className="text-slate-500">Out: <span className="text-slate-300">{result.outputTokens?.toLocaleString()} tok</span></span>
                    {result.cost != null && <span className="text-slate-500">Cost: <span className="text-green-400 font-semibold">{result.cost < 0.001 ? `$${(result.cost*1000).toFixed(3)}m` : `$${result.cost.toFixed(4)}`}</span></span>}
                  </div>
                )}
                {/* Raw output — always open on fail, collapsed on pass */}
                {result && (result.status === 'fail' || result.output) && (
                  <details className="text-[10px] text-slate-400" open={result.status === 'fail'}>
                    <summary className="cursor-pointer hover:text-slate-400">
                      {result.status === 'fail' ? 'Raw output' : 'View output'}
                    </summary>
                    <pre className="mt-1 bg-[#171B33] rounded-lg p-2 overflow-x-auto text-slate-400 whitespace-pre-wrap leading-relaxed max-h-40">
                      {result.output || '(empty output)'}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Test ────────────────────────────────────────────────────────────────

function TestTab({ apps, allApps = apps, user, selectedAppId, onSelectApp, phaseByAppId = {} }) {
  const activeAppId = apps.some(a => a.id === selectedAppId) ? selectedAppId : apps[0]?.id || null
  const activeApp = apps.find(a => a.id === activeAppId)

  if (!allApps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Create an app in Design before testing.</p>
    </div>
  )

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3">🧪</div>
      <p className="text-white font-medium mb-1">No apps are in Test</p>
      <p className="text-slate-400 text-sm mb-5">Move a Design or Deploy app here when you need to validate changes before publishing.</p>
      <div className="flex justify-center gap-2 flex-wrap">
        {allApps.map(a => (
          <button key={a.id} onClick={() => onSelectApp?.(a.id)}
            className="text-xs px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors">
            {a.emoji} {a.name} · {DEV_PHASES[getDevPhase(a, phaseByAppId)]?.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-5">

      <BlueprintTestPanel apps={apps} user={user} selectedAppId={activeAppId} onSelectApp={onSelectApp} />
      <TestSuite apps={apps} user={user} selectedAppId={activeAppId} onSelectApp={onSelectApp} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComingSoonCard
          icon="🎭"
          title="Persona Pack Testing"
          desc="Pre-built user personas (first-timer, power user, non-English speaker, edge-case input) auto-run your prompt across 8 realistic scenarios."
          bullets={[
            'One-click multi-persona run',
            'Flags persona-specific failures (e.g. breaks for long input)',
            'Community persona packs per app category',
            'Custom persona builder',
          ]}
        />
        <ComingSoonCard
          icon="📊"
          title="Latency & Cost Profiling"
          desc="Understand how fast and expensive each run is before you publish."
          bullets={[
            'Per-run latency percentiles (p50, p95)',
            'Token count per run',
            'Simulated load testing',
            'Suggested model swap to cut cost without quality loss',
          ]}
        />
      </div>
    </div>
  )
}

// ─── Promote Modal ───────────────────────────────────────────────────────────

function PromoteModal({ app, onClose, onPromoted, user }) {
  const toast = useToast()
  const [step, setStep] = useState('diff')   // 'diff' | 'confirm'
  const [promoting, setPromoting] = useState(false)
  const [bpDiff, setBpDiff] = useState(null)

  useEffect(() => {
    supabase.from('app_blueprints')
      .select('blueprint, blueprint_prod')
      .eq('app_id', app.id).maybeSingle()
      .then(({ data, error }) => {
        if (error?.code === '42703' || error?.message?.includes('blueprint_prod')) {
          // column not yet added — treat as no prod snapshot
          supabase.from('app_blueprints').select('blueprint').eq('app_id', app.id).maybeSingle()
            .then(({ data: d2 }) => {
              const current = d2?.blueprint ? migrateBlueprint({ ...EMPTY_BP, ...d2.blueprint }) : null
              setBpDiff({ current, prod: null })
            })
          return
        }
        const current = data?.blueprint ? migrateBlueprint({ ...EMPTY_BP, ...data.blueprint }) : null
        const prod    = data?.blueprint_prod ? migrateBlueprint({ ...EMPTY_BP, ...data.blueprint_prod }) : null
        setBpDiff({ current, prod })
      })
  }, [app.id])

  async function promote() {
    setPromoting(true)
    const { data: bpRow } = await supabase.from('app_blueprints')
      .select('blueprint').eq('app_id', app.id).maybeSingle()
    const { error: bpErr } = await supabase.from('app_blueprints')
      .update({ blueprint_prod: bpRow?.blueprint, updated_at: new Date().toISOString() })
      .eq('app_id', app.id)
    if (bpErr?.code === '42703' || bpErr?.message?.includes('blueprint_prod')) {
      toast('Run the SQL migration first: ALTER TABLE app_blueprints ADD COLUMN IF NOT EXISTS blueprint_prod jsonb', 'error', 8000)
      setPromoting(false); return
    }
    if (bpErr) { toast(bpErr.message, 'error'); setPromoting(false); return }
    const { error: appErr } = await supabase.from('apps')
      .update({ has_draft_changes: false, is_published: true }).eq('id', app.id)
    setPromoting(false)
    if (appErr) { toast(appErr.message, 'error'); return }
    toast('🚀 Changes promoted to production', 'success', 3000)
    onPromoted?.({ ...app, has_draft_changes: false, is_published: true })
    onClose()
  }

  const diffFields = bpDiff?.current && bpDiff?.prod ? (() => {
    const keys = ['app_name', 'tagline', 'system_prompt', 'input_label', 'output_label', 'tone', 'output_format', 'key_capabilities']
    return keys.filter(k => JSON.stringify(bpDiff.current[k]) !== JSON.stringify(bpDiff.prod[k]))
      .map(k => ({ key: k, from: bpDiff.prod[k], to: bpDiff.current[k] }))
  })() : []

  const FIELD_LABEL = { app_name: 'App name', tagline: 'Tagline', system_prompt: 'System prompt', input_label: 'Input label', output_label: 'Output label', tone: 'Tone', output_format: 'Output format', key_capabilities: 'Key capabilities' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-[#141828] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div>
            <p className="text-white font-semibold text-sm">Promote to Production</p>
            <p className="text-slate-400 text-xs mt-0.5">{app.emoji} {app.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none px-1">×</button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-white/8">
          {[['diff', '1. Review changes'], ['confirm', '2. Confirm']].map(([id, label]) => (
            <button key={id} onClick={() => step === 'confirm' && id === 'diff' ? setStep('diff') : null}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${step === id ? 'text-[#A29BFE] border-b-2 border-[#6C5CE7]' : 'text-slate-500'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 max-h-96 overflow-y-auto">
          {step === 'diff' && (
            bpDiff === null ? (
              <p className="text-slate-500 text-sm text-center py-6">Loading…</p>
            ) : diffFields.length === 0 && bpDiff.prod ? (
              <div className="text-center py-6">
                <p className="text-slate-300 text-sm font-semibold">No changes to promote</p>
                <p className="text-slate-500 text-xs mt-1">Current blueprint matches production.</p>
              </div>
            ) : !bpDiff.prod ? (
              <div className="bg-green-500/8 border border-green-500/20 rounded-xl px-4 py-3">
                <p className="text-green-300 text-sm font-semibold">First promotion</p>
                <p className="text-slate-300 text-xs mt-1">No snapshot exists yet — this will publish the current blueprint as production.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-slate-400 text-xs">{diffFields.length} field{diffFields.length !== 1 ? 's' : ''} changed since last promotion:</p>
                {diffFields.map(({ key, from, to }) => (
                  <div key={key} className="bg-[#0E1424] rounded-xl p-3 space-y-1.5">
                    <p className="text-[10px] text-slate-500 uppercase font-semibold">{FIELD_LABEL[key] || key}</p>
                    {from != null && (
                      <p className="text-xs text-red-300/70 line-through leading-relaxed">
                        {typeof from === 'object' ? JSON.stringify(from) : String(from).slice(0, 120)}{String(typeof from === 'object' ? JSON.stringify(from) : from).length > 120 ? '…' : ''}
                      </p>
                    )}
                    <p className="text-xs text-green-300 leading-relaxed">
                      {typeof to === 'object' ? JSON.stringify(to) : String(to ?? '').slice(0, 120)}{String(typeof to === 'object' ? JSON.stringify(to) : (to ?? '')).length > 120 ? '…' : ''}
                    </p>
                  </div>
                ))}
              </div>
            )
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-[#6C5CE7]/10 border border-[#6C5CE7]/30 rounded-xl px-4 py-3">
                <p className="text-[#A29BFE] text-sm font-semibold">Ready to promote</p>
                <p className="text-slate-300 text-xs mt-1 leading-relaxed">
                  This will snapshot the current blueprint as the new production version and clear the draft flag. The app will remain live.
                </p>
              </div>
              <button onClick={promote} disabled={promoting}
                className="w-full py-3 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] disabled:opacity-50 text-white text-sm font-bold transition-colors shadow-lg shadow-[#6C5CE7]/20">
                {promoting ? 'Promoting…' : '🚀 Promote to production'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/8">
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-white transition-colors">Cancel</button>
          {step === 'diff' && (
            <button onClick={() => setStep('confirm')}
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Deploy ─────────────────────────────────────────────────────────────

const CONTEXT_OPTS = [
  { id: 'career_profile',   label: '💼 Career Profile',   desc: 'Resume, skills, experience' },
  { id: 'business_profile', label: '🏢 Business Profile', desc: 'Company, brand voice, audience' },
  { id: 'memory',           label: '🧠 Memory',           desc: 'User preferences & custom facts' },
]

function AppDeployCard({ app: initialApp, onUpdate, onFixInDesign, user }) {
  const [app, setApp]               = useState(initialApp)
  const [publishing, setPublishing] = useState(false)
  const [showPromote, setShowPromote] = useState(false)
  const [description, setDescription] = useState(app.description || '')
  const [savingDescription, setSavingDescription] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState(app.webhook_url || '')
  const [savingWebhook, setSavingWebhook] = useState(false)
  const [maxRuns, setMaxRuns]       = useState(app.max_runs_per_day || '')
  const [savingQuota, setSavingQuota] = useState(false)
  const [embedTab, setEmbedTab]     = useState('iframe')
  const [expandSection, setExpandSection] = useState(null)
  const [bp, setBp]                 = useState(null)   // null = loading, false = no row, object = loaded
  const descriptionRef = useRef(null)
  const toast = useToast()

  const [runStats, setRunStats] = useState(null)

  useEffect(() => {
    supabase.from('app_blueprints').select('blueprint, readiness_score')
      .eq('app_id', app.id).maybeSingle()
      .then(({ data }) => setBp(data ? migrateBlueprint({ ...EMPTY_BP, ...data.blueprint }) : false))
    // Fetch run history summary
    supabase.from('run_history')
      .select('created_at, input_tokens, output_tokens, rating_value')
      .eq('app_id', app.id)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data: rows }) => {
        if (!rows?.length) return setRunStats({ total: 0 })
        const totalRuns  = rows.length
        const rated      = rows.filter(r => r.rating_value != null)
        const thumbsUp   = rated.filter(r => r.rating_value === 1).length
        const satisfaction = rated.length ? Math.round((thumbsUp / rated.length) * 100) : null
        const withTokens = rows.filter(r => r.input_tokens)
        const avgIn  = withTokens.length ? Math.round(withTokens.reduce((s, r) => s + r.input_tokens, 0) / withTokens.length) : null
        const avgOut = withTokens.length ? Math.round(withTokens.reduce((s, r) => s + (r.output_tokens || 0), 0) / withTokens.length) : null
        const lastRun = rows[0]?.created_at ? new Date(rows[0].created_at) : null
        setRunStats({ total: totalRuns, satisfaction, rated: rated.length, avgIn, avgOut, lastRun })
      })
  }, [app.id])

  function copy(text, label) {
    navigator.clipboard.writeText(text).then(() => toast(`${label} copied`, 'success', 2000))
  }

  function openChecklistFix(item) {
    if (item.id === 'desc' || item.id === 'price') {
      setExpandSection('details')
      if (item.id === 'desc') setTimeout(() => descriptionRef.current?.focus(), 50)
      return
    }
    if (item.id === 'design' || item.id === 'prompt' || item.id === 'model' || item.id === 'schema') {
      const labels = {
        design: 'Design readiness',
        prompt: 'the system prompt',
        model: 'the AI model',
        schema: 'the output schema',
      }
      toast(`Opening Design to fix ${labels[item.id]}. Run tests again before publishing.`, 'info', 4000)
      onFixInDesign?.(app.id, labels[item.id])
      return
    }
  }

  // ── Publish checklist ──────────────────────────────────────────────────────
  const jsonFormat = bp && bp.output_contract?.format === 'json'
  const hasOutputSchema = jsonFormat ? (getOutputSchemaFields(bp).length > 0) : true
  const designReadiness = bp ? calcReadiness(app, bp) : 0
  const designReady = !!bp && designReadiness >= 100

  const checklist = [
    { id: 'design',  label: `Design readiness complete (${designReadiness}/100)`, ok: designReady, fix: 'Complete Design readiness' },
    { id: 'prompt',  label: 'System prompt written',        ok: !!app.system_prompt?.trim(),              fix: 'Open Prompt Studio in Design tab' },
    { id: 'desc',    label: 'Description filled',           ok: !!app.description?.trim(),                 fix: 'Add a description in app settings' },
    { id: 'model',   label: 'AI model selected',            ok: !!app.ai_model,                            fix: 'Choose a model in app settings' },
    { id: 'price',   label: 'Pricing configured',           ok: !app.is_paid || !!app.price_per_run,       fix: 'Set price_per_run in app settings', skip: !app.is_paid },
    { id: 'schema',  label: 'Output schema defined',        ok: hasOutputSchema,                           fix: 'Add at least one field in Design → Output Contract', skip: !jsonFormat || bp === null },
  ].filter(c => !c.skip)

  const checklistPassed = checklist.every(c => c.ok)
  const canPublish = checklistPassed

  async function togglePublish() {
    setPublishing(true)
    const next = !app.is_published
    const { data, error } = await supabase.rpc('set_app_published_with_gate', { p_app_id: app.id, p_publish: next })
    setPublishing(false)
    if (error) { toast(error.message, 'error'); return }
    const result = Array.isArray(data) ? data[0] : data
    if (!result?.ok) {
      toast(`Publish blocked: ${(result?.errors || ['complete the schema checklist']).join('; ')}`, 'error', 8000)
      return
    }
    const updated = { ...app, is_published: next }
    setApp(updated)
    onUpdate?.(updated)
    toast(next ? '🚀 App is now live' : 'App set to draft', next ? 'success' : 'info', 3000)
  }

  async function saveDescription() {
    const clean = description.trim()
    if (!clean) { toast('Description is required before publishing', 'error'); return }
    setSavingDescription(true)
    const { error } = await supabase.from('apps').update({ description: clean }).eq('id', app.id)
    setSavingDescription(false)
    if (error) { toast(error.message, 'error'); return }
    const updated = { ...app, description: clean }
    setApp(updated)
    onUpdate?.(updated)
    toast('Description saved', 'success', 2000)
  }

  // ── Context requirements ───────────────────────────────────────────────────
  async function toggleContext(id) {
    const ctx = app.required_context || []
    const next = ctx.includes(id) ? ctx.filter(c => c !== id) : [...ctx, id]
    const { error } = await supabase.from('apps').update({ required_context: next }).eq('id', app.id)
    if (error) { toast(error.message, 'error'); return }
    const updated = { ...app, required_context: next }
    setApp(updated)
    onUpdate?.(updated)
  }

  // ── Webhook ────────────────────────────────────────────────────────────────
  async function saveWebhook() {
    setSavingWebhook(true)
    const { error } = await supabase.from('apps')
      .update({ webhook_url: webhookUrl.trim() || null }).eq('id', app.id)
    setSavingWebhook(false)
    if (error) { toast(error.message, 'error'); return }
    const updated = { ...app, webhook_url: webhookUrl.trim() || null }
    setApp(updated)
    onUpdate?.(updated)
    toast('Webhook saved', 'success', 2000)
  }

  // ── Run quota ──────────────────────────────────────────────────────────────
  async function saveQuota() {
    const val = maxRuns === '' ? null : parseInt(maxRuns, 10)
    if (maxRuns !== '' && (isNaN(val) || val < 1)) { toast('Enter a valid number', 'error'); return }
    setSavingQuota(true)
    const { error } = await supabase.from('apps')
      .update({ max_runs_per_day: val }).eq('id', app.id)
    setSavingQuota(false)
    if (error?.message?.includes('column') || error?.code === '42703') {
      toast('max_runs_per_day column not found — add it via Supabase SQL editor', 'error', 5000)
      return
    }
    if (error) { toast(error.message, 'error'); return }
    const updated = { ...app, max_runs_per_day: val }
    setApp(updated)
    onUpdate?.(updated)
    toast('Quota saved', 'success', 2000)
  }

  // ── Embed code ─────────────────────────────────────────────────────────────
  const appUrl = `${window.location.origin}/app/${app.id}`
  const embedCodes = {
    iframe: `<iframe
  src="${appUrl}"
  width="100%"
  height="640"
  frameborder="0"
  allow="clipboard-write"
  style="border-radius:12px;border:1px solid rgba(255,255,255,0.08)"
></iframe>`,
    js: `<div id="aistrix-app-${app.id.slice(0, 8)}"></div>
<script src="https://cdn.aistrix.com/embed.js"></script>
<script>
  Aistrix.embed({
    appId: '${app.id}',
    container: '#aistrix-app-${app.id.slice(0, 8)}',
    theme: 'dark',        // 'light' | 'dark' | 'auto'
    height: 640,
  });
</script>`,
    api: `curl -X POST https://api.aistrix.com/v1/apps/${app.id}/run \\
  -H "Authorization: Bearer ak_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Your prompt here"}'`,
  }

  function Section({ id, label, children }) {
    const open = expandSection === id
    return (
      <div className="border-t border-white/5 first:border-t-0">
        <button onClick={() => setExpandSection(open ? null : id)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/2 transition-colors text-left">
          <span className="text-xs font-medium text-slate-300">{label}</span>
          <span className="text-slate-600 text-[10px]">{open ? '▲' : '▼'}</span>
        </button>
        {open && <div className="px-5 pb-4">{children}</div>}
      </div>
    )
  }

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ background: (app.color || '#6C5CE7') + '33' }}>
          <AppEmojiWithType app={app} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm truncate">{app.name}</p>
          <p className="text-[10px] text-slate-500">{app.ai_provider === 'openai' ? '🟢' : '🟣'} {app.ai_model?.split('-').slice(0, 3).join('-') || 'default'}</p>
        </div>
        <div className="flex items-center gap-2">
          {app.is_published
            ? <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">● Live</span>
            : <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">◌ Draft</span>}
        </div>
      </div>

      {/* Publish checklist + toggle */}
      <div className="px-5 py-4 border-b border-white/5 space-y-3">
        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Pre-publish checklist</p>
        <div className="space-y-1.5">
          {checklist.map(c => (
            <button key={c.id} type="button" onClick={() => !c.ok && openChecklistFix(c)}
              className={`w-full flex items-center gap-2 text-xs rounded-lg px-1.5 py-1 text-left transition-colors ${!c.ok ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}>
              <span className={c.ok ? 'text-green-400' : 'text-red-400'}>{c.ok ? '✓' : '✗'}</span>
              <span className={c.ok ? 'text-slate-300' : 'text-slate-400'}>{c.label}</span>
              {!c.ok && <span className="text-[10px] text-slate-400 ml-auto">{c.fix} →</span>}
            </button>
          ))}
        </div>

        {app.is_published ? (
          <div className="space-y-2">
            {app.has_draft_changes && (
              <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-3 py-2 flex items-center gap-2">
                <span className="text-amber-400 text-sm">⚠</span>
                <p className="text-amber-300 text-xs">Blueprint has unpromoted changes — live users still see the old version.</p>
              </div>
            )}
            <button onClick={() => setShowPromote(true)}
              className="w-full text-sm font-semibold py-2.5 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white border-transparent shadow-lg shadow-[#6C5CE7]/20 transition-all">
              🚀 {app.has_draft_changes ? 'Promote draft to production' : 'Promote to production'}
            </button>
            <button onClick={togglePublish} disabled={publishing}
              className="w-full text-xs py-2 rounded-xl bg-white/4 hover:bg-white/8 text-slate-400 border border-white/8 transition-colors disabled:opacity-40">
              {publishing ? '…' : '⏸ Unpublish (set to draft)'}
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={togglePublish}
              disabled={publishing || !canPublish}
              title={!canPublish ? 'Complete checklist before publishing' : ''}
              className={`w-full text-sm font-semibold py-2.5 rounded-xl transition-all disabled:opacity-40 border ${
                canPublish
                  ? 'bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white border-transparent shadow-lg shadow-[#6C5CE7]/20'
                  : 'bg-white/3 text-slate-500 border-white/5 cursor-not-allowed'
              }`}
            >
              {publishing ? '…' : '🚀 Publish app'}
            </button>
            {!canPublish && (
              <p className="text-[10px] text-amber-400 text-center">Complete all checklist items to publish</p>
            )}
          </>
        )}
      </div>

      {showPromote && (
        <PromoteModal
          app={app}
          user={user}
          onClose={() => setShowPromote(false)}
          onPromoted={updated => { setApp(updated); onUpdate?.(updated) }}
        />
      )}

      {/* Run history summary */}
      {runStats && runStats.total > 0 && (
        <div className="bg-[#0A0F1E] border border-white/5 rounded-2xl px-5 py-4">
          <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-3">Run history</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Total runs', value: runStats.total.toLocaleString(), color: '#A29BFE' },
              { label: 'Satisfaction', value: runStats.satisfaction != null ? `${runStats.satisfaction}%` : '—', sub: runStats.rated ? `${runStats.rated} rated` : 'no ratings', color: runStats.satisfaction >= 80 ? '#00B894' : runStats.satisfaction >= 50 ? '#FDCB6E' : '#E84393' },
              { label: 'Avg input', value: runStats.avgIn ? `${runStats.avgIn.toLocaleString()} tok` : '—', color: '#74B9FF' },
              { label: 'Avg output', value: runStats.avgOut ? `${runStats.avgOut.toLocaleString()} tok` : '—', color: '#55EFC4' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="space-y-0.5">
                <p className="text-[9px] text-slate-600 uppercase font-semibold">{label}</p>
                <p className="text-base font-bold" style={{ color }}>{value}</p>
                {sub && <p className="text-[9px] text-slate-600">{sub}</p>}
              </div>
            ))}
          </div>
          {runStats.lastRun && (
            <p className="text-[10px] text-slate-600 mt-3">Last run: {runStats.lastRun.toLocaleDateString()} {runStats.lastRun.toLocaleTimeString()}</p>
          )}
        </div>
      )}
      {runStats && runStats.total === 0 && app.is_published && (
        <div className="bg-[#0A0F1E] border border-white/5 rounded-2xl px-5 py-4 text-center">
          <p className="text-[11px] text-slate-500">No runs yet — share the app link to get your first run.</p>
        </div>
      )}

      {/* App details */}
      <Section id="details" label="✎ App details">
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Description</label>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Explain what this app does, who it helps, and what result it produces."
              className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none"
            />
            <p className="text-[10px] text-slate-400">This is used by publishing, marketplace cards, and business users deciding whether to install the app.</p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] text-slate-500">
              Model: <span className="text-slate-300">{app.ai_model || 'not selected'}</span>
            </div>
            <button onClick={saveDescription} disabled={savingDescription || description.trim() === (app.description || '').trim()}
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] disabled:opacity-40 text-white transition-colors">
              {savingDescription ? 'Saving…' : 'Save description'}
            </button>
          </div>
        </div>
      </Section>

      {/* Share links */}
      <Section id="links" label="🔗 Share links & endpoints">
        {!app.is_published && (
          <p className="text-[11px] text-amber-400/80 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2 mb-2">
            ⚠️ App is not published yet. Links are inactive until you publish above.
          </p>
        )}
        <div className="space-y-2">
          {[
            { label: 'App page',         value: `${window.location.origin}/app/${app.id}` },
            { label: 'API endpoint',     value: `https://api.aistrix.com/v1/apps/${app.id}/run` },
            { label: 'Team install',     value: `${window.location.origin}/install/${app.id}` },
            { label: 'Inbound trigger',  value: `https://api.aistrix.com/v1/webhooks/${app.webhook_token || app.id}`, note: 'POST with {"input":"..."} to trigger a run headlessly' },
          ].map(({ label, value, note }) => (
            <div key={label} className="flex items-center gap-2 bg-[#0E1424] rounded-lg px-3 py-2 min-w-0">
              <div className="flex-1 min-w-0">
                <p className="text-[9px] text-slate-500 uppercase">{label}</p>
                <code className={`text-[10px] truncate block ${app.is_published ? 'text-slate-300' : 'text-slate-600'}`}>{value}</code>
                {note && <p className="text-[9px] text-slate-600 mt-0.5">{note}</p>}
              </div>
              <button onClick={() => copy(value, label)} className="text-slate-500 hover:text-white transition-colors text-xs shrink-0">📋</button>
            </div>
          ))}
        </div>
      </Section>

      {/* Embed code */}
      <Section id="embed" label="⬡ Embed code">
        <div className="space-y-3">
          <div className="flex gap-1 bg-[#0E1424] p-0.5 rounded-lg w-fit">
            {['iframe', 'js', 'api'].map(t => (
              <button key={t} onClick={() => setEmbedTab(t)}
                className={`text-[10px] font-semibold px-3 py-1 rounded-md transition-all ${embedTab === t ? 'bg-[#6C5CE7] text-white' : 'text-slate-500 hover:text-white'}`}>
                {t === 'iframe' ? 'iFrame' : t === 'js' ? 'JavaScript' : 'cURL / API'}
              </button>
            ))}
          </div>
          <div className="relative">
            <pre className="text-[11px] text-slate-300 bg-[#0E1424] rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap">{embedCodes[embedTab]}</pre>
            <button onClick={() => copy(embedCodes[embedTab], 'Embed code')}
              className="absolute top-2 right-2 text-[10px] text-slate-500 hover:text-white bg-white/5 px-2 py-1 rounded-md transition-colors">
              📋 Copy
            </button>
          </div>
        </div>
      </Section>

      {/* Context requirements */}
      <Section id="context" label="🔐 Required context (user profiles)">
        <div className="space-y-2">
          <p className="text-[11px] text-slate-300 leading-relaxed">
            When enabled, Aistrix prompts the business user to fill their profile before running this app.
            The profile data is automatically injected into the AI context.
          </p>
          {CONTEXT_OPTS.map(opt => {
            const active = (app.required_context || []).includes(opt.id)
            return (
              <label key={opt.id} className="flex items-start gap-3 cursor-pointer group">
                <div
                  onClick={() => toggleContext(opt.id)}
                  className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer ${active ? 'bg-[#6C5CE7] border-[#6C5CE7]' : 'border-white/20 group-hover:border-white/40'}`}>
                  {active && <span className="text-white text-[9px] font-bold">✓</span>}
                </div>
                <div onClick={() => toggleContext(opt.id)}>
                  <p className="text-xs text-slate-300 font-medium">{opt.label}</p>
                  <p className="text-[10px] text-slate-500">{opt.desc}</p>
                </div>
              </label>
            )
          })}
        </div>
      </Section>

      {/* Webhook */}
      <Section id="webhook" label="🔔 Webhook (post-run callback)">
        <div className="space-y-2">
          <p className="text-[11px] text-slate-300">
            Aistrix will POST the run result to this URL after every successful run.
            Useful for Zapier, Make, or your own backend.
          </p>
          <div className="flex gap-2">
            <input
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="flex-1 bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            />
            <button onClick={saveWebhook} disabled={savingWebhook}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors disabled:opacity-40 shrink-0">
              {savingWebhook ? '…' : 'Save'}
            </button>
          </div>
          {app.webhook_url && (
            <div className="bg-[#0E1424] rounded-lg px-3 py-2">
              <p className="text-[9px] text-slate-500 uppercase font-semibold mb-1">Payload sent on each run</p>
              <pre className="text-[10px] text-slate-300 leading-relaxed">{`{
  "app_id": "${app.id}",
  "app_name": "${app.name}",
  "input": "<user input>",
  "output": "<AI output>",
  "run_id": "<uuid>",
  "user_id": "<end user id>",
  "timestamp": "<ISO 8601>"
}`}</pre>
            </div>
          )}
        </div>
      </Section>

      {/* Run quota */}
      <Section id="quota" label="⚡ Run quota (daily limit)">
        <div className="space-y-2">
          <p className="text-[11px] text-slate-300">
            Limit how many times this app can be run per day across all users.
            Leave blank for unlimited.
          </p>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              value={maxRuns}
              onChange={e => setMaxRuns(e.target.value)}
              placeholder="e.g. 500 (unlimited if blank)"
              min="1"
              className="flex-1 bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            />
            <button onClick={saveQuota} disabled={savingQuota}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors disabled:opacity-40 shrink-0">
              {savingQuota ? '…' : 'Save'}
            </button>
          </div>
        </div>
      </Section>
    </div>
  )
}

function SdkSnippets({ app }) {
  const [lang, setLang] = useState('curl')
  const [copied, setCopied] = useState(null)
  const appId = app.id
  const token = app.webhook_token || appId

  function cp(text, key) {
    navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500) })
  }

  const snippets = {
    curl: {
      label: 'cURL',
      code: `curl -X POST https://api.aistrix.com/v1/apps/${appId}/run \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Your input here"}'`,
    },
    python: {
      label: 'Python',
      code: `import requests

response = requests.post(
    "https://api.aistrix.com/v1/apps/${appId}/run",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"input": "Your input here"}
)
print(response.json()["output"])`,
    },
    node: {
      label: 'Node.js',
      code: `const res = await fetch("https://api.aistrix.com/v1/apps/${appId}/run", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ input: "Your input here" })
})
const { output } = await res.json()
console.log(output)`,
    },
    trigger: {
      label: 'Inbound trigger',
      code: `# Trigger a run by POSTing to your inbound webhook URL.
# No API key needed — the URL itself is the secret.

curl -X POST https://api.aistrix.com/v1/webhooks/${token} \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Your input here"}'`,
    },
  }

  const current = snippets[lang]
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white font-semibold uppercase tracking-wide">Integration snippets</p>
        <div className="flex gap-0.5 bg-[#0E1424] p-0.5 rounded-lg">
          {Object.entries(snippets).map(([key, { label }]) => (
            <button key={key} onClick={() => setLang(key)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-all ${lang === key ? 'bg-[#6C5CE7] text-white' : 'text-slate-500 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <pre className="text-[11px] text-slate-300 bg-[#0A0F1E] rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre">{current.code}</pre>
        <button onClick={() => cp(current.code, lang)}
          className="absolute top-2 right-2 text-[10px] text-slate-500 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-1 rounded-md transition-colors">
          {copied === lang ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <p className="text-[10px] text-slate-500">Get your API key from the API Keys section above. Keep it secret — treat it like a password.</p>
    </div>
  )
}

function DeployTab({ apps, user, onAppUpdated, onFixInDesign, selectedAppId, onSelectApp, phaseByAppId = {} }) {
  const activeAppId = apps.some(a => a.id === selectedAppId) ? selectedAppId : apps[0]?.id ?? null
  const selectedApp = apps.find(a => a.id === activeAppId)

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Create an app in the Design tab to start deploying.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Selected app deploy card */}
      {selectedApp && <AppDeployCard key={selectedApp.id} app={selectedApp} onUpdate={onAppUpdated} onFixInDesign={onFixInDesign} user={user} />}

      {/* API Keys */}
      <ApiKeySection user={user} />

      {/* SDK / Integration snippets */}
      {selectedApp && <SdkSnippets app={selectedApp} />}
    </div>
  )
}

// ─── Marketplace listing helpers ─────────────────────────────────────────────

const LISTING_SETUP_SQL = `create table marketplace_listings (
  id          uuid primary key default gen_random_uuid(),
  app_id      uuid references apps(id) on delete cascade unique,
  user_id     uuid references auth.users(id) on delete cascade,
  title       text not null,
  tagline     text,
  description text,
  category    text,
  tags        text[],
  status      text not null default 'draft',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table marketplace_listings enable row level security;
create policy "owner" on marketplace_listings
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);`

const LISTING_CATEGORIES = [
  'Productivity', 'Writing & Content', 'Data & Analysis',
  'Customer Support', 'HR & Recruiting', 'Sales & Marketing',
  'Legal & Compliance', 'Engineering', 'Education', 'Other',
]
const STATUS_COLORS = {
  draft:     'bg-slate-500/10 text-slate-400',
  submitted: 'bg-amber-500/10 text-amber-400',
  approved:  'bg-emerald-500/10 text-emerald-400',
  live:      'bg-emerald-500/15 text-emerald-300',
  rejected:  'bg-red-500/10 text-red-400',
}

function ListingSetupCard({ onRetry }) {
  return (
    <div className="bg-[#171B33] border border-[#6C5CE7]/20 rounded-2xl p-6 space-y-4 text-center">
      <div className="text-3xl">🛒</div>
      <div>
        <p className="text-white font-semibold text-sm">Marketplace setup in progress</p>
        <p className="text-slate-400 text-sm mt-1">
          Marketplace listings are managed automatically by Aistrix.<br />
          This feature will be available shortly — no action needed on your end.
        </p>
      </div>
      <button onClick={onRetry} className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
        ↺ Check again
      </button>
    </div>
  )
}

function MarketplaceListings({ apps, user }) {
  const [listings, setListings]   = useState(null)   // null = not loaded yet
  const [needsSetup, setNeedsSetup] = useState(false)
  const [editId, setEditId]       = useState(null)   // app.id being edited
  const [form, setForm]           = useState({})
  const [saving, setSaving]       = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const { data, error } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('user_id', user.id)
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) { setNeedsSetup(true); return }
      toast(error.message, 'error'); return
    }
    setNeedsSetup(false)
    setListings(data || [])
  }

  function listingFor(appId) { return listings?.find(l => l.app_id === appId) }

  function openEdit(app) {
    const l = listingFor(app.id)
    setForm({
      title:       l?.title       ?? app.name,
      tagline:     l?.tagline     ?? '',
      description: l?.description ?? app.description ?? '',
      category:    l?.category    ?? '',
      tags:        (l?.tags ?? []).join(', '),
    })
    setEditId(app.id)
  }

  async function saveListing() {
    if (!form.title?.trim()) { toast('Title is required', 'error', 2000); return }
    setSaving(true)
    const payload = {
      app_id:      editId,
      user_id:     user.id,
      title:       form.title.trim(),
      tagline:     form.tagline.trim() || null,
      description: form.description.trim() || null,
      category:    form.category || null,
      tags:        form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      updated_at:  new Date().toISOString(),
    }
    const existing = listingFor(editId)
    let data, error
    if (existing) {
      ;({ data, error } = await supabase.from('marketplace_listings').update(payload).eq('id', existing.id).select().single())
    } else {
      ;({ data, error } = await supabase.from('marketplace_listings').insert(payload).select().single())
    }
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setListings(prev => existing ? prev.map(l => l.id === data.id ? data : l) : [...(prev || []), data])
    setEditId(null)
    toast('Listing saved', 'success', 2000)
  }

  function publishGateErrors(app) {
    const l = listingFor(app.id)
    const errs = []
    if (!app.system_prompt?.trim())           errs.push({ key: 'prompt',   label: 'System prompt is empty — add one in Design' })
    if (!app.is_published)                    errs.push({ key: 'deploy',   label: 'App is not deployed — publish it in Deploy' })
    if (app.is_paid && !(parseFloat(app.price_per_run) > 0))
                                              errs.push({ key: 'price',    label: 'Paid app has no price — set one in Marketplace' })
    if (!l?.title?.trim())                    errs.push({ key: 'title',    label: 'Listing title is missing — fill in the form above' })
    if (!l?.tagline?.trim())                  errs.push({ key: 'tagline',  label: 'Tagline is missing — one sentence description' })
    if (!l?.category)                         errs.push({ key: 'category', label: 'Category not selected' })
    if (!(app.total_runs > 0))                errs.push({ key: 'run',      label: 'No runs yet — run the app at least once' })
    return errs
  }

  async function submitListing(appId) {
    const l = listingFor(appId)
    if (!l) { toast('Save a listing first', 'error', 2000); return }
    const app = apps.find(a => a.id === appId)
    const errs = publishGateErrors(app || {})
    if (errs.length) { toast(errs[0].label, 'error', 3500); return }
    // Auto-approve: go live immediately (admin review can be added later)
    const { data, error } = await supabase.from('marketplace_listings')
      .update({ status: 'live', updated_at: new Date().toISOString() })
      .eq('id', l.id).select().single()
    if (error) { toast(error.message, 'error'); return }
    setListings(prev => prev.map(x => x.id === data.id ? data : x))
    toast('🎉 Your app is live on the Marketplace!', 'success', 4000)
    track(EVENTS.LISTING_SUBMITTED, { app_id: appId })
  }

  if (needsSetup) return <ListingSetupCard onRetry={load} />
  if (listings === null) return <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Marketplace listings</p>
      </div>

      {apps.map(app => {
        const l         = listingFor(app.id)
        const isEditing = editId === app.id
        const statusCls = STATUS_COLORS[l?.status] ?? STATUS_COLORS.draft

        return (
          <div key={app.id} className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
            {/* Header row */}
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-lg shrink-0">{app.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{app.name}</p>
                {l?.tagline && <p className="text-[11px] text-slate-300 truncate">{l.tagline}</p>}
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>
                {l?.status ?? 'no listing'}
              </span>
              <button
                onClick={() => isEditing ? setEditId(null) : openEdit(app)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors">
                {isEditing ? 'Cancel' : l ? 'Edit' : '+ Create'}
              </button>
              {l && l.status === 'draft' && !isEditing && (() => {
                const errs = publishGateErrors(app)
                return errs.length === 0 ? (
                  <button onClick={() => submitListing(app.id)}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
                    Go live →
                  </button>
                ) : (
                  <div className="relative group">
                    <button disabled
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white/5 text-slate-500 cursor-not-allowed border border-white/10">
                      {errs.length} issue{errs.length !== 1 ? 's' : ''} ⚠️
                    </button>
                    {/* Tooltip */}
                    <div className="absolute right-0 top-8 z-20 hidden group-hover:block w-64 bg-[#0E1424] border border-white/10 rounded-xl p-3 shadow-xl">
                      <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-2">Fix before going live</p>
                      <ul className="space-y-1.5">
                        {errs.map(e => (
                          <li key={e.key} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                            <span className="text-red-400 shrink-0 mt-0.5">✕</span> {e.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              })()}
              {l && (l.status === 'live' || l.status === 'approved') && (
                <a href={`/marketplace/${app.id}`} target="_blank" rel="noreferrer"
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors">
                  View ↗
                </a>
              )}
            </div>

            {/* Inline form */}
            {isEditing && (
              <div className="border-t border-white/5 px-4 py-4 space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide block mb-1">Title *</label>
                    <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                      className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide block mb-1">Tagline</label>
                    <input value={form.tagline} onChange={e => setForm(p => ({ ...p, tagline: e.target.value }))}
                      placeholder="One sentence pitch"
                      className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide block mb-1">Description</label>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={3} placeholder="What does this app do? Who is it for?"
                    className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide block mb-1">Category</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                      className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40">
                      <option value="">Select…</option>
                      {LISTING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide block mb-1">Tags <span className="text-slate-600 normal-case font-normal">(comma-separated)</span></label>
                    <input value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))}
                      placeholder="resume, hr, onboarding"
                      className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={saveListing} disabled={saving}
                    className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
                    {saving ? '…' : 'Save listing'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Tab: Sell ────────────────────────────────────────────────────────────────

function SellTab({ apps, user, onAppUpdated }) {
  const [saving, setSaving] = useState({})   // appId → bool
  const [drafts, setDrafts] = useState({})   // appId → { is_paid, price_per_run }
  const toast = useToast()

  function draft(app) {
    return drafts[app.id] ?? { is_paid: app.is_paid ?? false, price_per_run: app.price_per_run ?? '' }
  }

  function setDraft(appId, patch) {
    setDrafts(prev => ({ ...prev, [appId]: { ...draft({ id: appId, ...apps.find(a => a.id === appId) }), ...patch } }))
  }

  async function save(app) {
    const d = draft(app)
    const price = d.is_paid ? parseFloat(d.price_per_run) : null
    if (d.is_paid && (isNaN(price) || price <= 0)) {
      toast('Enter a valid price per run (e.g. 0.05)', 'error', 3000)
      return
    }
    setSaving(prev => ({ ...prev, [app.id]: true }))
    const { data, error } = await supabase.from('apps')
      .update({ is_paid: d.is_paid, price_per_run: price })
      .eq('id', app.id)
      .select().single()
    setSaving(prev => ({ ...prev, [app.id]: false }))
    if (error) { toast(error.message, 'error'); return }
    onAppUpdated?.(data)
    toast('Pricing saved', 'success', 2000)
    setDrafts(prev => { const n = { ...prev }; delete n[app.id]; return n })
  }

  if (!apps.length) {
    return (
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
        <p className="text-slate-400 text-sm">No apps yet — create one in the Design tab first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Setup mode banner */}
      <div className="flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3">
        <span className="text-amber-400 text-lg shrink-0 mt-0.5">⚠️</span>
        <div>
          <p className="text-amber-300 text-sm font-semibold">Payments are in setup mode</p>
          <p className="text-amber-200/60 text-xs mt-0.5 leading-relaxed">
            Checkout and payouts require backend activation. You can configure pricing now,
            but live transactions will not be processed until Stripe Connect is enabled by Aistrix.
          </p>
        </div>
      </div>
      <div>
        <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-3">Pricing editor</p>
        <div className="space-y-3">
          {apps.map(app => {
            const d     = draft(app)
            const dirty = JSON.stringify(d) !== JSON.stringify({ is_paid: app.is_paid ?? false, price_per_run: app.price_per_run ?? '' })
            const rev   = d.is_paid && parseFloat(d.price_per_run) > 0
              ? `~$${(parseFloat(d.price_per_run) * (app.total_runs || 0)).toFixed(2)} projected revenue`
              : null
            return (
              <div key={app.id} className="bg-[#171B33] border border-white/5 rounded-2xl p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-lg shrink-0">{app.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{app.name}</p>
                    <p className="text-[10px] text-slate-500">{app.total_runs || 0} total runs</p>
                  </div>

                  {/* Free / Paid toggle */}
                  <div className="flex items-center gap-1 bg-[#0E1424] rounded-lg p-0.5">
                    <button
                      onClick={() => setDraft(app.id, { is_paid: false })}
                      className={`text-[11px] font-semibold px-3 py-1.5 rounded-md transition-all ${!d.is_paid ? 'bg-[#1A2038] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
                      Free
                    </button>
                    <button
                      onClick={() => setDraft(app.id, { is_paid: true })}
                      className={`text-[11px] font-semibold px-3 py-1.5 rounded-md transition-all ${d.is_paid ? 'bg-amber-500/20 text-amber-300' : 'text-slate-500 hover:text-slate-300'}`}>
                      Paid
                    </button>
                  </div>

                  {/* Price input (only when paid) */}
                  {d.is_paid && (
                    <div className="flex items-center gap-1.5 bg-[#0E1424] border border-white/10 rounded-lg px-3 py-1.5">
                      <span className="text-slate-300 text-xs">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={d.price_per_run}
                        onChange={e => setDraft(app.id, { price_per_run: e.target.value })}
                        placeholder="0.05"
                        className="bg-transparent text-white text-xs w-16 focus:outline-none"
                      />
                      <span className="text-slate-600 text-[10px]">/ run</span>
                    </div>
                  )}

                  {/* Save button */}
                  {dirty && (
                    <button
                      onClick={() => save(app)}
                      disabled={saving[app.id]}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
                      {saving[app.id] ? '…' : 'Save'}
                    </button>
                  )}
                </div>

                {/* Revenue projection */}
                {rev && (
                  <p className="text-[10px] text-emerald-400 mt-2 ml-8">
                    {rev} · based on historical run count
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Developer profile */}
      <Suspense fallback={null}>
        <DeveloperProfileEditor user={user} />
      </Suspense>

      {/* Marketplace listing editor */}
      <MarketplaceListings apps={apps} user={user} />

      {/* Stripe stub */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <span className="text-3xl shrink-0">💳</span>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">Billing & Payouts via Stripe</p>
            <p className="text-slate-300 text-xs mt-1 leading-relaxed">
              Aistrix uses <strong className="text-slate-300">Stripe Checkout</strong> for business-user payments and <strong className="text-slate-300">Stripe Connect</strong> for developer payouts. Connect your Stripe account to start collecting revenue from paid apps.
            </p>
            <ul className="mt-2 space-y-1">
              {['Pay-per-run and subscription billing', 'Automatic developer payouts (Stripe Connect)', 'Team & enterprise license deals', 'Full payout dashboard inside Aistrix'].map(b => (
                <li key={b} className="text-[11px] text-slate-300 flex items-center gap-1.5">
                  <span className="text-[#6C5CE7]">·</span>{b}
                </li>
              ))}
            </ul>
          </div>
          <a
            href="https://dashboard.stripe.com/register"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs font-semibold px-3 py-2 rounded-lg border border-[#6C5CE7]/30 text-[#A29BFE] hover:bg-[#6C5CE7]/10 transition-colors whitespace-nowrap">
            Set up Stripe →
          </a>
        </div>
        <p className="text-[10px] text-slate-400 mt-3 border-t border-white/5 pt-3">
          Stripe Connect integration will be activated by the Aistrix team once your account is verified. The "Set up Stripe" button opens Stripe's registration page.
        </p>
      </div>
    </div>
  )
}

// ─── Monitor helpers ──────────────────────────────────────────────────────────

// Inline sparkline — no chart library needed
function Sparkline({ data, color = '#6C5CE7', height = 36 }) {
  if (!data?.length) return null
  const max = Math.max(...data, 1)
  const w = 100, h = height
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (v / max) * (h - 4)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {data.map((v, i) => {
        const x = (i / (data.length - 1)) * w
        const y = h - (v / max) * (h - 4)
        return <circle key={i} cx={x} cy={y} r="2" fill={color} opacity={0.7} />
      })}
    </svg>
  )
}

// Thumbs up/down distribution bar
function ThumbsBars({ dist }) {
  const total = dist.up + dist.down
  if (!total) return <p className="text-slate-600 text-xs">No feedback yet</p>
  return (
    <div className="space-y-2">
      {[{ label: '👍 Useful', count: dist.up, color: '#00B894' }, { label: '👎 Not useful', count: dist.down, color: '#E84393' }].map(({ label, count, color }) => {
        const pct = total ? Math.round((count / total) * 100) : 0
        return (
          <div key={label} className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 w-20 shrink-0">{label}</span>
            <div className="flex-1 bg-[#0E1424] rounded-full h-1.5">
              <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="text-[10px] text-slate-500 w-6 text-right">{count}</span>
          </div>
        )
      })}
    </div>
  )
}

// Observability integration connection card
function IntegrationCard({ icon, name, desc, docsUrl, fields, savedKeys, onSave }) {
  const [open, setOpen]     = useState(false)
  const [vals, setVals]     = useState(() => Object.fromEntries(fields.map(f => [f.key, savedKeys?.[f.key] || ''])))
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  async function save() {
    setSaving(true)
    await onSave(vals)
    setSaving(false)
    setOpen(false)
    toast(`${name} settings saved`, 'success', 2000)
  }

  const connected = fields.every(f => savedKeys?.[f.key])
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-2xl shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium">{name}</p>
          <p className="text-[11px] text-slate-300 truncate">{desc}</p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-slate-500'}`}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
        <button onClick={() => setOpen(p => !p)}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors shrink-0">
          {open ? 'Cancel' : connected ? 'Edit' : 'Connect'}
        </button>
        {docsUrl && (
          <a href={docsUrl} target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-slate-300 hover:text-slate-300 transition-colors shrink-0">Docs ↗</a>
        )}
      </div>
      {open && (
        <div className="border-t border-white/5 px-4 py-4 space-y-3">
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide block mb-1">{f.label}</label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={vals[f.key]}
                onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono"
              />
              {f.hint && <p className="text-[10px] text-slate-400 mt-1">{f.hint}</p>}
            </div>
          ))}
          <div className="flex justify-end">
            <button onClick={save} disabled={saving}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
              {saving ? '…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Monitor ────────────────────────────────────────────────────────────

function MonitorTab({ apps, appStats, loading, totalStats, runs, entitlements, user }) {
  const [expandedApp, setExpandedApp]   = useState(null)
  const [integrations, setIntegrations] = useState(null)   // loaded from developer_settings
  const [intSetupNeeded, setIntSetupNeeded] = useState(false)
  const toast = useToast()

  useEffect(() => { loadIntegrations() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadIntegrations() {
    const { data, error } = await supabase
      .from('developer_settings')
      .select('settings')
      .eq('user_id', user.id)
      .single()
    if (error) {
      if (error.code === 'PGRST116') { setIntegrations({}); return }  // no row yet
      if (error.code === '42P01') { setIntSetupNeeded(true); return }
      return
    }
    setIntegrations(data?.settings || {})
  }

  async function saveIntegration(key, vals) {
    const merged = { ...(integrations || {}), [key]: vals }
    const { error } = await supabase.from('developer_settings')
      .upsert({ user_id: user.id, settings: merged }, { onConflict: 'user_id' })
    if (error) { toast(error.message, 'error'); return }
    setIntegrations(merged)
  }

  async function refreshBadges() {
    const { error } = await supabase.rpc('update_app_badges')
    if (error) toast(error.message, 'error')
    else toast('Trust badges updated', 'success')
  }

  // Build 30-day run volume buckets across all apps
  const volumeChart = useMemo(() => {
    const days = 30
    const buckets = Array.from({ length: days }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i)); d.setHours(0,0,0,0)
      return { label: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }), count: 0 }
    })
    runs.forEach(r => {
      const d = new Date(r.created_at); d.setHours(0,0,0,0)
      const idx = buckets.findIndex(b => {
        const bd = new Date(b.label + ' ' + new Date().getFullYear()); bd.setHours(0,0,0,0)
        return bd.getTime() === d.getTime()
      })
      // simpler: diff from today
      const today = new Date(); today.setHours(0,0,0,0)
      const diff = Math.round((today - d) / 86400000)
      if (diff >= 0 && diff < days) buckets[days - 1 - diff].count++
    })
    return buckets
  }, [runs])

  // Thumbs distribution (rating=1 → 👍, rating=0 → 👎)
  const thumbsDist = useMemo(() => {
    const dist = { up: 0, down: 0 }
    runs.forEach(r => {
      if (r.rating_value === 1)       dist.up++
      else if (r.rating_value === -1) dist.down++
    })
    return dist
  }, [runs])

  // Token usage last 14 days
  const tokenChart = useMemo(() => {
    const days = 14
    const buckets = Array.from({ length: days }, () => ({ in: 0, out: 0 }))
    runs.forEach(r => {
      if (!r.input_tokens && !r.output_tokens) return
      const today = new Date(); today.setHours(0,0,0,0)
      const d = new Date(r.created_at); d.setHours(0,0,0,0)
      const diff = Math.round((today - d) / 86400000)
      if (diff >= 0 && diff < days) {
        buckets[days - 1 - diff].in  += r.input_tokens  || 0
        buckets[days - 1 - diff].out += r.output_tokens || 0
      }
    })
    return buckets
  }, [runs])

  // Entitlement-derived stats
  const activeEnt   = (entitlements || []).filter(e => e.status === 'active')
  const paidEnt     = (entitlements || []).filter(e => ['active', 'paid'].includes(e.status))
  const subCount    = new Set(activeEnt.map(e => e.user_id)).size
  const paidCount   = new Set(paidEnt.map(e => e.user_id)).size

  // Per-app run counts for breakdown chart
  const appRunCounts = useMemo(() => {
    return apps.map(a => ({
      id: a.id, name: a.name, emoji: a.emoji,
      count: runs.filter(r => r.app_id === a.id).length,
    })).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [apps, runs])

  if (loading) return <p className="text-slate-500 text-sm py-10 text-center">Loading…</p>

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Publish an app to start seeing monitor data.</p>
    </div>
  )

  const thumbsTotal  = thumbsDist.up + thumbsDist.down
  const satisfaction = thumbsTotal ? Math.round((thumbsDist.up / thumbsTotal) * 100) : null

  return (
    <div className="space-y-6">
      {/* ── Top stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Total runs" value={totalStats.runs} color="#6C5CE7" />
        <StatTile label="Unique users" value={totalStats.users} color="#00B894" />
        <StatTile label="Satisfaction" value={satisfaction !== null ? `${satisfaction}%` : '—'} color="#FDCB6E"
          sub={thumbsTotal ? `${thumbsTotal} rated` : undefined} />
        <StatTile label="Active apps" value={apps.filter(a => a.is_published).length} color="#E84393" />
      </div>

      {/* ── Subscriber tiles ── */}
      {(entitlements || []).length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Active subscribers" value={subCount} color="#00B894" sub="status = active" />
          <StatTile label="Paying customers" value={paidCount} color="#FDCB6E" sub="ever purchased" />
          <StatTile label="Entitlements" value={(entitlements || []).length} color="#6C5CE7" sub="all time" />
          <StatTile label="Subscriptions" value={activeEnt.filter(e => e.plan === 'subscription').length} color="#A29BFE" sub="recurring" />
        </div>
      )}

      {/* ── Per-app run breakdown ── */}
      {appRunCounts.length > 1 && (
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-4">Runs by app</p>
          <div className="space-y-2">
            {appRunCounts.map(({ id, name, emoji, count }) => {
              const max = appRunCounts[0].count || 1
              const pct = Math.max((count / max) * 100, count > 0 ? 2 : 0)
              return (
                <div key={id} className="flex items-center gap-3">
                  <span className="text-base w-6 shrink-0">{emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs text-slate-300 truncate">{name}</p>
                      <p className="text-xs text-slate-300 shrink-0 ml-2">{count.toLocaleString()}</p>
                    </div>
                    <div className="h-1.5 bg-[#0E1424] rounded-full overflow-hidden">
                      <div className="h-full bg-[#6C5CE7] rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Run volume chart (30 days) ── */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Run volume — last 30 days</p>
          <p className="text-xs text-slate-300">{totalStats.runs} total</p>
        </div>
        <div className="flex items-end gap-0.5 h-16">
          {volumeChart.map((b, i) => {
            const max = Math.max(...volumeChart.map(x => x.count), 1)
            const h   = Math.max((b.count / max) * 56, b.count > 0 ? 3 : 0)
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                <div className="w-full bg-[#6C5CE7] rounded-t transition-all" style={{ height: h }} />
                <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-[#0E1424] text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                  {b.label}: {b.count}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-slate-600">
          <span>{volumeChart[0]?.label}</span>
          <span>{volumeChart[volumeChart.length - 1]?.label}</span>
        </div>
      </div>

      {/* ── Rating dist + token usage ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-4">Feedback distribution</p>
          <ThumbsBars dist={thumbsDist} />
          {satisfaction !== null && (
            <p className="text-xs text-slate-300 mt-3">
              <span className="text-emerald-400 font-semibold">{satisfaction}% 👍</span> across {thumbsTotal} rated runs
            </p>
          )}
        </div>

        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-4">Token usage — last 14 days</p>
          <div className="space-y-3">
            {[
              { label: 'Input tokens',  data: tokenChart.map(b => b.in),  color: '#6C5CE7' },
              { label: 'Output tokens', data: tokenChart.map(b => b.out), color: '#00B894' },
            ].map(({ label, data, color }) => {
              const total = data.reduce((s, v) => s + v, 0)
              return (
                <div key={label}>
                  <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                    <span>{label}</span>
                    <span>{total.toLocaleString()}</span>
                  </div>
                  <Sparkline data={data} color={color} height={28} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Per-app cards ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Per-app health</p>
          <button onClick={refreshBadges}
            className="text-xs text-slate-400 hover:text-white bg-[#1F2444] hover:bg-[#272C52] px-3 py-1.5 rounded-lg transition-colors">
            🏆 Refresh trust badges
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {apps.map(app => {
            const s = appStats[app.id] || { uniqueUsers: 0, thumbsUp: 0, rated: 0, daily: new Array(7).fill(0) }
            const satisfaction = s.rated > 0 ? Math.round((s.thumbsUp / s.rated) * 100) : null
            const appThumbsDist = { up: s.thumbsUp || 0, down: Math.max((s.rated || 0) - (s.thumbsUp || 0), 0) }
            // Health score: 0-100
            const health = (() => {
              if (!s.rated) return null
              let score = (s.thumbsUp / s.rated) * 60          // satisfaction 60%
              if (app.total_runs > 10) score += 20             // volume 20%
              if (app.is_published) score += 10                // published 10%
              if (app.is_verified)  score += 10                // verified  10%
              return Math.min(100, Math.round(score))
            })()
            const healthColor = health === null ? '#334155' : health >= 70 ? '#00B894' : health >= 40 ? '#FDCB6E' : '#E84393'

            return (
              <div key={app.id} className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                      style={{ background: (app.color || '#6C5CE7') + '33' }}>
                      <AppEmojiWithType app={app} />
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{app.name}</p>
                      <div className="flex gap-1 mt-0.5 flex-wrap items-center">
                        {app.is_verified  && <span className="text-[9px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full">✓ Verified</span>}
                        {app.is_trending  && <span className="text-[9px] text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded-full">🔥 Trending</span>}
                        {app.is_top_rated && <span className="text-[9px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-full">⭐ Top Rated</span>}
                      </div>
                    </div>
                  </div>
                  {health !== null && (
                    <div className="flex flex-col items-end">
                      <span className="text-lg font-bold" style={{ color: healthColor }}>{health}</span>
                      <span className="text-[9px] text-slate-600">health score</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'Total runs',   value: app.total_runs || 0 },
                    { label: 'Unique users', value: s.uniqueUsers },
                    { label: 'Satisfaction', value: satisfaction !== null ? `${satisfaction}%` : '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-[#1F2444] rounded-xl p-3 text-center">
                      <p className="text-white font-bold text-lg">{value}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-slate-500 uppercase">Run volume · last 7 days</p>
                    <p className="text-[10px] text-slate-400">{s.daily.reduce((a, b) => a + b, 0)} runs</p>
                  </div>
                  <div className="flex items-end gap-1 h-8">
                    {s.daily.map((count, i) => {
                      const max = Math.max(...s.daily, 1)
                      return <div key={i} className="flex-1 bg-[#6C5CE7] rounded-t opacity-70"
                        style={{ height: `${Math.max((count / max) * 28, count > 0 ? 3 : 0)}px` }} />
                    })}
                  </div>
                </div>

                {s.rated > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] text-slate-500 uppercase mb-2">Feedback breakdown</p>
                    <ThumbsBars dist={appThumbsDist} />
                  </div>
                )}

                <button onClick={() => setExpandedApp(p => p === app.id ? null : app.id)}
                  className="w-full text-xs text-slate-300 hover:text-white bg-[#1F2444] py-1.5 rounded-lg transition-colors">
                  {expandedApp === app.id ? '▲ Hide tools' : '🔧 Manage tools'}
                </button>
                {expandedApp === app.id && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <ToolsEditor appId={app.id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Observability integrations ── */}
      <div>
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">Observability integrations</p>
        {intSetupNeeded && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 mb-3 text-xs text-amber-400">
            Run <code className="bg-black/20 px-1 rounded">create table developer_settings (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) unique, settings jsonb default '&#123;&#125;'); alter table developer_settings enable row level security; create policy "owner" on developer_settings using (auth.uid() = user_id) with check (auth.uid() = user_id);</code> in Supabase, then reload.
          </div>
        )}
        <div className="space-y-3">
          <IntegrationCard
            icon="🔭"
            name="Langfuse"
            desc="LLM tracing, prompt management, cost and latency tracking per run."
            docsUrl="https://langfuse.com/docs"
            fields={[
              { key: 'langfuse_public_key', label: 'Public key',  placeholder: 'pk-lf-…', secret: false, hint: 'Found in your Langfuse project settings → API keys' },
              { key: 'langfuse_secret_key', label: 'Secret key',  placeholder: 'sk-lf-…', secret: true  },
              { key: 'langfuse_host',       label: 'Host (optional)', placeholder: 'https://cloud.langfuse.com', secret: false },
            ]}
            savedKeys={integrations?.langfuse}
            onSave={vals => saveIntegration('langfuse', vals)}
          />
          <IntegrationCard
            icon="🛡️"
            name="Sentry"
            desc="Frontend and backend error tracking — captures exceptions and traces."
            docsUrl="https://docs.sentry.io"
            fields={[
              { key: 'dsn', label: 'DSN', placeholder: 'https://…@o….ingest.sentry.io/…', secret: false,
                hint: 'Sentry project → Settings → Client Keys (DSN)' },
            ]}
            savedKeys={integrations?.sentry}
            onSave={vals => saveIntegration('sentry', vals)}
          />
        </div>
        <p className="text-[10px] text-slate-400 mt-2">Keys are stored in your Supabase account (developer_settings table) and only readable by you. The Aistrix backend uses them to forward traces automatically.</p>
      </div>
    </div>
  )
}

// ─── Tab: Evaluate ────────────────────────────────────────────────────────────

function QualityScore({ score }) {
  const color = score === null ? '#334155' : score >= 70 ? '#00B894' : score >= 40 ? '#FDCB6E' : '#E84393'
  const label = score === null ? 'No data' : score >= 70 ? 'Good' : score >= 40 ? 'Fair' : 'Poor'
  const r = 20, circ = 2 * Math.PI * r
  const dash = score !== null ? (score / 100) * circ : 0
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="#1F2444" strokeWidth="4" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 28 28)" style={{ transition: 'stroke-dasharray 0.6s ease' }} />
        <text x="28" y="33" textAnchor="middle" fill={color} fontSize="13" fontWeight="700">
          {score !== null ? score : '—'}
        </text>
      </svg>
      <span className="text-[10px] font-semibold" style={{ color }}>{label}</span>
    </div>
  )
}

function EvaluateTab({ apps, appStats, runs, user }) {
  const [selectedApp, setSelectedApp] = useState(apps[0]?.id || null)

  const [expandRun, setExpandRun]     = useState(null)
  const [integrations, setIntegrations] = useState(null)
  const toast = useToast()

  useEffect(() => { loadIntegrations() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadIntegrations() {
    const { data, error } = await supabase
      .from('developer_settings').select('settings').eq('user_id', user.id).single()
    if (error) { setIntegrations({}); return }
    setIntegrations(data?.settings || {})
  }

  async function saveIntegration(key, vals) {
    const merged = { ...(integrations || {}), [key]: vals }
    const { error } = await supabase.from('developer_settings')
      .upsert({ user_id: user.id, settings: merged }, { onConflict: 'user_id' })
    if (error) { toast(error.message, 'error'); return }
    setIntegrations(merged)
  }

  // Per-app quality score (0-100): 70% satisfaction + 30% test pass rate (if available)
  function qualityScore(app) {
    const s = appStats[app.id] || {}
    if (!s.rated) return null
    const satisfaction = s.rated > 0 ? (s.thumbsUp / s.rated) : 0
    return Math.min(100, Math.round(satisfaction * 100))
  }

  // Satisfaction % trend per day for selected app, last 21 days
  const ratingTrend = useMemo(() => {
    const days = 21
    const buckets = Array.from({ length: days }, () => ({ up: 0, total: 0 }))
    runs
      .filter(r => r.app_id === selectedApp && (r.rating_value === 1 || r.rating_value === -1))
      .forEach(r => {
        const today = new Date(); today.setHours(0,0,0,0)
        const d = new Date(r.created_at); d.setHours(0,0,0,0)
        const diff = Math.round((today - d) / 86400000)
        if (diff >= 0 && diff < days) {
          buckets[days - 1 - diff].total += 1
          if (r.rating_value === 1) buckets[days - 1 - diff].up += 1
        }
      })
    return buckets.map(b => b.total ? Math.round((b.up / b.total) * 100) : null)
  }, [runs, selectedApp])

  // 👎 runs for selected app
  const lowRuns = useMemo(() =>
    runs
      .filter(r => r.app_id === selectedApp && r.rating_value === -1)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50)
  , [runs, selectedApp])

  const appObj = apps.find(a => a.id === selectedApp)

  return (
    <div className="space-y-6">
      {/* ── Quality score overview table ── */}
      <div>
        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-3">Quality scores</p>
        <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-300 border-b border-white/5">
                <th className="px-4 py-3 font-medium">App</th>
                <th className="px-4 py-3 font-medium text-center">Score</th>
                <th className="px-4 py-3 font-medium text-right">Rated runs</th>
                <th className="px-4 py-3 font-medium text-right">👍 Useful</th>
                <th className="px-4 py-3 font-medium text-right">👎 Not useful</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {apps.map(app => {
                const s       = appStats[app.id] || {}
                const score   = qualityScore(app)
                const useful    = s.rated > 0 ? Math.round((s.thumbsUp / s.rated) * 100) : null
                const notUseful = s.rated > 0 ? Math.round(((s.rated - s.thumbsUp) / s.rated) * 100) : null
                return (
                  <tr key={app.id}
                    onClick={() => setSelectedApp(app.id)}
                    className={`cursor-pointer transition-colors ${selectedApp === app.id ? 'bg-[#6C5CE7]/5' : 'hover:bg-white/2'}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span>{app.emoji}</span>
                        <span className="text-white font-medium truncate max-w-[160px]">{app.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {score !== null ? (
                        <span className={`text-xs font-bold ${score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                          {score}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">{s.rated || 0}</td>
                    <td className="px-4 py-3 text-right">
                      {useful !== null ? <span className={useful >= 70 ? 'text-emerald-400' : useful >= 50 ? 'text-amber-400' : 'text-red-400'}>{useful}%</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {notUseful !== null && notUseful > 0
                        ? <span className="text-red-400">{notUseful}%</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!apps.length && <p className="text-center text-slate-500 text-sm py-6">No apps yet.</p>}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Click a row to drill into that app. Ratings come from 👍 👎 in the app runner.</p>
      </div>

      {/* ── Per-app drill-down ── */}
      {appObj && (
        <>
          <div className="flex items-center gap-2 border-t border-white/5 pt-5">
            <span className="text-xl">{appObj.emoji}</span>
            <p className="text-white font-semibold text-sm">{appObj.name}</p>
            <QualityScore score={qualityScore(appObj)} />
          </div>

          {/* Rating trend sparkline */}
          <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Satisfaction trend — last 21 days</p>
              <p className="text-[10px] text-slate-400">👍 % per day</p>
            </div>
            {ratingTrend.every(v => v === null) ? (
              <p className="text-slate-600 text-xs text-center py-4">No rated runs in this period.</p>
            ) : (
              <>
                <div className="flex items-end gap-0.5 h-16">
                  {ratingTrend.map((v, i) => {
                    if (v === null) return <div key={i} className="flex-1" />
                    const h = Math.max((v / 100) * 56, 4)
                    const color = v >= 70 ? '#00B894' : v >= 50 ? '#FDCB6E' : '#E84393'
                    return (
                      <div key={i} className="flex-1 rounded-t transition-all group relative"
                        style={{ height: h, background: color, opacity: 0.8 }}>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#0E1424] text-white text-[10px] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                          👍 {v}%
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-slate-600">
                  <span>21 days ago</span><span>Today</span>
                </div>
              </>
            )}
          </div>

          {/* Low-quality run browser */}
          <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">👎 Run browser</p>
              <span className="text-[10px] text-slate-500">{lowRuns.length} runs</span>
            </div>

            {lowRuns.length === 0 ? (
              <p className="text-slate-600 text-xs text-center py-6">No runs match this filter — great sign!</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {lowRuns.map(r => (
                  <div key={r.id}
                    onClick={() => setExpandRun(p => p === r.id ? null : r.id)}
                    className="bg-[#0E1424] border border-white/5 rounded-xl px-4 py-3 cursor-pointer hover:border-white/10 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-base shrink-0">👎</span>
                      <p className="text-slate-300 text-xs truncate flex-1">{r.input || r.app_name}</p>
                      <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(r.created_at)}</span>
                      <span className="text-[10px] text-slate-400">{expandRun === r.id ? '▲' : '▼'}</span>
                    </div>
                    {expandRun === r.id && (
                      <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                        {r.input && (
                          <div>
                            <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1">Input</p>
                            <p className="text-xs text-slate-300 leading-relaxed">{r.input}</p>
                          </div>
                        )}
                        {r.output && (
                          <div>
                            <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1">Output</p>
                            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{r.output}</p>
                          </div>
                        )}
                        {!r.input && !r.output && (
                          <p className="text-slate-600 text-xs">Input/output not stored for this run.</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Eval framework integrations ── */}
      <div>
        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-3">Evaluation framework integrations</p>
        <div className="space-y-3">
          <IntegrationCard
            icon="🧪"
            name="Promptfoo"
            desc="Open-source LLM eval CLI — run structured test suites against your prompts from CI."
            docsUrl="https://promptfoo.dev/docs"
            fields={[
              { key: 'api_key', label: 'API key (if using Promptfoo Cloud)', placeholder: 'pfoo-…', secret: true,
                hint: 'Optional — needed only for Promptfoo Cloud sharing. Self-hosted runs need no key.' },
            ]}
            savedKeys={integrations?.promptfoo}
            onSave={vals => saveIntegration('promptfoo', vals)}
          />
          <IntegrationCard
            icon="🔬"
            name="DeepEval"
            desc="LLM evaluation metrics library — correctness, faithfulness, hallucination detection."
            docsUrl="https://docs.confident-ai.com"
            fields={[
              { key: 'api_key', label: 'Confident AI API key', placeholder: 'deepeval-…', secret: true,
                hint: 'From confident-ai.com dashboard → API Keys' },
            ]}
            savedKeys={integrations?.deepeval}
            onSave={vals => saveIntegration('deepeval', vals)}
          />
          <IntegrationCard
            icon="📊"
            name="Ragas"
            desc="Retrieval-augmented generation evaluation — faithfulness, context precision, answer relevancy."
            docsUrl="https://docs.ragas.io"
            fields={[
              { key: 'app_token', label: 'Ragas app token', placeholder: 'rg-…', secret: true,
                hint: 'From app.ragas.io → Settings → API tokens. Required for dataset syncing.' },
            ]}
            savedKeys={integrations?.ragas}
            onSave={vals => saveIntegration('ragas', vals)}
          />
        </div>
        <p className="text-[10px] text-slate-400 mt-2">Keys are stored in your developer_settings (Supabase) and forwarded by the Aistrix backend when running evaluations.</p>
      </div>
    </div>
  )
}

// ─── Tab: Improve ─────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL || ''

function ImproveTab({ apps, user, runs, selectedAppId, onSelectApp }) {
  const [selectedApp, setSelectedApp] = useState(selectedAppId || null)
  useEffect(() => { if (selectedAppId) { setSelectedApp(selectedAppId); setVA(null); setVB(null); setOutputA(''); setOutputB('') } }, [selectedAppId])
  const [vA, setVA] = useState(null)   // version left
  const [vB, setVB] = useState(null)   // version right
  const [testInput, setTestInput] = useState('')
  const [outputA, setOutputA] = useState('')
  const [outputB, setOutputB] = useState('')
  const [runningA, setRunningA] = useState(false)
  const [runningB, setRunningB] = useState(false)
  // AI suggestions state
  const [suggestion, setSuggestion]   = useState('')
  const [suggesting, setSuggesting]   = useState(false)
  // GitHub feedback tracker state
  const [ghToken, setGhToken]         = useState('')
  const [ghRepo, setGhRepo]           = useState('')
  const [ghSaving, setGhSaving]       = useState(false)
  const [ghConnected, setGhConnected] = useState(false)
  const [creatingIssue, setCreatingIssue] = useState(null)   // run id
  // Integrations (for deep-links)
  const [integrations, setIntegrations] = useState(null)
  const toast = useToast()

  useEffect(() => { loadSettings() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSettings() {
    const { data } = await supabase.from('developer_settings').select('settings').eq('user_id', user.id).single()
    const s = data?.settings || {}
    setIntegrations(s)
    if (s.github?.token) { setGhToken(s.github.token); setGhRepo(s.github.repo || ''); setGhConnected(true) }
  }

  async function saveGitHub() {
    if (!ghToken.trim()) { toast('Enter a GitHub token', 'error', 2000); return }
    setGhSaving(true)
    const merged = { ...(integrations || {}), github: { token: ghToken.trim(), repo: ghRepo.trim() } }
    const { error } = await supabase.from('developer_settings')
      .upsert({ user_id: user.id, settings: merged }, { onConflict: 'user_id' })
    setGhSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setIntegrations(merged)
    setGhConnected(true)
    toast('GitHub connected', 'success', 2000)
  }

  const appObj = apps.find(a => a.id === selectedApp) || null
  const { versions, loading: vLoading, needsSetup } = useVersions(selectedApp, user?.id)

  // Worst-rated runs for selected app (for AI suggestions + GitHub tracker)
  const worstRuns = useMemo(() =>
    runs
      .filter(r => r.app_id === selectedApp && r.rating_value === -1)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
  , [runs, selectedApp])

  async function runAISuggestion() {
    if (!appObj) return
    setSuggesting(true)
    setSuggestion('')
    const examples = worstRuns.slice(0, 5)
      .map((r, i) => `Example ${i + 1}:\nApp: ${r.app_name}\nFeedback: 👎`)
      .join('\n\n')
    const systemPrompt = `You are an expert prompt engineer. Analyse the following low-rated AI app runs and suggest specific, actionable improvements to the system prompt to address the issues. Be concrete — rewrite problem sections rather than giving vague advice. Focus on tone, specificity, constraints, and output format.`
    const userMsg = `App: ${appObj.name}\nCurrent system prompt:\n${appObj.system_prompt || '(none)'}\n\nLow-rated runs:\n${examples || 'No rated runs yet — provide general improvement suggestions based on the prompt.'}`
    try {
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: userMsg,
          system_prompt: systemPrompt,
          ai_provider: appObj.ai_provider || 'anthropic',
          ai_model: appObj.ai_model || 'claude-haiku-4-5',
        }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()
        for (const part of parts) {
          if (!part.startsWith('data:')) continue
          try {
            const j = JSON.parse(part.slice(5))
            if (j.token) setSuggestion(p => p + j.token)
            if (j.error) toast(j.error, 'error')
          } catch { /* partial JSON */ }
        }
      }
    } catch (e) { toast(e.message, 'error') }
    finally { setSuggesting(false) }
  }

  async function createGitHubIssue(run) {
    if (!ghToken || !ghRepo) { toast('Connect GitHub first', 'error', 2000); return }
    setCreatingIssue(run.id)
    const [owner, repo] = ghRepo.split('/')
    const body = [
      `**App:** ${run.app_name}`,
      `**Feedback:** 👎`,
      `**Date:** ${new Date(run.created_at).toLocaleString()}`,
      run.input  ? `\n**Input:**\n\`\`\`\n${run.input}\n\`\`\`` : '',
      run.output ? `\n**Output:**\n\`\`\`\n${run.output}\n\`\`\`` : '',
      '\n---\n*Created from Aistrix Improve tab*',
    ].filter(Boolean).join('\n')
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `[${run.app_name}] 👎 run flagged`, body, labels: ['ai-quality'] }),
      })
      if (!res.ok) { const e = await res.json(); toast(e.message || 'GitHub API error', 'error'); return }
      const issue = await res.json()
      toast(`Issue #${issue.number} created`, 'success', 3000)
    } catch (e) { toast(e.message, 'error') }
    finally { setCreatingIssue(null) }
  }

  async function runVersion(v, app, setOutput, setRunning) {
    if (!testInput.trim()) { toast('Enter a test input first', 'error', 2000); return }
    setRunning(true)
    setOutput('')
    try {
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: testInput,
          system_prompt: v.system_prompt,
          ai_provider: v.ai_provider || app.ai_provider,
          ai_model: v.ai_model || app.ai_model,
        }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()
        for (const part of parts) {
          if (!part.startsWith('data:')) continue
          try {
            const j = JSON.parse(part.slice(5))
            if (j.token) setOutput(p => p + j.token)
            if (j.error) toast(j.error, 'error')
          } catch { /* partial JSON */ }
        }
      }
    } catch (e) { toast(e.message, 'error') }
    finally { setRunning(false) }
  }

  return (
    <div className="space-y-5">
      {selectedApp && (
        <>
          {needsSetup && <VersionSetupCard onRetry={() => {}} />}

          {!needsSetup && (
            <>
              {/* Version pickers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[['A (baseline)', vA, setVA], ['B (candidate)', vB, setVB]].map(([label, sel, setSel]) => (
                  <div key={label}>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-2">Version {label}</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {vLoading && <p className="text-slate-500 text-xs py-2 text-center">Loading…</p>}
                      {!vLoading && versions.length === 0 && (
                        <p className="text-slate-500 text-xs py-2 text-center">No snapshots — save one in the Version tab first.</p>
                      )}
                      {versions.map(v => (
                        <button key={v.id} onClick={() => setSel(v)}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-all ${sel?.id === v.id ? 'border-[#6C5CE7]/50 bg-[#6C5CE7]/10 text-white' : 'border-white/5 bg-[#0E1424] text-slate-400 hover:border-white/10 hover:text-white'}`}>
                          <span className="font-semibold">v{v.version_num}</span>
                          {v.label && <span className="ml-2 text-slate-500">{v.label}</span>}
                          <span className="ml-2 text-slate-600">{timeAgo(v.created_at)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Diff editor */}
              {(vA || vB) && (
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-2">Prompt diff</p>
                  <div className="rounded-xl overflow-hidden border border-white/5" style={{ height: 300 }}>
                    <Suspense fallback={<div className="h-full flex items-center justify-center text-slate-500 text-sm bg-[#0E1424]">Loading editor…</div>}>
                      <DiffEditor
                        original={vA?.system_prompt || ''}
                        modified={vB?.system_prompt || ''}
                        language="plaintext"
                        theme="vs-dark"
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          fontSize: 12,
                          lineNumbers: 'off',
                          renderOverviewRuler: false,
                          wordWrap: 'on',
                        }}
                      />
                    </Suspense>
                  </div>
                </div>
              )}

              {/* Side-by-side test */}
              {vA && vB && (
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-2">Side-by-side test</p>
                  <textarea
                    value={testInput}
                    onChange={e => setTestInput(e.target.value)}
                    placeholder="Enter a test input to run against both versions…"
                    rows={3}
                    className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none mb-3"
                  />
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {[[vA, outputA, setOutputA, runningA, setRunningA, 'Run v' + vA.version_num],
                      [vB, outputB, setOutputB, runningB, setRunningB, 'Run v' + vB.version_num]
                    ].map(([v, out, , running, setRunning, label]) => (
                      <div key={v.id} className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white">v{v.version_num} {v.label ? `· ${v.label}` : ''}</span>
                          <button
                            onClick={() => runVersion(v, appObj, v === vA ? setOutputA : setOutputB, setRunning)}
                            disabled={running}
                            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
                            {running ? '▌' : '▶ ' + label}
                          </button>
                        </div>
                        <div className="min-h-24 bg-[#09101F] rounded-lg p-3 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap font-mono overflow-y-auto max-h-56">
                          {out || <span className="text-slate-600">Output will appear here…</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Tool deep-links (when integrations connected) ── */}
      {(integrations?.langfuse?.langfuse_public_key || integrations?.promptfoo?.api_key) && (
        <div>
          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-2">Open in connected tools</p>
          <div className="flex flex-wrap gap-2">
            {integrations?.langfuse?.langfuse_public_key && (
              <a href="https://cloud.langfuse.com" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border border-white/5 bg-[#0E1424] text-slate-300 hover:text-white hover:border-white/10 transition-all">
                🔭 Langfuse prompt playground ↗
              </a>
            )}
            {integrations?.promptfoo?.api_key && (
              <a href="https://app.promptfoo.dev" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border border-white/5 bg-[#0E1424] text-slate-300 hover:text-white hover:border-white/10 transition-all">
                🧪 Promptfoo comparison reports ↗
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── AI improvement suggestions ── */}
      {selectedApp && appObj && (
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-semibold">🤖 AI improvement suggestions</p>
              <p className="text-slate-500 text-xs mt-0.5">
                Analyses {worstRuns.length} low-rated run{worstRuns.length !== 1 ? 's' : ''} and suggests prompt rewrites.
              </p>
            </div>
            <button onClick={runAISuggestion} disabled={suggesting}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40 shrink-0">
              {suggesting ? '▌ Thinking…' : '✨ Suggest improvements'}
            </button>
          </div>
          {(suggestion || suggesting) && (
            <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4">
              <p className="text-[9px] text-slate-600 uppercase font-semibold mb-2">Suggestions</p>
              <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto">
                {suggestion || <span className="text-slate-600 animate-pulse">Generating…</span>}
              </div>
            </div>
          )}
          {!suggestion && !suggesting && (
            <p className="text-slate-600 text-xs">Click "Suggest improvements" to generate AI-powered rewrite suggestions based on your low-rated runs.</p>
          )}
        </div>
      )}

      {/* ── GitHub feedback tracker ── */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-2xl">🐙</span>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium">GitHub feedback tracker</p>
            <p className="text-[11px] text-slate-300">Create GitHub issues from low-rated runs for developer follow-up.</p>
          </div>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${ghConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-slate-500'}`}>
            {ghConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        {/* OAuth connection */}
        {!ghConnected && (
          <div className="border-t border-white/5 px-4 py-4 space-y-3">
            <div className="flex items-start gap-3 bg-[#0E1424] rounded-xl p-4">
              <span className="text-xl shrink-0 mt-0.5">🔐</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium">Connect via GitHub OAuth</p>
                <p className="text-slate-300 text-xs mt-1 leading-relaxed">
                  Authorise Aistrix with GitHub — no personal access tokens needed.
                  Your token is stored server-side only.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div>
                <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide block mb-1">Repository <span className="text-slate-600 font-normal normal-case">(owner/repo)</span></label>
                <input type="text" value={ghRepo} onChange={e => setGhRepo(e.target.value)}
                  placeholder="acme/my-ai-apps"
                  className="bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 w-56" />
              </div>
              <button
                onClick={async () => {
                  const { data: { session } } = await supabase.auth.getSession()
                  const API_URL = import.meta.env.VITE_API_URL || ''
                  window.location.href = `${API_URL}/auth/github?token=${session?.access_token}`
                }}
                className="mt-5 flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg bg-[#24292e] hover:bg-[#2f363d] text-white border border-white/10 transition-colors">
                <span>🐙</span> Connect GitHub
              </button>
            </div>
          </div>
        )}

        {/* Low-rated runs list for issue creation */}
        {ghConnected && selectedApp && (
          <div className="border-t border-white/5 px-4 py-4">
            {worstRuns.length === 0 ? (
              <p className="text-slate-600 text-xs text-center py-4">No low-rated runs for this app — nothing to report.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-2">
                  {worstRuns.length} low-rated run{worstRuns.length !== 1 ? 's' : ''} · click to create GitHub issue
                </p>
                {worstRuns.map(r => (
                  <div key={r.id} className="flex items-center gap-3 bg-[#0E1424] border border-white/5 rounded-xl px-4 py-2.5">
                    <span className="text-base shrink-0">👎</span>
                    <p className="text-slate-300 text-xs truncate flex-1">{r.app_name} · {timeAgo(r.created_at)}</p>
                    <button
                      onClick={() => createGitHubIssue(r)}
                      disabled={creatingIssue === r.id}
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors disabled:opacity-40 shrink-0">
                      {creatingIssue === r.id ? '…' : '+ Issue'}
                    </button>
                  </div>
                ))}
                <button onClick={() => { setGhConnected(false) }}
                  className="text-[10px] text-slate-400 hover:text-slate-400 transition-colors mt-1">
                  Edit connection
                </button>
              </div>
            )}
          </div>
        )}

        {ghConnected && !selectedApp && (
          <div className="border-t border-white/5 px-4 py-4">
            <p className="text-slate-600 text-xs text-center">Select an app above to see low-rated runs.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComingSoonCard
          icon="🔄"
          title="A/B Testing"
          desc="Split live traffic between two prompt or model variants and let real usage decide the winner."
          bullets={[
            'Configure traffic split (50/50, 80/20, etc.)',
            'Auto-promote when statistical significance reached',
            'Per-variant cost and quality metrics',
            'Works across model providers',
          ]}
        />
        <ComingSoonCard
          icon="💡"
          title="Model Swap Advisor"
          desc="Running on GPT-4o for every run? Aistrix detects tasks where a cheaper model would match quality."
          bullets={[
            'Benchmark cheaper model against your test suite',
            'Projected cost saving shown before you swap',
            'One-click model switch with rollback',
            'Supports cross-provider comparison',
          ]}
        />
      </div>
    </div>
  )
}

// ─── Tab: Version ─────────────────────────────────────────────────────────────

function VersionTab({ apps, user, onAppUpdated, selectedAppId, onSelectApp }) {
  const [selectedApp, setSelectedApp] = useState(selectedAppId || apps[0]?.id || null)
  const [integrations, setIntegrations] = useState(null)
  const appObj = apps.find(a => a.id === selectedApp) || null
  const toast  = useToast()

  useEffect(() => { if (selectedAppId) setSelectedApp(selectedAppId) }, [selectedAppId])
  useEffect(() => { loadIntegrations() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadIntegrations() {
    const { data } = await supabase.from('developer_settings').select('settings').eq('user_id', user.id).single()
    setIntegrations(data?.settings || {})
  }

  async function saveIntegration(key, vals) {
    const merged = { ...(integrations || {}), [key]: vals }
    const { error } = await supabase.from('developer_settings')
      .upsert({ user_id: user.id, settings: merged }, { onConflict: 'user_id' })
    if (error) { toast(error.message, 'error'); return }
    setIntegrations(merged)
  }

  return (
    <div className="space-y-5">
      {/* App selector */}

      {appObj && (
        <VersionManager
          app={appObj}
          user={user}
          onRollback={updated => onAppUpdated?.(updated)}
        />
      )}

      {/* Feature flag integrations */}
      <div>
        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-3">Feature flag integrations</p>
        <p className="text-xs text-slate-600 mb-3">Connect a feature flag service to gate new prompt versions to a percentage of users before full rollout.</p>
        <div className="space-y-3">
          <IntegrationCard
            icon="🚩"
            name="Unleash"
            desc="Open-source feature flag platform — self-host or use Unleash Cloud."
            docsUrl="https://docs.getunleash.io"
            fields={[
              { key: 'api_url',  label: 'API URL',   placeholder: 'https://app.unleash-hosted.com/api', secret: false,
                hint: 'Your Unleash instance URL — ends in /api' },
              { key: 'api_token', label: 'API token', placeholder: '*:production.abc123…', secret: true },
            ]}
            savedKeys={integrations?.unleash}
            onSave={vals => saveIntegration('unleash', vals)}
          />
          <IntegrationCard
            icon="🎌"
            name="Flagsmith"
            desc="Feature flags and remote config — cloud or self-hosted."
            docsUrl="https://docs.flagsmith.com"
            fields={[
              { key: 'environment_key', label: 'Environment key', placeholder: 'ser.abc123…', secret: true,
                hint: 'Flagsmith dashboard → Environment → SDK Keys → Server-side' },
            ]}
            savedKeys={integrations?.flagsmith}
            onSave={vals => saveIntegration('flagsmith', vals)}
          />
          <IntegrationCard
            icon="🦔"
            name="PostHog feature flags"
            desc="Use PostHog feature flags alongside product analytics — same SDK."
            docsUrl="https://posthog.com/docs/feature-flags"
            fields={[
              { key: 'personal_api_key', label: 'Personal API key', placeholder: 'phx_abc123…', secret: true,
                hint: 'PostHog → Settings → Personal API keys' },
              { key: 'project_id', label: 'Project ID', placeholder: '12345', secret: false },
            ]}
            savedKeys={integrations?.posthog_flags}
            onSave={vals => saveIntegration('posthog_flags', vals)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComingSoonCard
          icon="📦"
          title="Staged Rollouts"
          desc="Deploy a new version to 10% of users first, watch quality metrics, then roll out to everyone."
          bullets={[
            'Canary releases by user percentage',
            'Automatic rollback if quality drops',
            'Enterprise clients can be pinned to a version',
            'Changelog visible to users on the app page',
          ]}
        />
        <ComingSoonCard
          icon="🔒"
          title="Enterprise Version Locking"
          desc="Lock a specific client or team to a version they approved so a new deployment never breaks their workflow."
          bullets={[
            'Per-organisation version pins',
            'Audit log of who approved which version',
            'Upgrade request flow (client approves)',
            'LTS (long-term support) version flag',
          ]}
        />
      </div>
    </div>
  )
}

// ─── Monetize helpers ─────────────────────────────────────────────────────────

const ENTITLEMENTS_SETUP_SQL = `create table app_entitlements (
  id            uuid primary key default gen_random_uuid(),
  app_id        uuid references apps(id) on delete cascade,
  user_id       uuid references auth.users(id),
  plan          text not null default 'pay_per_run',
  status        text not null default 'active',
  stripe_customer_id  text,
  stripe_sub_id       text,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  runs_this_period     int not null default 0,
  run_quota            int,
  created_at    timestamptz default now()
);
alter table app_entitlements enable row level security;
create policy "owner" on app_entitlements
  using (
    app_id in (select id from apps where created_by = auth.uid())
    or user_id = auth.uid()
  );`

const ENTITLEMENT_STATUS = {
  active:   'bg-emerald-500/10 text-emerald-400',
  trialing: 'bg-blue-500/10 text-blue-400',
  past_due: 'bg-amber-500/10 text-amber-400',
  canceled: 'bg-white/5 text-slate-500',
}

function StripeCard({ user }) {
  const [integrations, setIntegrations] = useState(null)
  const toast = useToast()

  useEffect(() => {
    supabase.from('developer_settings').select('settings').eq('user_id', user.id).single()
      .then(({ data }) => setIntegrations(data?.settings || {}))
  }, [user.id])

  async function save(vals) {
    const merged = { ...(integrations || {}), stripe: vals }
    const { error } = await supabase.from('developer_settings')
      .upsert({ user_id: user.id, settings: merged }, { onConflict: 'user_id' })
    if (error) { toast(error.message, 'error'); return }
    setIntegrations(merged)
    toast('Stripe keys saved', 'success', 2000)
  }

  const stripe = integrations?.stripe || {}
  const connected = !!(stripe.publishable_key && stripe.restricted_key)

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <span className="text-3xl shrink-0">💳</span>
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-white text-sm font-semibold">Stripe Checkout + Connect</p>
              <p className="text-slate-300 text-xs mt-0.5 leading-relaxed">
                Aistrix uses Stripe Checkout for user payments and Stripe Connect for developer payouts.
                Store your keys here — the Aistrix backend uses them to create checkout sessions and process webhooks.
              </p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-slate-500'}`}>
              {connected ? 'Keys saved' : 'Not configured'}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide block mb-1">Publishable key</label>
              <input
                type="text"
                defaultValue={stripe.publishable_key || ''}
                id="stripe-pk"
                placeholder="pk_live_… or pk_test_…"
                className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide block mb-1">Restricted key <span className="text-slate-600 font-normal normal-case">(charges + webhooks scope)</span></label>
              <input
                type="password"
                defaultValue={stripe.restricted_key || ''}
                id="stripe-rk"
                placeholder="rk_live_… or rk_test_…"
                className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono"
              />
              <p className="text-[10px] text-slate-400 mt-1">Stripe dashboard → Developers → API keys → Restricted keys. Grant: write on charges, read on customers.</p>
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-[#A29BFE] hover:text-white transition-colors">Stripe API keys ↗</a>
              <span className="text-slate-700">·</span>
              <a href="https://dashboard.stripe.com/connect/accounts/overview" target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-[#A29BFE] hover:text-white transition-colors">Stripe Connect ↗</a>
              <span className="text-slate-700">·</span>
              <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-[#A29BFE] hover:text-white transition-colors">Webhooks ↗</a>
            </div>
            <button
              onClick={() => {
                const pk = document.getElementById('stripe-pk')?.value || ''
                const rk = document.getElementById('stripe-rk')?.value || ''
                save({ publishable_key: pk.trim(), restricted_key: rk.trim() })
              }}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
              Save keys
            </button>
          </div>

          <div className="border-t border-white/5 pt-3 grid grid-cols-1 lg:grid-cols-3 gap-2">
            {[
              { icon: '1️⃣', label: 'Save keys above', done: connected },
              { icon: '2️⃣', label: 'Aistrix team enables Checkout + Connect', done: false },
              { icon: '3️⃣', label: 'Business users pay — entitlements created automatically', done: false },
            ].map(({ icon, label, done }) => (
              <div key={label} className={`flex items-center gap-2 text-xs ${done ? 'text-emerald-400' : 'text-slate-500'}`}>
                <span>{done ? '✓' : icon}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function EntitlementsSection({ apps, user }) {
  const [entitlements, setEntitlements] = useState(null)
  const [needsSetup, setNeedsSetup]     = useState(false)
  const [copied, setCopied]             = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const appIds = apps.map(a => a.id)
    if (!appIds.length) { setEntitlements([]); return }
    const { data, error } = await supabase
      .from('app_entitlements')
      .select('*')
      .in('app_id', appIds)
      .order('created_at', { ascending: false })
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) { setNeedsSetup(true); return }
      toast(error.message, 'error'); return
    }
    setEntitlements(data || [])
  }

  function copy() {
    navigator.clipboard.writeText(ENTITLEMENTS_SETUP_SQL)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  if (needsSetup) return (
    <div className="bg-[#171B33] border border-[#6C5CE7]/20 rounded-2xl p-6 space-y-3 text-center">
      <div className="text-3xl">💳</div>
      <div>
        <p className="text-white font-semibold text-sm">Entitlements managed automatically</p>
        <p className="text-slate-400 text-sm mt-1">
          Versioning and entitlements are handled by Aistrix during deployment.<br />
          No manual setup required.
        </p>
      </div>
      <button onClick={load} className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
        ↺ Check again
      </button>
    </div>
  )

  if (entitlements === null) return <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>

  const appMap = Object.fromEntries(apps.map(a => [a.id, a]))

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-white">User entitlements</p>
          <p className="text-[11px] text-slate-300 mt-0.5">
            {entitlements.length} entitlement{entitlements.length !== 1 ? 's' : ''} · populated by Stripe webhooks once billing is live
          </p>
        </div>
        <button onClick={load} className="text-[10px] text-slate-500 hover:text-white bg-white/5 px-2 py-1 rounded-md transition-colors">↺ Refresh</button>
      </div>

      {entitlements.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-slate-500 text-sm">No entitlements yet.</p>
          <p className="text-slate-600 text-xs mt-1">Rows are created automatically when a user pays via Stripe Checkout.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-300 border-b border-white/5">
                <th className="px-4 py-3 font-medium">App</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium text-right">Runs / quota</th>
                <th className="px-4 py-3 font-medium">Period end</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {entitlements.map(e => {
                const app = appMap[e.app_id]
                const pct = e.run_quota ? Math.round((e.runs_this_period / e.run_quota) * 100) : null
                return (
                  <tr key={e.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span>{app?.emoji}</span>
                        <span className="text-white font-medium truncate max-w-[120px]">{app?.name || e.app_id.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">{e.user_id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-slate-300 capitalize">{e.plan.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-white">{e.runs_this_period}</span>
                      {e.run_quota && <span className="text-slate-500"> / {e.run_quota}</span>}
                      {pct !== null && (
                        <div className="mt-1 bg-white/5 rounded-full h-1 w-16 ml-auto">
                          <div className={`h-1 rounded-full ${pct >= 90 ? 'bg-red-400' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {e.current_period_end ? new Date(e.current_period_end).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ENTITLEMENT_STATUS[e.status] || 'bg-white/5 text-slate-500'}`}>
                        {e.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Revenue (Cost & Profit Meter + Connect Payout) ─────────────────────

function ConnectPayoutPanel({ user }) {
  const [status, setStatus] = useState(null)  // null | object
  const [loading, setLoading] = useState(true)
  const [onboarding, setOnboarding] = useState(false)
  const [earnings, setEarnings] = useState(null)
  const API_URL = import.meta.env.VITE_API_URL || ''

  useEffect(() => { load() }, []) // eslint-disable-line

  async function load() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = { Authorization: `Bearer ${session?.access_token}` }
      const [sRes, eRes] = await Promise.all([
        fetch(`${API_URL}/stripe/connect/status`, { headers }),
        fetch(`${API_URL}/stripe/earnings`, { headers }),
      ])
      if (sRes.ok) setStatus(await sRes.json())
      if (eRes.ok) setEarnings(await eRes.json())
    } catch (_) {}
    setLoading(false)
  }

  async function startOnboarding() {
    setOnboarding(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${API_URL}/stripe/connect/onboard`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (r.ok) {
        const { url } = await r.json()
        window.location.href = url
      }
    } catch (_) {}
    setOnboarding(false)
  }

  if (loading) return null

  const connected = status?.charges_enabled
  const detailsSubmitted = status?.details_submitted

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
        <span className="text-xl">💳</span>
        <div className="flex-1">
          <p className="text-white text-sm font-semibold">Stripe Connect — Payout account</p>
          <p className="text-[11px] text-slate-300 mt-0.5">Receive your share of revenue directly to your bank account.</p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
          connected ? 'bg-emerald-500/10 text-emerald-400'
          : detailsSubmitted ? 'bg-amber-500/10 text-amber-400'
          : 'bg-white/5 text-slate-500'
        }`}>
          {connected ? 'Active' : detailsSubmitted ? 'Pending review' : 'Not connected'}
        </span>
      </div>

      {earnings && connected && (
        <div className="grid grid-cols-3 divide-x divide-white/5 border-b border-white/5">
          {[
            { label: 'Total earned', value: `$${earnings.total_dev_share.toFixed(2)}` },
            { label: 'Pending payout', value: `$${earnings.total_pending.toFixed(2)}` },
            { label: 'Platform fee', value: `${earnings.platform_fee_pct}%` },
          ].map(({ label, value }) => (
            <div key={label} className="px-5 py-3 text-center">
              <p className="text-white font-bold text-lg">{value}</p>
              <p className="text-slate-500 text-[10px] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="px-5 py-4 flex items-center justify-between gap-3">
        {!connected ? (
          <>
            <p className="text-slate-300 text-xs leading-relaxed">
              {detailsSubmitted
                ? 'Your Connect account is under review by Stripe. You\'ll receive an email when it\'s approved.'
                : 'Connect a Stripe account to receive payouts. Aistrix keeps ' + (earnings?.platform_fee_pct ?? 20) + '% as a platform fee.'}
            </p>
            {!detailsSubmitted && (
              <button onClick={startOnboarding} disabled={onboarding}
                className="shrink-0 text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
                {onboarding ? 'Redirecting…' : 'Set up payouts →'}
              </button>
            )}
          </>
        ) : (
          <p className="text-slate-300 text-xs">
            Payouts are active. Transfers are sent automatically after each sale.
          </p>
        )}
      </div>
    </div>
  )
}

function MonetizeTab({ apps, runs, loading, user }) {
  const profitData = useMemo(() => {
    if (!apps.length) return []
    return apps.map(app => {
      const appRuns = runs.filter(r => r.app_id === app.id)
      const withTokens = appRuns.filter(r => r.input_tokens != null || r.output_tokens != null)
      const totalIn  = withTokens.reduce((s, r) => s + (r.input_tokens  || 0), 0)
      const totalOut = withTokens.reduce((s, r) => s + (r.output_tokens || 0), 0)
      const avgIn  = withTokens.length ? totalIn  / withTokens.length : null
      const avgOut = withTokens.length ? totalOut / withTokens.length : null

      const costs = modelCost(app.ai_model)
      const costPerRun = costs && avgIn != null
        ? (avgIn  / 1_000_000) * costs.input + (avgOut / 1_000_000) * costs.output
        : null

      const pricePerRun = app.is_paid && app.price_per_run ? Number(app.price_per_run) : 0
      const margin      = costPerRun != null ? pricePerRun - costPerRun : null
      const marginPct   = margin != null && pricePerRun > 0 ? Math.round((margin / pricePerRun) * 100) : null
      const totalCost   = costPerRun != null ? costPerRun * appRuns.length : null
      const totalRev    = pricePerRun * appRuns.length

      return { app, appRuns: appRuns.length, withTokens: withTokens.length, avgIn, avgOut, costPerRun, pricePerRun, margin, marginPct, totalCost, totalRev }
    }).sort((a, b) => b.appRuns - a.appRuns)
  }, [apps, runs])

  const totals = useMemo(() => ({
    revenue: profitData.reduce((s, d) => s + d.totalRev, 0),
    cost:    profitData.reduce((s, d) => s + (d.totalCost ?? 0), 0),
  }), [profitData])

  if (loading) return <p className="text-slate-500 text-sm py-10 text-center">Loading…</p>

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Publish a paid app to start seeing profit data.</p>
    </div>
  )

  const margin = totals.revenue - totals.cost
  const marginPct = totals.revenue > 0 ? Math.round((margin / totals.revenue) * 100) : null

  return (
    <div className="space-y-5">
      {/* Stripe Connect payout panel */}
      <ConnectPayoutPanel user={user} />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Est. revenue" value={totals.revenue > 0 ? `$${totals.revenue.toFixed(2)}` : '—'} color="#00B894" sub="price × runs" />
        <StatTile label="Est. AI cost"  value={totals.cost   > 0 ? `$${totals.cost.toFixed(4)}`   : '—'} color="#E17055" sub="tokens × model rate" />
        <StatTile label="Est. margin"  value={margin > 0 ? `$${margin.toFixed(2)}` : margin < 0 ? `-$${Math.abs(margin).toFixed(2)}` : '—'} color={margin >= 0 ? '#00B894' : '#E17055'} />
        <StatTile label="Margin %"     value={marginPct !== null ? `${marginPct}%` : '—'} color={marginPct != null && marginPct >= 60 ? '#00B894' : '#FDCB6E'} />
      </div>

      {/* Per-app table */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <p className="text-sm font-medium text-white">Per-app cost &amp; profit</p>
          <p className="text-[11px] text-slate-300 mt-0.5">Costs estimated from token usage × model rate. Revenue from price_per_run × run count.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-300 border-b border-white/5">
                <th className="px-4 py-3 font-medium">App</th>
                <th className="px-4 py-3 font-medium text-right">Runs</th>
                <th className="px-4 py-3 font-medium text-right">Avg tokens</th>
                <th className="px-4 py-3 font-medium text-right">Cost / run</th>
                <th className="px-4 py-3 font-medium text-right">Price / run</th>
                <th className="px-4 py-3 font-medium text-right">Margin</th>
                <th className="px-4 py-3 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {profitData.map(({ app, appRuns, withTokens, avgIn, avgOut, costPerRun, pricePerRun, margin, marginPct }) => {
                const hasCost = costPerRun != null
                const isProfit  = hasCost && margin > 0
                const isLoss    = hasCost && margin < 0
                const isFree    = !pricePerRun
                return (
                  <tr key={app.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span>{app.emoji}</span>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate max-w-[140px]">{app.name}</p>
                          <p className="text-[10px] text-slate-400">{app.ai_model?.split('-').slice(0, 3).join('-') || app.ai_provider || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">{appRuns}</td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {avgIn != null
                        ? <span className="text-[10px]">{Math.round(avgIn).toLocaleString()}↑ {Math.round(avgOut || 0).toLocaleString()}↓</span>
                        : <span className="text-slate-600">no data</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {hasCost
                        ? <span className="text-red-300">${costPerRun.toFixed(4)}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {pricePerRun > 0 ? <span className="text-green-400">${pricePerRun.toFixed(2)}</span> : <span className="text-slate-500">Free</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {hasCost && !isFree
                        ? <span className={isProfit ? 'text-green-400' : 'text-red-400'}>{isProfit ? '+' : ''}{margin.toFixed(3)}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isFree
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-500">Free</span>
                        : !hasCost
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-500">No token data</span>
                        : isProfit
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                            {marginPct != null ? `${marginPct}% margin` : '✓ Profitable'}
                          </span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">Under-priced</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        Token costs are estimates based on published model pricing. Actual costs may vary. Revenue figures assume every run was charged.
        {profitData.some(d => d.withTokens === 0 && d.appRuns > 0) && ' Some apps have no token data — token tracking is active for new runs.'}
      </p>

      {/* ── Stripe connection ── */}
      <div>
        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-3">Stripe billing</p>
        <div className="space-y-3">
          <StripeCard user={user} />
        </div>
      </div>

      {/* ── Entitlements viewer ── */}
      <div>
        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide mb-3">User entitlements</p>
        <EntitlementsSection apps={apps} user={user} />
      </div>

      {/* ── Coming soon ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComingSoonCard
          icon="💰"
          title="Revenue Dashboard"
          desc="Real revenue from paid runs, subscription billing, and payout history — once Stripe Checkout is live."
          bullets={[
            'Actual charged revenue vs estimated',
            'Failed payment rate and retry logic',
            'Monthly recurring revenue (MRR)',
            'Stripe Connect payout requests',
          ]}
        />
        <ComingSoonCard
          icon="📐"
          title="Suggested Pricing"
          desc="Aistrix recommends a price based on cost, comparable apps in the marketplace, and your quality score."
          bullets={[
            'Cost-plus pricing floor',
            'Market comparison across category',
            'Quality premium for top-rated apps',
            'One-click apply suggested price',
          ]}
        />
      </div>
    </div>
  )
}

// ─── API Key Section (reused in Deploy tab) ───────────────────────────────────

function ApiKeySection({ user }) {
  return (
    <div>
      <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-3">API keys</p>
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
        <div className="flex items-start gap-2 bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2.5">
          <span className="text-slate-400 shrink-0 mt-0.5">🔒</span>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Keys are generated by the Aistrix backend and stored only as a hash — the full key is shown once.
            Restrict a key to specific apps to limit the damage if it leaks.
          </p>
        </div>
        <ApiKeysManager user={user} />
      </div>
    </div>
  )
}

// ─── Secrets Tab ─────────────────────────────────────────────────────────────

function SecretsTab({ apps, user, selectedAppId, onSelectApp }) {
  const [selectedApp, setSelectedApp] = useState(selectedAppId || apps[0]?.id || null)
  useEffect(() => { if (selectedAppId) setSelectedApp(selectedAppId) }, [selectedAppId])
  const [secrets, setSecrets]         = useState([])
  const [loading, setLoading]         = useState(false)
  const [newKey, setNewKey]           = useState('')
  const [newVal, setNewVal]           = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState(null)
  const [toast, setToast]             = useState(null)

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

  useEffect(() => { if (selectedApp) loadSecrets(selectedApp) }, [selectedApp]) // eslint-disable-line react-hooks/exhaustive-deps

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token
  }

  async function loadSecrets(appId) {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const r = await fetch(`${API_URL}/apps/${appId}/secrets`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.detail || 'Failed to load secrets')
      setSecrets(body.secrets || [])
      if (body.warning) setError('⚠️ ' + body.warning)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function addSecret() {
    if (!newKey.trim() || !newVal.trim()) return
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const r = await fetch(`${API_URL}/apps/${selectedApp}/secrets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: newKey.trim(), value: newVal.trim() }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.detail || 'Failed to save')
      setNewKey(''); setNewVal('')
      showToast(`${body.key} saved`)
      await loadSecrets(selectedApp)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function deleteSecret(key) {
    const token = await getToken()
    await fetch(`${API_URL}/apps/${selectedApp}/secrets/${key}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    showToast(`${key} deleted`)
    await loadSecrets(selectedApp)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const app = apps.find(a => a.id === selectedApp)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">Secrets & Environment Variables</h2>
          <p className="text-slate-400 text-sm mt-0.5">Encrypted, server-only — never exposed to the browser or users.</p>
        </div>
        {toast && (
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            ✓ {toast}
          </span>
        )}
      </div>


      {!selectedApp ? (
        <p className="text-slate-500 text-sm">Create an app first.</p>
      ) : (
        <div className="space-y-4">
          {/* Security notice */}
          <div className="bg-[#6C5CE7]/5 border border-[#6C5CE7]/15 rounded-xl px-4 py-3 flex gap-3">
            <span className="text-lg shrink-0">🔐</span>
            <div className="text-xs text-slate-400 space-y-0.5">
              <p className="text-slate-300 font-semibold">Secrets are encrypted at rest and only used server-side by your app's tools.</p>
              <p>Values are never returned via API, never shown after saving, and never sent to the AI model. Use them in an HTTP Request tool's URL or headers as <code className="bg-black/20 px-1 rounded text-[#A29BFE]">{'{{secrets.YOUR_KEY}}'}</code>.</p>
            </div>
          </div>

          {/* Existing secrets */}
          {loading ? (
            <p className="text-slate-500 text-sm py-4">Loading…</p>
          ) : secrets.length === 0 ? (
            <div className="bg-[#0E1424] border border-white/5 rounded-xl px-5 py-8 text-center">
              <p className="text-slate-500 text-sm">No secrets yet for <span className="text-white">{app?.name}</span>.</p>
            </div>
          ) : (
            <div className="bg-[#0E1424] border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-4 py-2.5 text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Key</th>
                    <th className="text-left px-4 py-2.5 text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Value</th>
                    <th className="px-4 py-2.5 text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Updated</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {secrets.map(s => (
                    <tr key={s.key} className="border-b border-white/3 last:border-0 hover:bg-white/2 transition-colors">
                      <td className="px-4 py-3 font-mono text-[#A29BFE] text-xs">{s.key}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs tracking-widest">••••••••</td>
                      <td className="px-4 py-3 text-slate-600 text-[10px] text-center">{new Date(s.updated_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteSecret(s.key)}
                          className="text-slate-600 hover:text-red-400 transition-colors text-xs">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400">{error}</div>
          )}

          {/* Add new secret */}
          <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-300">Add / update secret</p>
            <div className="flex gap-2 flex-wrap sm:flex-nowrap">
              <input
                value={newKey}
                onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                placeholder="KEY_NAME"
                className="flex-1 min-w-0 bg-[#171B33] border border-white/10 rounded-lg px-3 py-2 text-xs text-[#A29BFE] font-mono placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40"
              />
              <input
                value={newVal}
                onChange={e => setNewVal(e.target.value)}
                placeholder="secret value"
                type="password"
                className="flex-1 min-w-0 bg-[#171B33] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40"
              />
              <button
                onClick={addSecret}
                disabled={saving || !newKey.trim() || !newVal.trim()}
                className="shrink-0 text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400">Keys auto-uppercased. Saving again with the same key overwrites the value.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const LIFECYCLE_TABS = [
  { id: 'design',   label: 'Design',      icon: '✏️',  desc: 'Blueprint', group: 'build' },
  { id: 'test',     label: 'Test',        icon: '🧪',  desc: 'Validate',  group: 'build' },
  { id: 'deploy',   label: 'Deploy',      icon: '🚀',  desc: 'Publish',   group: 'build' },
  { id: 'sell',     label: 'Marketplace', icon: '🛒',  desc: 'List',      group: 'grow' },
  { id: 'monitor',  label: 'Monitor',     icon: '📡',  desc: 'Usage',     group: 'grow' },
  { id: 'evaluate', label: 'Evaluate',    icon: '🎯',  desc: 'Quality',   group: 'grow' },
  { id: 'improve',  label: 'Improve',     icon: '🔬',  desc: 'Iterate',   group: 'grow' },
  { id: 'version',  label: 'Version',     icon: '📦',  desc: 'History',   group: 'manage' },
  { id: 'monetize', label: 'Revenue',     icon: '💰',  desc: 'Profit',    group: 'manage' },
  { id: 'secrets',  label: 'Secrets',     icon: '🔐',  desc: 'Env vars',  group: 'manage' },
]

const LIFECYCLE_GROUPS = [
  { id: 'build',  label: 'Build' },
  { id: 'grow',   label: 'Operate & Grow' },
  { id: 'manage', label: 'Manage' },
]

export default function DevStudioPage({ user, onOpenCreate, createdApp, onCreatedAppConsumed }) {
  const [tab, setTab] = useState('design')
  const [activeAppId, setActiveAppId] = useState(null)
  const [deployFixReason, setDeployFixReason] = useState('')
  const [apps, setApps] = useState([])
  const [runs, setRuns] = useState([])
  const [appStats, setAppStats] = useState({})
  const [totalStats, setTotalStats] = useState({ runs: 0, users: 0, satisfaction: null })
  const [entitlements, setEntitlements] = useState([])
  const [loading, setLoading] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [phaseByAppId, setPhaseByAppId] = useState({})  // explicit phase overrides per app

  useEffect(() => {
    if (!createdApp) return
    setApps(prev => prev.some(a => a.id === createdApp.id) ? prev : [createdApp, ...prev])
    setActiveAppId(createdApp.id)
    setTab('design')
    onCreatedAppConsumed?.()
  }, [createdApp]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
    // Handle OAuth / Connect return redirects
    const params = new URLSearchParams(window.location.search)
    if (params.get('github_connected') === '1') {
      const login = params.get('login') || 'GitHub'
      // toast shown by next render; clean up URL
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('stripe_connect') === 'success') {
      window.history.replaceState({}, '', window.location.pathname)
      setTab('monetize')
    }
  }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const { data: myApps } = await scopeToWorkspace(supabase.from('apps').select('*'), user, 'created_by')
      .order('total_runs', { ascending: false })
    if (!myApps?.length) { setLoading(false); return }
    setApps(myApps)
    setActiveAppId(prev => myApps.some(a => a.id === prev) ? prev : null)

    // Load blueprint dev phases. This is separate from apps.status, which is used by moderation/marketplace review.
    const { data: bpRows } = await supabase.from('app_blueprints')
      .select('app_id, blueprint').in('app_id', myApps.map(a => a.id))
    if (bpRows?.length) {
      const phases = {}
      for (const row of bpRows) {
        const phase = normalizeDevPhase(row.blueprint?.dev_phase)
        if (phase) phases[row.app_id] = phase
      }
      setPhaseByAppId(phases)
    }

    const [{ data: runData }, { data: entData }] = await Promise.all([
      supabase.from('run_history')
        .select('id, app_id, app_name, created_at, rating_value, user_id, input_tokens, output_tokens, input, output')
        .in('app_id', myApps.map(a => a.id)),
      supabase.from('app_entitlements')
        .select('id, app_id, user_id, plan, status, runs_this_period, run_quota, current_period_end, created_at')
        .in('app_id', myApps.map(a => a.id)),
    ])
    const allRuns = runData || []
    setRuns(allRuns)
    setEntitlements(entData || [])

    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const statsMap = {}
    myApps.forEach(app => {
      const appRuns = allRuns.filter(r => r.app_id === app.id)
      const recent  = appRuns.filter(r => new Date(r.created_at) >= sevenDaysAgo)
      const daily   = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0,0,0,0)
        const next = new Date(d); next.setDate(next.getDate() + 1)
        return recent.filter(r => new Date(r.created_at) >= d && new Date(r.created_at) < next).length
      })
      const rated = appRuns.filter(r => r.rating_value != null)
      statsMap[app.id] = { uniqueUsers: new Set(appRuns.map(r => r.user_id)).size, thumbsUp: rated.filter(r => r.rating_value === 1).length, rated: rated.length, daily }
    })
    setAppStats(statsMap)

    const allRated = allRuns.filter(r => r.rating_value != null)
    setTotalStats({
      runs: allRuns.length,
      users: new Set(allRuns.map(r => r.user_id)).size,
      satisfaction: allRated.length > 0 ? Math.round((allRated.filter(r => r.rating_value === 1).length / allRated.length) * 100) : null,
    })
    setLoading(false)
  }

  function updateAppInState(updated) {
    setApps(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))
  }

  async function moveAppPhase(appId, newPhase) {
    const phase = normalizeDevPhase(newPhase) || 'design'
    const app = apps.find(a => a.id === appId)
    setPhaseByAppId(prev => ({ ...prev, [appId]: phase }))

    if (phase !== 'deploy' && app?.is_published) {
      await supabase.from('apps').update({ is_published: false }).eq('id', appId)
      updateAppInState({ ...app, is_published: false })
    }

    const { data: row } = await supabase.from('app_blueprints')
      .select('blueprint').eq('app_id', appId).maybeSingle()
    const blueprint = migrateBlueprint({ ...EMPTY_BP, ...(row?.blueprint || {}), dev_phase: phase })
    await supabase.from('app_blueprints').upsert(
      { app_id: appId, user_id: user.id, blueprint, readiness_score: app ? calcReadiness(app, blueprint) : 0, updated_at: new Date().toISOString() },
      { onConflict: 'app_id' }
    )

    if (phase === 'deploy') { setActiveAppId(appId); setTab('deploy') }
    else if (phase === 'test') { setActiveAppId(appId); setTab('test') }
    else { setActiveAppId(appId); setTab('design') }
  }

  function returnToDesignForPublishFix(appId, reason) {
    setDeployFixReason(reason || 'the app contract')
    moveAppPhase(appId, 'design')
  }

  const card = 'bg-[#171B33] border border-white/5 rounded-2xl'
  const activeApp = apps.find(a => a.id === activeAppId) || null
  const activeAppPhase = activeApp ? getDevPhase(activeApp, phaseByAppId) : null
  const activeTabMeta = LIFECYCLE_TABS.find(t => t.id === tab) || LIFECYCLE_TABS[0]
  const activePhaseApps = ['design','test','deploy'].includes(tab)
    ? apps.filter(a => getDevPhase(a, phaseByAppId) === tab)
    : apps
  const phaseScopedActiveAppId = ['design','test','deploy'].includes(tab) && activeAppPhase !== tab
    ? null
    : activeAppId
  const SECTION_TITLE = { design: 'Blueprint Studio', test: 'Test Lab', deploy: 'Deploy' }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Sticky top bar: tab ribbon + guide + tab note folder tab ── */}
      <div className="sticky top-0 z-30 bg-[#09101F] border-b border-white/5">
        {/* First-time welcome screen */}
        {!loading && apps.length === 0 && (
          <div className="px-6 pt-6">
            <WelcomeScreen onCreateApp={onOpenCreate} />
          </div>
        )}

        {(loading || apps.length > 0) && (
          <>
            <div className="h-[68px] px-6 bg-[#111827] border-b border-white/5 grid grid-cols-[minmax(220px,1fr)_auto_auto] items-center gap-4">
              <div className="min-w-0 w-[260px]">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-[#6C5CE7]/18 border border-[#6C5CE7]/30 flex items-center justify-center text-sm">{activeTabMeta.icon}</span>
                  <div className="min-w-0">
                    <p className="text-white font-bold text-base leading-tight">Developer Studio</p>
                    <p className="text-slate-400 text-xs truncate">{activeTabMeta.label}: {activeTabMeta.desc}</p>
                  </div>
                </div>
              </div>

              <div className="hidden lg:flex items-center gap-2 text-xs justify-self-center">
                <span className="px-3 py-1.5 rounded-xl bg-[#0E1424] border border-white/8 text-slate-300"><b className="text-white">{apps.length}</b> apps</span>
                <span className="px-3 py-1.5 rounded-xl bg-[#0E1424] border border-white/8 text-slate-300"><b className="text-white">{totalStats.runs}</b> runs</span>
                <span className="px-3 py-1.5 rounded-xl bg-[#0E1424] border border-white/8 text-slate-300"><b className="text-white">{totalStats.satisfaction ?? '—'}{totalStats.satisfaction != null ? '%' : ''}</b> useful</span>
              </div>

              <div className="flex items-center gap-2 shrink-0 justify-self-end">
                <button onClick={onOpenCreate}
                  className="bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shadow-lg shadow-[#6C5CE7]/20">
                  + New AI App
                </button>
                {TAB_NOTES[tab] && <TabNoteFolderTab id={tab} />}
                <button
                  onClick={() => setShowHelp(true)}
                  title="Guide"
                  aria-label="Guide"
                  className="group w-10 h-10 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8 transition-colors duration-300"
                >
                  <span className="aistrix-guide-bulb relative w-7 h-7 rounded-full bg-[#6C5CE7]/25 text-[#A29BFE] text-xs font-bold flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:bg-[#6C5CE7]/35 group-hover:text-white group-active:scale-95">?</span>
                </button>
              </div>
            </div>

            <div className="h-[150px] bg-[#1A2038] grid grid-cols-[minmax(0,1fr)_340px] overflow-hidden">
              <div className="min-w-0 px-4 py-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                {LIFECYCLE_GROUPS.filter(group => group.id !== 'grow').map(group => (
                  <div key={group.id} className="min-w-0 rounded-2xl bg-[#111827]/60 border border-white/8 p-2 h-[60px]">
                    <p className="px-2 pb-1.5 text-[9px] text-slate-500 uppercase font-bold tracking-wider leading-none truncate">{group.label}</p>
                    <div className="flex gap-1 min-w-0">
                      {LIFECYCLE_TABS.filter(t => t.group === group.id).map(t => {
                        const active = tab === t.id
                        return (
                          <button key={t.id} onClick={() => { setTab(t.id); if (['design','test','deploy'].includes(t.id)) setActiveAppId(null) }}
                            className={`flex-1 min-w-0 h-[32px] px-2 py-1.5 rounded-xl transition-all text-left ${
                              active
                                ? 'bg-[#6C5CE7] text-white shadow-md shadow-[#6C5CE7]/25'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}>
                            <span className="flex items-center gap-1 min-w-0">
                              <span className="text-sm leading-none">{t.icon}</span>
                              <span className="text-[10px] font-bold leading-none whitespace-nowrap truncate">{t.label}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                </div>
                <div className="rounded-2xl bg-[#111827]/60 border border-white/8 p-2 h-[62px]">
                  <p className="px-2 pb-1.5 text-[9px] text-slate-500 uppercase font-bold tracking-wider leading-none truncate">Operate & Grow</p>
                  <div className="flex gap-1 min-w-0">
                    {LIFECYCLE_TABS.filter(t => t.group === 'grow').map(t => {
                      const active = tab === t.id
                      return (
                        <button key={t.id} onClick={() => { setTab(t.id); if (['design','test','deploy'].includes(t.id)) setActiveAppId(null) }}
                          className={`flex-1 min-w-0 h-[34px] px-2.5 py-1.5 rounded-xl transition-all text-left ${
                            active
                              ? 'bg-[#6C5CE7] text-white shadow-md shadow-[#6C5CE7]/25'
                              : 'text-slate-400 hover:text-white hover:bg-white/5'
                          }`}>
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm leading-none">{t.icon}</span>
                            <span className="text-[10px] font-bold leading-none whitespace-nowrap truncate">{t.label}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="border-l border-white/5" />
            </div>
          </>
        )}
      </div>

      {/* ── Body: content + right panes ── */}
      {(loading || apps.length > 0) && (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Main content */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-6 space-y-5">
            {/* Tab content */}
            {['design','test','deploy'].includes(tab) ? (
              phaseScopedActiveAppId ? (
                <>
                  {tab === 'design' && <DesignTab   apps={activePhaseApps} allApps={apps} loading={loading} onOpenCreate={onOpenCreate} user={user} onAppUpdated={updateAppInState} onGoToTest={appId => { moveAppPhase(appId, 'test'); setDeployFixReason('') }} selectedAppId={phaseScopedActiveAppId} onSelectApp={setActiveAppId} deployFixReason={deployFixReason} phaseByAppId={phaseByAppId} />}
                  {tab === 'test'   && <TestTab     apps={activePhaseApps} allApps={apps} user={user} selectedAppId={phaseScopedActiveAppId} onSelectApp={setActiveAppId} phaseByAppId={phaseByAppId} />}
                  {tab === 'deploy' && <DeployTab   apps={activePhaseApps} user={user} onAppUpdated={updateAppInState} onFixInDesign={returnToDesignForPublishFix} selectedAppId={phaseScopedActiveAppId} onSelectApp={setActiveAppId} phaseByAppId={phaseByAppId} />}
                </>
              ) : (
                (() => {
                  const designApps = apps.filter(a => getDevPhase(a, phaseByAppId) === 'design')
                  const appRow = (a) => {
                    const phase = DEV_PHASES[getDevPhase(a, phaseByAppId)]
                    return (
                      <div key={a.id} className="relative">
                        <button onClick={() => setActiveAppId(a.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#131929] border border-white/8 hover:border-white/20 hover:bg-[#1A2038] text-left transition-colors">
                          <AppEmojiWithType app={a} size="lg" />
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <p className="text-white text-sm font-semibold truncate">{a.name}</p>
                            <p className="text-slate-500 text-xs truncate">{a.description || 'No description'}</p>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${phase.bg} ${phase.color} ${phase.border}`}>
                            {phase.label}
                          </span>
                        </button>
                      </div>
                    )
                  }
                  if (tab === 'design') return (
                    <div className="space-y-6 max-w-xl mx-auto py-12">
                      <div className="bg-[#171B33] border border-[#6C5CE7]/25 rounded-2xl p-7 text-center shadow-xl shadow-[#6C5CE7]/10">
                        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#6C5CE7]/20 border border-[#6C5CE7]/30 flex items-center justify-center text-2xl">✏️</div>
                        <div>
                          <p className="text-white font-bold text-xl">Design a new AI app</p>
                          <p className="text-slate-400 text-sm mt-2 max-w-sm mx-auto">Start with an app idea, define the blueprint, then move it through Test and Deploy.</p>
                        </div>
                        <button onClick={onOpenCreate}
                          className="mt-6 inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white font-bold text-base transition-colors shadow-lg shadow-[#6C5CE7]/30">
                          ＋ New AI App
                        </button>
                        <p className="text-[11px] text-slate-500 mt-3">Only apps in Design phase can be edited here.</p>
                      </div>
                      {designApps.length > 0 ? (
                        <div className="space-y-2">
                          {designApps.map(appRow)}
                        </div>
                      ) : null}
                    </div>
                  )
                  const testableApps = apps.filter(a => getDevPhase(a, phaseByAppId) === 'test')
                  const deployableApps = apps.filter(a => getDevPhase(a, phaseByAppId) === 'deploy')
                  if (tab === 'test') {
                    if (!testableApps.length && !designApps.length) return (
                      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                        <span className="text-4xl">🧪</span>
                        <p className="text-white font-semibold text-sm">No apps to test yet</p>
                        <p className="text-slate-500 text-xs max-w-xs">Design your first app to get started.</p>
                      </div>
                    )
                    return (
                      <div className="space-y-6 max-w-lg mx-auto py-12">
                        {testableApps.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400/70 px-1">🧪 Ready to test</p>
                            {testableApps.map(appRow)}
                          </div>
                        )}
                        {designApps.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 px-1">✏️ Still designing — blueprint may be incomplete</p>
                            {designApps.map(appRow)}
                          </div>
                        )}
                      </div>
                    )
                  }
                  const testedApps = apps.filter(a => getDevPhase(a, phaseByAppId) === 'test')
                  if (!deployableApps.length && !testedApps.length) return (
                    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                      <span className="text-4xl">🚀</span>
                      <p className="text-white font-semibold text-sm">No apps ready to deploy</p>
                      <p className="text-slate-500 text-xs max-w-xs">Complete testing first, then move an app to Deploy phase.</p>
                    </div>
                  )
                  return (
                    <div className="space-y-6 max-w-lg mx-auto py-12">
                      {testedApps.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-widest text-amber-400/70 px-1">🧪 Testing — finish validation before deploying</p>
                          {testedApps.map(appRow)}
                        </div>
                      )}
                      {deployableApps.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/70 px-1">🚀 Ready to deploy</p>
                          {deployableApps.map(appRow)}
                        </div>
                      )}
                    </div>
                  )
                })()
              )
            ) : null}
            {tab === 'sell'     && <SellTab     apps={apps} user={user} onAppUpdated={updateAppInState} />}
            {tab === 'monitor'  && <MonitorTab  apps={apps} appStats={appStats} loading={loading} totalStats={totalStats} runs={runs} entitlements={entitlements} user={user} />}
            {tab === 'evaluate' && <EvaluateTab apps={apps} appStats={appStats} runs={runs} user={user} />}
            {tab === 'improve'  && <ImproveTab  apps={apps} user={user} runs={runs} selectedAppId={activeAppId} onSelectApp={setActiveAppId} />}
            {tab === 'version'  && <VersionTab  apps={apps} user={user} onAppUpdated={updateAppInState} selectedAppId={activeAppId} onSelectApp={setActiveAppId} />}
            {tab === 'monetize' && <MonetizeTab apps={apps} runs={runs} loading={loading} user={user} />}
            {tab === 'secrets'  && <SecretsTab  apps={apps} user={user} selectedAppId={activeAppId} onSelectApp={setActiveAppId} />}
          </div>

          {/* ── Right: App navigator ── */}
          {['design','test','deploy','improve','version','secrets'].includes(tab) && (
            <div className="shrink-0 overflow-y-auto border-l border-white/5 w-[340px]">
              <AppNavigator
                apps={apps}
                phaseByAppId={phaseByAppId}
                activeAppId={activeAppId}
                activeTab={tab}
                onSelectApp={id => setActiveAppId(id)}
                onSwitchTab={setTab}
                onMovePhase={moveAppPhase}
                onCreateApp={onOpenCreate}
              />
            </div>
          )}


        </div>
      )}

      {/* Help panel */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  )
}
