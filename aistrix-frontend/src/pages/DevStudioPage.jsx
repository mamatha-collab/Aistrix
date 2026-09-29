import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { track, EVENTS } from '../lib/analytics'
import { timeAgo } from '../utils'
import ToolsEditor from '../components/ToolsEditor'
import TestSuite from '../components/TestSuite'
import VersionManager, { useVersions, VersionSetupCard } from '../components/VersionManager'

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
        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-3">What can you build?</p>
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
        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-3">How it works — 9 lifecycle stages</p>
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
        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-3">Built-in features</p>
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
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-3">Quick start</p>
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
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-3">The 9 lifecycle stages</p>
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
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-3">App types</p>
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
      'Run data is pulled from `run_history` — every run inserts a row with `app_id`, `user_id`, `created_at`, `input_tokens`, `output_tokens`, `rating`, `input`, and `output`.',
      'The **30-day volume chart** is computed client-side: runs are bucketed by day using `Math.round((today - runDate) / 86400000)`.',
      '**Token usage** is reported by the AI provider in the SSE stream\'s `done` event and written to `run_history` at end of each run.',
      '**Ratings** are stored as integers (1–5) in `run_history.rating`. Thumbs up/down maps to 1/0.',
      '**Entitlement stats** are loaded from `app_entitlements` — subscriber counts, active vs cancelled, plan types — all fetched in parallel with run history on studio load.',
    ],
  },
  evaluate: {
    color: '#A29BFE',
    title: 'How Evaluate works technically',
    points: [
      'Quality scores are computed per-app from `run_history`: satisfaction = thumbs-up / total rated; health = weighted score across satisfaction (60%), volume (20%), published (10%), verified (10%).',
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
}

function TabNote({ id }) {
  const note = TAB_NOTES[id]
  if (!note) return null
  return (
    <div className="rounded-2xl border p-4 space-y-2.5"
      style={{ background: note.color + '08', borderColor: note.color + '25' }}>
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: note.color }} />
        <p className="text-xs font-semibold" style={{ color: note.color }}>{note.title}</p>
      </div>
      <ul className="space-y-1.5">
        {note.points.map((pt, i) => (
          <li key={i} className="flex gap-2 text-[11px] text-slate-400 leading-relaxed">
            <span className="shrink-0 mt-0.5" style={{ color: note.color + 'CC' }}>›</span>
            <span dangerouslySetInnerHTML={{ __html: pt.replace(/\*\*(.+?)\*\*/g, `<strong class="text-slate-200">$1</strong>`) }} />
          </li>
        ))}
      </ul>
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
      {sub && <p className="text-[11px] text-slate-500 mt-1">{sub}</p>}
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

// ─── Tab: Design ─────────────────────────────────────────────────────────────

function DesignTab({ apps, loading, onOpenCreate, user, onAppUpdated }) {
  const [expandedApp, setExpandedApp] = useState(null)
  const [studioApp, setStudioApp]     = useState(null) // app currently open in PromptStudio

  if (loading) return <p className="text-slate-500 text-sm py-10 text-center">Loading…</p>

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3">🧩</div>
      <p className="text-white font-medium mb-1">No apps yet</p>
      <p className="text-slate-400 text-sm mb-5">Create your first AI app — define inputs, pick a model, publish to users.</p>
      <button onClick={onOpenCreate}
        className="text-sm font-semibold px-5 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
        + Create app
      </button>
    </div>
  )

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">{apps.length} app{apps.length !== 1 ? 's' : ''}</p>
          <button onClick={onOpenCreate}
            className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
            + New app
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {apps.map(app => (
            <div key={app.id} className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                  style={{ background: (app.color || '#6C5CE7') + '33' }}>{app.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm truncate">{app.name}</p>
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-400 capitalize">{app.app_type}</span>
                    {app.is_published
                      ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">● Published</span>
                      : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-500">◌ Draft</span>}
                    {app.ai_provider && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-400">
                      {app.ai_provider === 'openai' ? '🟢' : '🟣'} {app.ai_model?.split('-').slice(0, 2).join('-') || app.ai_provider}
                    </span>}
                  </div>
                </div>
              </div>
              {app.description && (
                <p className="text-xs text-slate-400 line-clamp-2">{app.description}</p>
              )}
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span>⚡ {app.total_runs || 0} runs</span>
                {app.is_paid && <span>· 💳 ${app.price_per_run}/run</span>}
                {app.has_memory && <span>· 💬 Memory</span>}
              </div>

              {/* Prompt preview */}
              {app.system_prompt && (
                <div className="bg-[#0E1424] rounded-lg px-3 py-2 border border-white/5">
                  <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1">System Prompt</p>
                  <p className="text-[11px] text-slate-400 line-clamp-2 font-mono leading-relaxed">{app.system_prompt}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setStudioApp(app)}
                  className="text-xs font-semibold py-1.5 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
                  ✏️ Edit prompt
                </button>
                <button onClick={() => setExpandedApp(p => p === app.id ? null : app.id)}
                  className="text-xs text-slate-500 hover:text-white bg-[#1F2444] py-1.5 rounded-lg transition-colors">
                  {expandedApp === app.id ? '▲ Tools' : '🔧 Tools'}
                </button>
              </div>
              {expandedApp === app.id && (
                <div className="border-t border-white/5 pt-3">
                  <ToolsEditor appId={app.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {studioApp && (
        <Suspense fallback={null}>
          <PromptStudio
            app={studioApp}
            user={user}
            onClose={() => setStudioApp(null)}
            onSaved={updated => { onAppUpdated?.(updated); setStudioApp(null) }}
          />
        </Suspense>
      )}
    </>
  )
}

// ─── Tab: Test ────────────────────────────────────────────────────────────────

function TestTab({ apps, user }) {
  return (
    <div className="space-y-5">
      <TestSuite apps={apps} user={user} />

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

// ─── Tab: Deploy ─────────────────────────────────────────────────────────────

const CONTEXT_OPTS = [
  { id: 'career_profile',   label: '💼 Career Profile',   desc: 'Resume, skills, experience' },
  { id: 'business_profile', label: '🏢 Business Profile', desc: 'Company, brand voice, audience' },
  { id: 'memory',           label: '🧠 Memory',           desc: 'User preferences & custom facts' },
]

function AppDeployCard({ app: initialApp, onUpdate }) {
  const [app, setApp]               = useState(initialApp)
  const [publishing, setPublishing] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState(app.webhook_url || '')
  const [savingWebhook, setSavingWebhook] = useState(false)
  const [maxRuns, setMaxRuns]       = useState(app.max_runs_per_day || '')
  const [savingQuota, setSavingQuota] = useState(false)
  const [embedTab, setEmbedTab]     = useState('iframe')
  const [expandSection, setExpandSection] = useState(null)
  const toast = useToast()

  function copy(text, label) {
    navigator.clipboard.writeText(text).then(() => toast(`${label} copied`, 'success', 2000))
  }

  // ── Publish checklist ──────────────────────────────────────────────────────
  const checklist = [
    { id: 'prompt',  label: 'System prompt written',   ok: !!app.system_prompt?.trim(),   fix: 'Open Prompt Studio in Design tab' },
    { id: 'desc',    label: 'Description filled',      ok: !!app.description?.trim(),      fix: 'Add a description in app settings' },
    { id: 'model',   label: 'AI model selected',       ok: !!app.ai_model,                 fix: 'Choose a model in app settings' },
    { id: 'price',   label: 'Pricing configured',      ok: !app.is_paid || !!app.price_per_run, fix: 'Set price_per_run in app settings', skip: !app.is_paid },
  ].filter(c => !c.skip)

  const checklistPassed = checklist.every(c => c.ok)
  const canPublish = checklistPassed

  async function togglePublish() {
    setPublishing(true)
    const next = !app.is_published
    const { error } = await supabase.from('apps').update({ is_published: next }).eq('id', app.id)
    setPublishing(false)
    if (error) { toast(error.message, 'error'); return }
    const updated = { ...app, is_published: next }
    setApp(updated)
    onUpdate?.(updated)
    toast(next ? '🚀 App is now live' : 'App set to draft', next ? 'success' : 'info', 3000)
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
          style={{ background: (app.color || '#6C5CE7') + '33' }}>{app.emoji}</div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm truncate">{app.name}</p>
          <p className="text-[10px] text-slate-500">{app.app_type} · {app.ai_provider === 'openai' ? '🟢' : '🟣'} {app.ai_model?.split('-').slice(0, 3).join('-') || 'default'}</p>
        </div>
        <div className="flex items-center gap-2">
          {app.is_published
            ? <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">● Live</span>
            : <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">◌ Draft</span>}
        </div>
      </div>

      {/* Publish checklist + toggle */}
      <div className="px-5 py-4 border-b border-white/5 space-y-3">
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">Pre-publish checklist</p>
        <div className="space-y-1.5">
          {checklist.map(c => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <span className={c.ok ? 'text-green-400' : 'text-red-400'}>{c.ok ? '✓' : '✗'}</span>
              <span className={c.ok ? 'text-slate-300' : 'text-slate-400'}>{c.label}</span>
              {!c.ok && <span className="text-[10px] text-slate-600 ml-auto">{c.fix}</span>}
            </div>
          ))}
        </div>
        <button
          onClick={togglePublish}
          disabled={publishing || (!canPublish && !app.is_published)}
          title={!canPublish && !app.is_published ? 'Complete checklist before publishing' : ''}
          className={`w-full text-sm font-semibold py-2.5 rounded-xl transition-all disabled:opacity-40 border ${
            app.is_published
              ? 'bg-white/5 hover:bg-white/8 text-slate-300 border-white/10'
              : canPublish
              ? 'bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white border-transparent shadow-lg shadow-[#6C5CE7]/20'
              : 'bg-white/3 text-slate-500 border-white/5 cursor-not-allowed'
          }`}
        >
          {publishing ? '…' : app.is_published ? '⏸ Unpublish (set to draft)' : '🚀 Publish app'}
        </button>
        {!canPublish && !app.is_published && (
          <p className="text-[10px] text-amber-400 text-center">Complete all checklist items to publish</p>
        )}
      </div>

      {/* Share links */}
      <Section id="links" label="🔗 Share links & endpoints">
        <div className="space-y-2">
          {[
            { label: 'App page',      value: `${window.location.origin}/app/${app.id}` },
            { label: 'API endpoint',  value: `https://api.aistrix.com/v1/apps/${app.id}/run` },
            { label: 'Team install',  value: `${window.location.origin}/install/${app.id}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-2 bg-[#0E1424] rounded-lg px-3 py-2 min-w-0">
              <div className="flex-1 min-w-0">
                <p className="text-[9px] text-slate-500 uppercase">{label}</p>
                <code className="text-[10px] text-slate-400 truncate block">{value}</code>
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
          <p className="text-[11px] text-slate-500 leading-relaxed">
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
          <p className="text-[11px] text-slate-500">
            Aistrix will POST the run result to this URL after every successful run.
            Useful for Zapier, Make, or your own backend.
          </p>
          <div className="flex gap-2">
            <input
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="flex-1 bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            />
            <button onClick={saveWebhook} disabled={savingWebhook}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors disabled:opacity-40 shrink-0">
              {savingWebhook ? '…' : 'Save'}
            </button>
          </div>
          {app.webhook_url && (
            <div className="bg-[#0E1424] rounded-lg px-3 py-2">
              <p className="text-[9px] text-slate-500 uppercase font-semibold mb-1">Payload sent on each run</p>
              <pre className="text-[10px] text-slate-400 leading-relaxed">{`{
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
          <p className="text-[11px] text-slate-500">
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
              className="flex-1 bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7] transition-colors"
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

function DeployTab({ apps, user, onAppUpdated }) {
  const [selectedId, setSelectedId] = useState(apps[0]?.id ?? null)
  const selectedApp = apps.find(a => a.id === selectedId)

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Create an app in the Design tab to start deploying.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* App selector */}
      <div>
        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-2">Select app to deploy</p>
        <div className="flex flex-wrap gap-2">
          {apps.map(app => (
            <button key={app.id} onClick={() => setSelectedId(app.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all font-medium ${
                selectedId === app.id
                  ? 'bg-[#6C5CE7]/20 border-[#6C5CE7]/60 text-white'
                  : 'bg-[#1A2038] border-white/10 text-slate-400 hover:text-white hover:border-white/25'
              }`}>
              {app.name}
            </button>
          ))}
        </div>
      </div>

      {/* Selected app deploy card */}
      {selectedApp && <AppDeployCard key={selectedApp.id} app={selectedApp} onUpdate={onAppUpdated} />}

      {/* API Keys */}
      <ApiKeySection user={user} />

      {/* API docs */}
      <div>
        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-3">API reference</p>
        <div className="space-y-3">
          {[
            {
              title: 'Run an app',
              code: `POST https://api.aistrix.com/v1/apps/{app_id}/run
Authorization: Bearer ak_live_xxxxx
Content-Type: application/json

{
  "input": "Your prompt here",
  "inject_context": ["career_profile", "memory"]
}`,
            },
            {
              title: 'Webhook payload (POST to your server)',
              code: `{
  "app_id": "uuid",
  "app_name": "Resume Builder",
  "input": "Software engineer, 5 years...",
  "output": "## Professional Summary\\n...",
  "run_id": "uuid",
  "user_id": "uuid",
  "timestamp": "2025-09-28T10:00:00Z"
}`,
            },
            {
              title: 'Context injection',
              code: `// Declare required_context on your app:
["career_profile"]    // resume, skills, experience
["business_profile"]  // company name, brand voice, audience
["memory"]            // user preferences & custom facts

// Aistrix prompts the user to fill their profile
// before running — then auto-injects it into context.`,
            },
          ].map(s => (
            <div key={s.title} className="bg-[#171B33] border border-white/5 rounded-xl p-4">
              <p className="text-white text-xs font-medium mb-2">{s.title}</p>
              <pre className="text-[11px] text-slate-400 bg-[#0F1225] rounded-lg p-3 overflow-x-auto leading-relaxed whitespace-pre-wrap">{s.code}</pre>
            </div>
          ))}
        </div>
      </div>
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
  const [copied, setCopied] = useState(false)
  function copy() { navigator.clipboard.writeText(LISTING_SETUP_SQL); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return (
    <div className="bg-[#171B33] border border-amber-500/20 rounded-2xl p-6 space-y-4">
      <div>
        <p className="text-amber-400 font-semibold text-sm">⚙️ One-time setup required</p>
        <p className="text-slate-400 text-sm mt-1">Run this SQL in Supabase to enable marketplace listings.</p>
      </div>
      <div className="relative">
        <pre className="text-[11px] text-slate-300 bg-[#0E1424] rounded-xl p-4 overflow-x-auto leading-relaxed">{LISTING_SETUP_SQL}</pre>
        <button onClick={copy} className="absolute top-2 right-2 text-[10px] text-slate-400 hover:text-white bg-white/5 px-2 py-1 rounded-md transition-colors">
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <button onClick={onRetry} className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
        ↺ I ran it — retry
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

  async function submitListing(appId) {
    const l = listingFor(appId)
    if (!l) { toast('Save a listing first', 'error', 2000); return }
    const { data, error } = await supabase.from('marketplace_listings')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', l.id).select().single()
    if (error) { toast(error.message, 'error'); return }
    setListings(prev => prev.map(x => x.id === data.id ? data : x))
    toast('Submitted for review — Aistrix team will review within 48 h', 'success', 4000)
    track(EVENTS.LISTING_SUBMITTED, { app_id: appId })
  }

  if (needsSetup) return <ListingSetupCard onRetry={load} />
  if (listings === null) return <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">Marketplace listings</p>
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
                {l?.tagline && <p className="text-[11px] text-slate-500 truncate">{l.tagline}</p>}
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>
                {l?.status ?? 'no listing'}
              </span>
              <button
                onClick={() => isEditing ? setEditId(null) : openEdit(app)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors">
                {isEditing ? 'Cancel' : l ? 'Edit' : '+ Create'}
              </button>
              {l && l.status === 'draft' && !isEditing && (
                <button onClick={() => submitListing(app.id)}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
                  Submit →
                </button>
              )}
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
                    <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">Title *</label>
                    <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                      className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">Tagline</label>
                    <input value={form.tagline} onChange={e => setForm(p => ({ ...p, tagline: e.target.value }))}
                      placeholder="One sentence pitch"
                      className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">Description</label>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={3} placeholder="What does this app do? Who is it for?"
                    className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 resize-none" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">Category</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                      className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40">
                      <option value="">Select…</option>
                      {LISTING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">Tags <span className="text-slate-600 normal-case font-normal">(comma-separated)</span></label>
                    <input value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))}
                      placeholder="resume, hr, onboarding"
                      className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40" />
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
      <div>
        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-3">Pricing editor</p>
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
                      <span className="text-slate-400 text-xs">$</span>
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
            <p className="text-slate-400 text-xs mt-1 leading-relaxed">
              Aistrix uses <strong className="text-slate-300">Stripe Checkout</strong> for business-user payments and <strong className="text-slate-300">Stripe Connect</strong> for developer payouts. Connect your Stripe account to start collecting revenue from paid apps.
            </p>
            <ul className="mt-2 space-y-1">
              {['Pay-per-run and subscription billing', 'Automatic developer payouts (Stripe Connect)', 'Team & enterprise license deals', 'Full payout dashboard inside Aistrix'].map(b => (
                <li key={b} className="text-[11px] text-slate-500 flex items-center gap-1.5">
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
        <p className="text-[10px] text-slate-600 mt-3 border-t border-white/5 pt-3">
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

// Rating bar (1–5 stars distribution)
function RatingBars({ dist }) {
  const total = Object.values(dist).reduce((s, v) => s + v, 0)
  if (!total) return <p className="text-slate-600 text-xs">No ratings yet</p>
  return (
    <div className="space-y-1">
      {[5, 4, 3, 2, 1].map(star => {
        const count = dist[star] || 0
        const pct   = total ? Math.round((count / total) * 100) : 0
        return (
          <div key={star} className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 w-3 shrink-0">{star}</span>
            <div className="flex-1 bg-[#0E1424] rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
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
          <p className="text-[11px] text-slate-500 truncate">{desc}</p>
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
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors shrink-0">Docs ↗</a>
        )}
      </div>
      {open && (
        <div className="border-t border-white/5 px-4 py-4 space-y-3">
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">{f.label}</label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={vals[f.key]}
                onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 font-mono"
              />
              {f.hint && <p className="text-[10px] text-slate-600 mt-1">{f.hint}</p>}
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

  // Rating distribution across all runs that have a rating
  const ratingDist = useMemo(() => {
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    runs.forEach(r => { if (r.rating >= 1 && r.rating <= 5) dist[r.rating]++ })
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

  const totalRated = Object.values(ratingDist).reduce((s, v) => s + v, 0)
  const avgRating  = totalRated
    ? (Object.entries(ratingDist).reduce((s, [k, v]) => s + Number(k) * v, 0) / totalRated).toFixed(1)
    : null

  return (
    <div className="space-y-6">
      {/* ── Top stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Total runs" value={totalStats.runs} color="#6C5CE7" />
        <StatTile label="Unique users" value={totalStats.users} color="#00B894" />
        <StatTile label="Avg rating" value={avgRating ? `${avgRating} ★` : '—'} color="#FDCB6E"
          sub={totalRated ? `${totalRated} rated` : undefined} />
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
                      <p className="text-xs text-slate-500 shrink-0 ml-2">{count.toLocaleString()}</p>
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
          <p className="text-xs text-slate-500">{totalStats.runs} total</p>
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
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-4">Rating distribution</p>
          <RatingBars dist={ratingDist} />
          {avgRating && (
            <p className="text-xs text-slate-500 mt-3">Average: <span className="text-amber-400 font-semibold">{avgRating} ★</span> across {totalRated} rated runs</p>
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
            const appRuns   = runs.filter(r => r.app_id === app.id)
            const appDist   = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
            appRuns.forEach(r => { if (r.rating >= 1 && r.rating <= 5) appDist[r.rating]++ })

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
                      style={{ background: (app.color || '#6C5CE7') + '33' }}>{app.emoji}</div>
                    <div>
                      <p className="text-white text-sm font-medium">{app.name}</p>
                      <div className="flex gap-1 mt-0.5 flex-wrap">
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
                    <p className="text-[10px] text-slate-600">{s.daily.reduce((a, b) => a + b, 0)} runs</p>
                  </div>
                  <div className="flex items-end gap-1 h-8">
                    {s.daily.map((count, i) => {
                      const max = Math.max(...s.daily, 1)
                      return <div key={i} className="flex-1 bg-[#6C5CE7] rounded-t opacity-70"
                        style={{ height: `${Math.max((count / max) * 28, count > 0 ? 3 : 0)}px` }} />
                    })}
                  </div>
                </div>

                {Object.values(appDist).some(v => v > 0) && (
                  <div className="mb-3">
                    <p className="text-[10px] text-slate-500 uppercase mb-2">Rating breakdown</p>
                    <RatingBars dist={appDist} />
                  </div>
                )}

                <button onClick={() => setExpandedApp(p => p === app.id ? null : app.id)}
                  className="w-full text-xs text-slate-500 hover:text-white bg-[#1F2444] py-1.5 rounded-lg transition-colors">
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
        <p className="text-[10px] text-slate-600 mt-2">Keys are stored in your Supabase account (developer_settings table) and only readable by you. The Aistrix backend uses them to forward traces automatically.</p>
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
  const [lowFilter, setLowFilter]     = useState(2)      // show runs rated ≤ this
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

  // Rating trend: avg rating per day for selected app, last 21 days
  const ratingTrend = useMemo(() => {
    const days = 21
    const buckets = Array.from({ length: days }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i)); d.setHours(0,0,0,0)
      return { date: d, sum: 0, count: 0 }
    })
    runs
      .filter(r => r.app_id === selectedApp && r.rating >= 1 && r.rating <= 5)
      .forEach(r => {
        const today = new Date(); today.setHours(0,0,0,0)
        const d = new Date(r.created_at); d.setHours(0,0,0,0)
        const diff = Math.round((today - d) / 86400000)
        if (diff >= 0 && diff < days) {
          buckets[days - 1 - diff].sum   += r.rating
          buckets[days - 1 - diff].count += 1
        }
      })
    return buckets.map(b => b.count ? parseFloat((b.sum / b.count).toFixed(2)) : null)
  }, [runs, selectedApp])

  // Low-quality runs for selected app
  const lowRuns = useMemo(() =>
    runs
      .filter(r => r.app_id === selectedApp && r.rating != null && r.rating <= lowFilter)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50)
  , [runs, selectedApp, lowFilter])

  const appObj = apps.find(a => a.id === selectedApp)

  return (
    <div className="space-y-6">
      {/* ── Quality score overview table ── */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-3">Quality scores</p>
        <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-500 border-b border-white/5">
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
        <p className="text-[11px] text-slate-600 mt-2">Click a row to drill into that app. Ratings come from 👍 👎 in the app runner.</p>
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
              <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">Rating trend — last 21 days</p>
              <p className="text-[10px] text-slate-600">avg ★ per day</p>
            </div>
            {ratingTrend.every(v => v === null) ? (
              <p className="text-slate-600 text-xs text-center py-4">No rated runs in this period.</p>
            ) : (
              <>
                <div className="flex items-end gap-0.5 h-16">
                  {ratingTrend.map((v, i) => {
                    if (v === null) return <div key={i} className="flex-1" />
                    const h = Math.max(((v - 1) / 4) * 56, 4)
                    const color = v >= 4 ? '#00B894' : v >= 3 ? '#FDCB6E' : '#E84393'
                    return (
                      <div key={i} className="flex-1 rounded-t transition-all group relative"
                        style={{ height: h, background: color, opacity: 0.8 }}>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#0E1424] text-white text-[10px] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                          {v}★
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
              <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">Low-quality run browser</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">Show runs rated ≤</span>
                <select value={lowFilter} onChange={e => setLowFilter(Number(e.target.value))}
                  className="bg-[#0E1424] border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none">
                  {[1,2,3].map(n => <option key={n} value={n}>{n} ★</option>)}
                </select>
                <span className="text-[10px] text-slate-500">({lowRuns.length} runs)</span>
              </div>
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
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${r.rating === 1 ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                        {r.rating}★
                      </span>
                      <p className="text-slate-300 text-xs truncate flex-1">{r.input || r.app_name}</p>
                      <span className="text-[10px] text-slate-600 shrink-0">{timeAgo(r.created_at)}</span>
                      <span className="text-[10px] text-slate-600">{expandRun === r.id ? '▲' : '▼'}</span>
                    </div>
                    {expandRun === r.id && (
                      <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                        {r.input && (
                          <div>
                            <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1">Input</p>
                            <p className="text-xs text-slate-400 leading-relaxed">{r.input}</p>
                          </div>
                        )}
                        {r.output && (
                          <div>
                            <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1">Output</p>
                            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{r.output}</p>
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
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-3">Evaluation framework integrations</p>
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
        <p className="text-[10px] text-slate-600 mt-2">Keys are stored in your developer_settings (Supabase) and forwarded by the Aistrix backend when running evaluations.</p>
      </div>
    </div>
  )
}

// ─── Tab: Improve ─────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL || ''

function ImproveTab({ apps, user, runs }) {
  const [selectedApp, setSelectedApp] = useState(null)
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
      .filter(r => r.app_id === selectedApp && r.rating != null && r.rating <= 2)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
  , [runs, selectedApp])

  async function runAISuggestion() {
    if (!appObj) return
    setSuggesting(true)
    setSuggestion('')
    const examples = worstRuns.slice(0, 5)
      .map((r, i) => `Example ${i + 1}:\nApp: ${r.app_name}\nRating: ${r.rating}★`)
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
      `**Rating:** ${run.rating}★`,
      `**Date:** ${new Date(run.created_at).toLocaleString()}`,
      run.input  ? `\n**Input:**\n\`\`\`\n${run.input}\n\`\`\`` : '',
      run.output ? `\n**Output:**\n\`\`\`\n${run.output}\n\`\`\`` : '',
      '\n---\n*Created from Aistrix Improve tab*',
    ].filter(Boolean).join('\n')
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `[${run.app_name}] Low-rated run (${run.rating}★)`, body, labels: ['ai-quality'] }),
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
      {/* App selector */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">App</p>
        <div className="flex flex-wrap gap-2">
          {apps.map(app => (
            <button key={app.id} onClick={() => { setSelectedApp(app.id); setVA(null); setVB(null); setOutputA(''); setOutputB('') }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${selectedApp === app.id ? 'border-[#6C5CE7]/60 bg-[#6C5CE7]/15 text-white' : 'border-white/5 bg-[#0E1424] text-slate-400 hover:text-white hover:border-white/10'}`}>
              <span>{app.emoji}</span><span>{app.name}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedApp && (
        <>
          {needsSetup && <VersionSetupCard onRetry={() => {}} />}

          {!needsSetup && (
            <>
              {/* Version pickers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[['A (baseline)', vA, setVA], ['B (candidate)', vB, setVB]].map(([label, sel, setSel]) => (
                  <div key={label}>
                    <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">Version {label}</p>
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
                  <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">Prompt diff</p>
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
                  <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">Side-by-side test</p>
                  <textarea
                    value={testInput}
                    onChange={e => setTestInput(e.target.value)}
                    placeholder="Enter a test input to run against both versions…"
                    rows={3}
                    className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 resize-none mb-3"
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
          <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">Open in connected tools</p>
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
            <p className="text-[11px] text-slate-500">Create GitHub issues from low-rated runs for developer follow-up.</p>
          </div>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${ghConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-slate-500'}`}>
            {ghConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        {/* Connection form */}
        {!ghConnected && (
          <div className="border-t border-white/5 px-4 py-4 space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">Personal access token</label>
                <input type="password" value={ghToken} onChange={e => setGhToken(e.target.value)}
                  placeholder="ghp_…"
                  className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 font-mono" />
                <p className="text-[10px] text-slate-600 mt-1">github.com → Settings → Developer settings → Personal access tokens → repo scope</p>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">Repository <span className="text-slate-600 font-normal normal-case">(owner/repo)</span></label>
                <input type="text" value={ghRepo} onChange={e => setGhRepo(e.target.value)}
                  placeholder="acme/my-ai-apps"
                  className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40" />
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={saveGitHub} disabled={ghSaving}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
                {ghSaving ? '…' : 'Connect GitHub'}
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
                <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">
                  {worstRuns.length} low-rated run{worstRuns.length !== 1 ? 's' : ''} · click to create GitHub issue
                </p>
                {worstRuns.map(r => (
                  <div key={r.id} className="flex items-center gap-3 bg-[#0E1424] border border-white/5 rounded-xl px-4 py-2.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${r.rating === 1 ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                      {r.rating}★
                    </span>
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
                  className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors mt-1">
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

function VersionTab({ apps, user, onAppUpdated }) {
  const [selectedApp, setSelectedApp] = useState(apps[0]?.id || null)
  const [integrations, setIntegrations] = useState(null)
  const appObj = apps.find(a => a.id === selectedApp) || null
  const toast  = useToast()

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
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">Select app</p>
        <div className="flex flex-wrap gap-2">
          {apps.map(app => (
            <button key={app.id} onClick={() => setSelectedApp(app.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${selectedApp === app.id ? 'border-[#6C5CE7]/60 bg-[#6C5CE7]/15 text-white' : 'border-white/5 bg-[#0E1424] text-slate-400 hover:text-white hover:border-white/10'}`}>
              <span>{app.emoji}</span><span>{app.name}</span>
            </button>
          ))}
        </div>
        {!apps.length && (
          <p className="text-slate-500 text-sm py-4">No apps yet — create one in the Design tab.</p>
        )}
      </div>

      {appObj && (
        <VersionManager
          app={appObj}
          user={user}
          onRollback={updated => onAppUpdated?.(updated)}
        />
      )}

      {/* Feature flag integrations */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-3">Feature flag integrations</p>
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
              <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">
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
              <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">Publishable key</label>
              <input
                type="text"
                defaultValue={stripe.publishable_key || ''}
                id="stripe-pk"
                placeholder="pk_live_… or pk_test_…"
                className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">Restricted key <span className="text-slate-600 font-normal normal-case">(charges + webhooks scope)</span></label>
              <input
                type="password"
                defaultValue={stripe.restricted_key || ''}
                id="stripe-rk"
                placeholder="rk_live_… or rk_test_…"
                className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 font-mono"
              />
              <p className="text-[10px] text-slate-600 mt-1">Stripe dashboard → Developers → API keys → Restricted keys. Grant: write on charges, read on customers.</p>
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
    <div className="bg-[#171B33] border border-amber-500/20 rounded-2xl p-6 space-y-4">
      <div>
        <p className="text-amber-400 font-semibold text-sm">⚙️ Setup required — entitlements table</p>
        <p className="text-slate-400 text-sm mt-1">Tracks which users have paid access to which apps.</p>
      </div>
      <div className="relative">
        <pre className="text-[11px] text-slate-300 bg-[#0E1424] rounded-xl p-4 overflow-x-auto leading-relaxed">{ENTITLEMENTS_SETUP_SQL}</pre>
        <button onClick={copy} className="absolute top-2 right-2 text-[10px] text-slate-400 hover:text-white bg-white/5 px-2 py-1 rounded-md transition-colors">
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <button onClick={load} className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
        ↺ I ran it — retry
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
          <p className="text-[11px] text-slate-500 mt-0.5">
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
              <tr className="text-left text-[11px] text-slate-500 border-b border-white/5">
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

// ─── Tab: Monetize (Cost & Profit Meter) ─────────────────────────────────────

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
          <p className="text-[11px] text-slate-500 mt-0.5">Costs estimated from token usage × model rate. Revenue from price_per_run × run count.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-500 border-b border-white/5">
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
                          <p className="text-[10px] text-slate-600">{app.ai_model?.split('-').slice(0, 3).join('-') || app.ai_provider || '—'}</p>
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

      <p className="text-[11px] text-slate-600">
        Token costs are estimates based on published model pricing. Actual costs may vary. Revenue figures assume every run was charged.
        {profitData.some(d => d.withTokens === 0 && d.appRuns > 0) && ' Some apps have no token data — token tracking is active for new runs.'}
      </p>

      {/* ── Stripe connection ── */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-3">Stripe billing</p>
        <div className="space-y-3">
          <StripeCard user={user} />
        </div>
      </div>

      {/* ── Entitlements viewer ── */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-3">User entitlements</p>
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
  const [keys, setKeys] = useState([])
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)
  const [revealed, setRevealed] = useState(null)
  const toast = useToast()

  useEffect(() => { loadKeys() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadKeys() {
    const { data } = await supabase.from('developer_api_keys')
      .select('id, name, api_key, is_active, last_used_at, total_calls, created_at')
      .eq('user_id', user.id).order('created_at', { ascending: false })
    if (data) setKeys(data)
  }

  async function createKey() {
    if (!newKeyName.trim()) return
    setCreating(true)
    const raw = 'ak_live_' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    const { data, error } = await supabase.from('developer_api_keys').insert({
      user_id: user.id, name: newKeyName.trim(), api_key: raw,
    }).select().single()
    setCreating(false)
    if (error) { toast(error.message, 'error'); return }
    setKeys(prev => [data, ...prev])
    setRevealed(data.id)
    setNewKeyName('')
    toast('API key created — copy it now, it won\'t be shown again', 'success', 6000)
  }

  async function revokeKey(id) {
    const { error } = await supabase.from('developer_api_keys').update({ is_active: false }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setKeys(prev => prev.map(k => k.id === id ? { ...k, is_active: false } : k))
  }

  async function deleteKey(id) {
    const { error } = await supabase.from('developer_api_keys').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setKeys(prev => prev.filter(k => k.id !== id))
  }

  return (
    <div>
      <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-3">API keys</p>
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
        <div className="flex gap-2">
          <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createKey()}
            placeholder="Key name (e.g. Production, Zapier)"
            className="flex-1 bg-[#1F2444] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]" />
          <button onClick={createKey} disabled={creating || !newKeyName.trim()}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] disabled:opacity-40 text-white transition-colors">
            {creating ? '…' : '+ Create'}
          </button>
        </div>

        {keys.length === 0
          ? <p className="text-slate-500 text-sm text-center py-4">No API keys yet</p>
          : keys.map(k => (
            <div key={k.id} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-white text-xs font-medium">{k.name}</span>
                  {!k.is_active && <span className="ml-2 text-[9px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">Revoked</span>}
                  <span className="ml-2 text-[10px] text-slate-500">
                    {k.total_calls || 0} calls{k.last_used_at ? ` · last ${timeAgo(k.last_used_at)}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setRevealed(p => p === k.id ? null : k.id)}
                    className="text-[10px] text-slate-500 hover:text-white transition-colors">
                    {revealed === k.id ? 'Hide' : 'Show'}
                  </button>
                  {k.is_active && <button onClick={() => revokeKey(k.id)} className="text-[10px] text-slate-500 hover:text-orange-400 transition-colors">Revoke</button>}
                  <button onClick={() => deleteKey(k.id)} className="text-[10px] text-slate-500 hover:text-red-400 transition-colors">Delete</button>
                </div>
              </div>
              {revealed === k.id ? (
                <div className="flex items-center gap-2 bg-[#0F1225] border border-[#6C5CE7]/30 rounded-lg px-3 py-2">
                  <code className="text-xs text-[#6C5CE7] flex-1 break-all font-mono">{k.api_key}</code>
                  <button onClick={() => { navigator.clipboard.writeText(k.api_key); toast('Copied!', 'success', 2000) }}
                    className="text-slate-400 hover:text-white text-xs shrink-0">📋</button>
                </div>
              ) : (
                <code className="text-xs text-slate-600 font-mono">{k.api_key.slice(0, 16)}{'•'.repeat(20)}</code>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const LIFECYCLE_TABS = [
  { id: 'design',   label: 'Design',   icon: '✏️',  desc: 'Build apps' },
  { id: 'test',     label: 'Test',     icon: '🧪',  desc: 'Validate' },
  { id: 'deploy',   label: 'Deploy',   icon: '🚀',  desc: 'Ship it' },
  { id: 'sell',     label: 'Marketplace', icon: '🛒',  desc: 'List & sell' },
  { id: 'monitor',  label: 'Monitor',     icon: '📡',  desc: 'Watch it' },
  { id: 'evaluate', label: 'Evaluate',    icon: '🎯',  desc: 'Quality' },
  { id: 'improve',  label: 'Improve',     icon: '🔬',  desc: 'Iterate' },
  { id: 'version',  label: 'Version',     icon: '📦',  desc: 'History' },
  { id: 'monetize', label: 'Revenue',     icon: '💰',  desc: 'Profit' },
]

export default function DevStudioPage({ user, onOpenCreate }) {
  const [tab, setTab] = useState('design')
  const [apps, setApps] = useState([])
  const [runs, setRuns] = useState([])
  const [appStats, setAppStats] = useState({})
  const [totalStats, setTotalStats] = useState({ runs: 0, users: 0, satisfaction: null })
  const [entitlements, setEntitlements] = useState([])
  const [loading, setLoading] = useState(true)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => { load() }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const { data: myApps } = await supabase.from('apps')
      .select('*').eq('created_by', user.id).order('total_runs', { ascending: false })
    if (!myApps?.length) { setLoading(false); return }
    setApps(myApps)

    const [{ data: runData }, { data: entData }] = await Promise.all([
      supabase.from('run_history')
        .select('id, app_id, app_name, created_at, rating, user_id, input_tokens, output_tokens, input, output')
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
      const rated = appRuns.filter(r => r.rating != null)
      statsMap[app.id] = { uniqueUsers: new Set(appRuns.map(r => r.user_id)).size, thumbsUp: rated.filter(r => r.rating === 1).length, rated: rated.length, daily }
    })
    setAppStats(statsMap)

    const allRated = allRuns.filter(r => r.rating != null)
    setTotalStats({
      runs: allRuns.length,
      users: new Set(allRuns.map(r => r.user_id)).size,
      satisfaction: allRated.length > 0 ? Math.round((allRated.filter(r => r.rating === 1).length / allRated.length) * 100) : null,
    })
    setLoading(false)
  }

  const card = 'bg-[#171B33] border border-white/5 rounded-2xl'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex min-h-full">

        {/* ── Left: main content ── */}
        <div className="flex-1 min-w-0 px-6 py-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-white text-xl font-semibold">Dev Studio</h1>
              <p className="text-slate-400 text-sm mt-0.5">Design → Test → Deploy → Marketplace → Monitor → Evaluate → Improve → Version → Revenue</p>
            </div>
            <button onClick={() => setShowHelp(true)}
              className="shrink-0 flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-[#1F2444] hover:bg-[#272C52] border border-white/10 px-3 py-1.5 rounded-lg transition-colors">
              <span className="w-4 h-4 rounded-full bg-[#6C5CE7]/30 text-[#A29BFE] text-[10px] font-bold flex items-center justify-center">?</span>
              Guide
            </button>
          </div>

          {/* First-time welcome screen */}
          {!loading && apps.length === 0 && (
            <WelcomeScreen onCreateApp={onOpenCreate} />
          )}

          {/* Lifecycle tab strip + content (hidden on first visit) */}
          {(loading || apps.length > 0) && <>
            <div className="overflow-x-auto no-scrollbar">
              <div className="flex gap-1 bg-[#1A2038] p-1 rounded-xl w-max min-w-full">
                {LIFECYCLE_TABS.map((t, i) => {
                  const active = tab === t.id
                  return (
                    <button key={t.id} onClick={() => setTab(t.id)}
                      className={`flex flex-col items-center px-3 py-2 rounded-lg transition-all min-w-[68px] ${active ? 'bg-[#6C5CE7] text-white shadow-md shadow-[#6C5CE7]/25' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                      {i > 0 && !active && (
                        <span className="absolute -left-1 top-1/2 -translate-y-1/2 text-slate-700 text-[8px] pointer-events-none hidden sm:block">›</span>
                      )}
                      <span className="text-base leading-none mb-0.5">{t.icon}</span>
                      <span className="text-[10px] font-semibold leading-none">{t.label}</span>
                      <span className={`text-[8px] leading-none mt-0.5 ${active ? 'text-white/70' : 'text-slate-600'}`}>{t.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Tab content */}
            {tab === 'design'   && <DesignTab   apps={apps} loading={loading} onOpenCreate={onOpenCreate} user={user} onAppUpdated={updated => setApps(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))} />}
            {tab === 'test'     && <TestTab apps={apps} user={user} />}
            {tab === 'deploy'   && <DeployTab   apps={apps} user={user} onAppUpdated={updated => setApps(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))} />}
            {tab === 'sell'     && <SellTab     apps={apps} user={user} onAppUpdated={updated => setApps(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))} />}
            {tab === 'monitor'  && <MonitorTab  apps={apps} appStats={appStats} loading={loading} totalStats={totalStats} runs={runs} entitlements={entitlements} user={user} />}
            {tab === 'evaluate' && <EvaluateTab apps={apps} appStats={appStats} runs={runs} user={user} />}
            {tab === 'improve'  && <ImproveTab  apps={apps} user={user} runs={runs} />}
            {tab === 'version'  && <VersionTab  apps={apps} user={user} onAppUpdated={updated => setApps(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))} />}
            {tab === 'monetize' && <MonetizeTab apps={apps} runs={runs} loading={loading} user={user} />}
          </>}
        </div>

        {/* ── Right: sticky tab note panel ── */}
        {apps.length > 0 && TAB_NOTES[tab] && (
          <div className="hidden xl:block w-72 shrink-0 border-l border-white/5">
            <div className="sticky top-0 h-screen overflow-y-auto px-4 py-6">
              <TabNote id={tab} />
            </div>
          </div>
        )}

      </div>

      {/* Help panel */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  )
}
