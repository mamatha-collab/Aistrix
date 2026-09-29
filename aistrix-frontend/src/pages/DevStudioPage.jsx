import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'
import ToolsEditor from '../components/ToolsEditor'
import TestSuite from '../components/TestSuite'

const PromptStudio = lazy(() => import('../components/PromptStudio'))

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
  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Create an app in the Design tab to start deploying.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Per-app deploy cards */}
      <div className="space-y-4">
        {apps.map(app => (
          <AppDeployCard key={app.id} app={app} onUpdate={onAppUpdated} />
        ))}
      </div>

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

// ─── Tab: Sell ────────────────────────────────────────────────────────────────

function SellTab({ apps }) {
  return (
    <div className="space-y-4">
      {apps.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-3">Current pricing</p>
          <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-white/5">
                  <th className="px-4 py-3 font-medium">App</th>
                  <th className="px-4 py-3 font-medium text-right">Pricing model</th>
                  <th className="px-4 py-3 font-medium text-right">Price / run</th>
                  <th className="px-4 py-3 font-medium text-right">Total runs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {apps.map(app => (
                  <tr key={app.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span>{app.emoji}</span>
                        <span className="text-white font-medium truncate max-w-[160px]">{app.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {app.is_paid
                        ? <span className="text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full text-[10px]">Paid</span>
                        : <span className="text-slate-500 bg-white/5 px-2 py-0.5 rounded-full text-[10px]">Free</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {app.is_paid && app.price_per_run ? `$${Number(app.price_per_run).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">{app.total_runs || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-600 mt-2">Edit pricing in app settings (⚙ icon in the app detail panel).</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComingSoonCard
          icon="🏪"
          title="Marketplace Listing"
          desc="Submit your app for public discovery, featured placement, and category search."
          bullets={[
            'Self-serve marketplace submission',
            'Developer profile and portfolio page',
            'Star ratings separate from run quality scores',
            'Featured / New / Trending automatic badges',
          ]}
        />
        <ComingSoonCard
          icon="💳"
          title="Billing & Payouts"
          desc="Set up subscriptions, usage-based pricing, or team licenses — Aistrix handles the billing layer."
          bullets={[
            'Subscription tiers (monthly / annual)',
            'Pay-per-run and usage-based models',
            'Team and enterprise license deals',
            'Automatic payout when you cross the threshold',
          ]}
        />
      </div>
    </div>
  )
}

// ─── Tab: Monitor ────────────────────────────────────────────────────────────

function MonitorTab({ apps, appStats, loading, totalStats }) {
  const [expandedApp, setExpandedApp] = useState(null)
  const toast = useToast()

  async function refreshBadges() {
    const { error } = await supabase.rpc('update_app_badges')
    if (error) toast(error.message, 'error')
    else toast('Trust badges updated', 'success')
  }

  if (loading) return <p className="text-slate-500 text-sm py-10 text-center">Loading…</p>

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Publish an app to start seeing monitor data.</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Total runs" value={totalStats.runs} color="#6C5CE7" />
        <StatTile label="Unique users" value={totalStats.users} color="#00B894" />
        <StatTile label="Satisfaction" value={totalStats.satisfaction !== null ? `${totalStats.satisfaction}%` : '—'} color="#FDCB6E" />
        <StatTile label="Active apps" value={apps.filter(a => a.is_published).length} color="#E84393" />
      </div>

      <div className="flex justify-end">
        <button onClick={refreshBadges}
          className="text-xs text-slate-400 hover:text-white bg-[#1F2444] hover:bg-[#272C52] px-3 py-1.5 rounded-lg transition-colors">
          🏆 Refresh trust badges
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {apps.map(app => {
          const s = appStats[app.id] || { uniqueUsers: 0, thumbsUp: 0, rated: 0, daily: new Array(7).fill(0) }
          const satisfaction = s.rated > 0 ? Math.round((s.thumbsUp / s.rated) * 100) : null
          return (
            <div key={app.id} className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                    style={{ background: (app.color || '#6C5CE7') + '33' }}>{app.emoji}</div>
                  <div>
                    <p className="text-white text-sm font-medium">{app.name}</p>
                    <div className="flex gap-1 mt-0.5">
                      {app.is_verified  && <span className="text-[9px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full">✓ Verified</span>}
                      {app.is_trending  && <span className="text-[9px] text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded-full">🔥 Trending</span>}
                      {app.is_top_rated && <span className="text-[9px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-full">⭐ Top Rated</span>}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500">{app.ai_provider === 'openai' ? '🟢 GPT' : '🟣 Claude'}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Total runs',    value: app.total_runs || 0 },
                  { label: 'Unique users',  value: s.uniqueUsers },
                  { label: 'Satisfaction',  value: satisfaction !== null ? `${satisfaction}%` : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-[#1F2444] rounded-xl p-3 text-center">
                    <p className="text-white font-bold text-lg">{value}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase mb-2">Last 7 days</p>
                <div className="flex items-end gap-1 h-8">
                  {s.daily.map((count, i) => {
                    const max = Math.max(...s.daily, 1)
                    return <div key={i} className="flex-1 bg-[#6C5CE7] rounded-t opacity-70"
                      style={{ height: `${Math.max((count / max) * 28, count > 0 ? 3 : 0)}px` }} />
                  })}
                </div>
              </div>
              <button onClick={() => setExpandedApp(p => p === app.id ? null : app.id)}
                className="mt-3 w-full text-xs text-slate-500 hover:text-white bg-[#1F2444] py-1.5 rounded-lg transition-colors">
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
  )
}

// ─── Tab: Evaluate ────────────────────────────────────────────────────────────

function EvaluateTab({ apps, appStats }) {
  const hasRatings = apps.some(a => (appStats[a.id]?.rated || 0) > 0)

  return (
    <div className="space-y-4">
      {hasRatings && (
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-3">Current quality signals</p>
          <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-white/5">
                  <th className="px-4 py-3 font-medium">App</th>
                  <th className="px-4 py-3 font-medium text-right">Rated runs</th>
                  <th className="px-4 py-3 font-medium text-right">Useful</th>
                  <th className="px-4 py-3 font-medium text-right">Not useful</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {apps.map(app => {
                  const s = appStats[app.id] || {}
                  const useful = s.rated > 0 ? Math.round((s.thumbsUp / s.rated) * 100) : null
                  const notUseful = s.rated > 0 ? Math.round(((s.rated - s.thumbsUp) / s.rated) * 100) : null
                  return (
                    <tr key={app.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{app.emoji}</span>
                          <span className="text-white font-medium truncate max-w-[160px]">{app.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">{s.rated || 0}</td>
                      <td className="px-4 py-3 text-right">
                        {useful !== null
                          ? <span className={useful >= 70 ? 'text-green-400' : useful >= 50 ? 'text-yellow-400' : 'text-red-400'}>{useful}%</span>
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
          </div>
          <p className="text-[11px] text-slate-600 mt-2">Ratings come from 👍 👎 buttons in the app runner.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComingSoonCard
          icon="✅"
          title="Structured Test Cases"
          desc="Define inputs and rules — Aistrix runs them on every version change and shows pass/fail."
          bullets={[
            'Upload test inputs with expected behaviour',
            'Rules: must-include text, must-not-include text, tone, format',
            'Auto-run on version publish',
            'Diff between two versions on the same test suite',
          ]}
        />
        <ComingSoonCard
          icon="📉"
          title="Regression Alerts"
          desc="Get notified when a prompt or model change drops quality below your baseline."
          bullets={[
            'Set a minimum useful-rate threshold per app',
            'Slack / email notification on regression',
            'Automatic draft rollback option',
            'Historical quality trend chart',
          ]}
        />
      </div>
    </div>
  )
}

// ─── Tab: Improve ─────────────────────────────────────────────────────────────

function ImproveTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ComingSoonCard
        icon="🔬"
        title="Prompt Diff & Comparison"
        desc="See exactly what changed between two prompt versions and compare their outputs on the same input."
        bullets={[
          'Side-by-side output comparison',
          'Token and cost delta',
          'Quality score delta (if test suite exists)',
          'One-click promote winner to published',
        ]}
      />
      <ComingSoonCard
        icon="🤖"
        title="AI Improvement Suggestions"
        desc="Aistrix analyses your low-rated runs and suggests prompt rewrites automatically."
        bullets={[
          'Pattern detection across negative-rated outputs',
          'Auto-generated prompt improvement candidates',
          'A/B test the suggestion vs current version',
          'Accept, reject, or tweak with inline editor',
        ]}
      />
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
  )
}

// ─── Tab: Version ─────────────────────────────────────────────────────────────

function VersionTab({ apps }) {
  return (
    <div className="space-y-4">
      {apps.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide mb-3">Published apps</p>
          <div className="space-y-2">
            {apps.map(app => (
              <div key={app.id} className="bg-[#171B33] border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="text-lg">{app.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{app.name}</p>
                  <p className="text-[11px] text-slate-500">Published · updated {timeAgo(app.updated_at || app.created_at)}</p>
                </div>
                <span className="text-[10px] text-[#A29BFE] bg-[#6C5CE7]/15 px-2 py-0.5 rounded-full">v{app.version || 1}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-600 mt-2">Full version history is available in each app's detail panel → ⏱ History.</p>
        </div>
      )}
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

// ─── Tab: Monetize (Cost & Profit Meter) ─────────────────────────────────────

function MonetizeTab({ apps, runs, loading }) {
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
        Token costs are estimates based on published model pricing. Actual costs may vary. Revenue figures assume every run was charged (no refunds or free tiers).
        {profitData.some(d => d.withTokens === 0 && d.appRuns > 0) && ' Some apps have no token data recorded — token tracking is active for new runs.'}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComingSoonCard
          icon="💰"
          title="Revenue Dashboard"
          desc="Real revenue from paid runs, subscription billing, and payout history — once the billing layer is live."
          bullets={[
            'Actual charged revenue vs estimated',
            'Failed payment rate',
            'Monthly recurring revenue (MRR)',
            'Payout request and history',
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
  { id: 'sell',     label: 'Sell',     icon: '💳',  desc: 'Monetize' },
  { id: 'monitor',  label: 'Monitor',  icon: '📡',  desc: 'Watch it' },
  { id: 'evaluate', label: 'Evaluate', icon: '🎯',  desc: 'Quality' },
  { id: 'improve',  label: 'Improve',  icon: '🔬',  desc: 'Iterate' },
  { id: 'version',  label: 'Version',  icon: '📦',  desc: 'History' },
  { id: 'monetize', label: 'Monetize', icon: '💰',  desc: 'Profit' },
]

export default function DevStudioPage({ user, onOpenCreate }) {
  const [tab, setTab] = useState('design')
  const [apps, setApps] = useState([])
  const [runs, setRuns] = useState([])
  const [appStats, setAppStats] = useState({})
  const [totalStats, setTotalStats] = useState({ runs: 0, users: 0, satisfaction: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const { data: myApps } = await supabase.from('apps')
      .select('*').eq('created_by', user.id).order('total_runs', { ascending: false })
    if (!myApps?.length) { setLoading(false); return }
    setApps(myApps)

    const { data: runData } = await supabase.from('run_history')
      .select('id, app_id, app_name, created_at, rating, user_id, input_tokens, output_tokens')
      .in('app_id', myApps.map(a => a.id))
    const allRuns = runData || []
    setRuns(allRuns)

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
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-white text-xl font-semibold">Dev Studio</h1>
        <p className="text-slate-400 text-sm mt-0.5">Design → Test → Deploy → Sell → Monitor → Evaluate → Improve → Version → Monetize</p>
      </div>

      {/* Lifecycle tab strip */}
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
      {tab === 'sell'     && <SellTab     apps={apps} />}
      {tab === 'monitor'  && <MonitorTab  apps={apps} appStats={appStats} loading={loading} totalStats={totalStats} />}
      {tab === 'evaluate' && <EvaluateTab apps={apps} appStats={appStats} />}
      {tab === 'improve'  && <ImproveTab />}
      {tab === 'version'  && <VersionTab  apps={apps} />}
      {tab === 'monetize' && <MonetizeTab apps={apps} runs={runs} loading={loading} />}
    </div>
  )
}
