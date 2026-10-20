import { useState, useEffect, useRef } from 'react'
import { APP_PRIVATE_COLUMNS, withPrivateField } from '../../lib/appColumns'
import { saveAppFields } from '../../lib/appFields'
import { track, EVENTS } from '../../lib/analytics'
import { supabase } from '../../supabase'
import { useToast } from '../../hooks/useToast'
import { publishApp, unpublishApp, getRelease, listVersions } from '../../lib/release'
import { PROMOTE_FIELDS, TOOL_FIELDS, reviewState, sameReviewValue } from '../../lib/promotionReview'
import { downloadReport, deployReport } from '../../lib/reports'
import { PROVIDER_STYLE, providerById, useProviderStatus } from '../../lib/providers'
import PublishedVersions from '../../components/PublishedVersions'
import ConfirmDialog from '../../components/ConfirmDialog'
import SafeCard from '../../components/SafeCard'
import { getTrigger, createTrigger, deleteTrigger, getWebhookSecret, sendTestWebhook, getAppStats, getLivePreview } from '../../lib/deploy'
import ApiKeysManager from '../../components/ApiKeysManager'
import { AppEmojiWithType, EMPTY_BP, PUBLIC_API_URL, getAppTypeLabel, migrateBlueprint } from './shared'


// ─── Promote Modal ───────────────────────────────────────────────────────────

// ~120 characters of `value` starting just before where it differs from
// `other`, so a change late in a long prompt is visible.
function diffSnippet(value, other) {
  const a = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
  const b = typeof other === 'object' && other !== null ? JSON.stringify(other) : String(other ?? '')
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const start = Math.max(0, i - 40)
  return `${start > 0 ? '…' : ''}${a.slice(start, start + 120)}${a.length > start + 120 ? '…' : ''}`
}

// What end users run, compared field by field when promoting (see backend DRAFT_FIELDS).

function PromoteModal({ app, onClose, onPromoted }) {
  const toast = useToast()
  const [step, setStep] = useState('diff')   // 'diff' | 'confirm'
  const [promoting, setPromoting] = useState(false)
  const [bpDiff, setBpDiff] = useState(null)
  const [reviewError, setReviewError] = useState('')

  // The draft vs the live version end users run (apps.prod_snapshot): the
  // same fields the server compares, so a prompt or model change shows up.
  useEffect(() => {
    Promise.all([
      // Prompt, pages and the live snapshot are private columns: editors read them separately.
      supabase.from('apps').select(['id', ...PROMOTE_FIELDS.filter(k => !APP_PRIVATE_COLUMNS.includes(k))].join(', ')).eq('id', app.id).maybeSingle()
        .then(async res => (res.data ? { ...res, data: await withPrivateField(supabase, res.data) } : res)),
      supabase.from('app_blueprints').select('blueprint').eq('app_id', app.id).maybeSingle(),
      supabase.from('app_tools').select(TOOL_FIELDS.join(', ')).eq('app_id', app.id),
    ]).then(([appResult, bpResult, toolsResult]) => {
      const error = appResult.error || bpResult.error || toolsResult.error
      if (error) throw error
      const row = appResult.data
      const bp = bpResult.data
      if (!row) throw new Error('The app could not be loaded. Close this review and try again.')
      const current = reviewState(row, bp?.blueprint, toolsResult.data)
      const live = row?.prod_snapshot
      const prod = live ? reviewState(live, live.blueprint, live.tools) : null
      setBpDiff({ current, prod })
    }).catch(error => setReviewError(error.message || 'Could not load the release review.'))
  }, [app.id])

  // The backend checks the app and its tests for this draft, then saves it
  // as the live version end users run.
  async function promote() {
    setPromoting(true)
    try {
      const res = await publishApp(app.id)
      if (res.pending_review) {
        // An app's first release waits for the Aistrix team; nothing is live yet.
        toast(res.message, 'info', 9000)
        onPromoted?.({ ...app, has_draft_changes: false, is_published: false, status: 'pending', ...(res.version ? { live_version: res.version } : {}) })
        onClose()
        return
      }
      toast('🚀 Changes promoted to production', 'success', 3000)
      track(EVENTS.BUILD_PROMOTED, { app_id: app.id, version: res.version ?? null })
      onPromoted?.({ ...app, has_draft_changes: false, is_published: true, promoted_at: res.promoted_at, change_note: null, ...(res.version ? { live_version: res.version } : {}) })
      onClose()
    } catch (e) {
      toast(e.message, 'error', 9000)
    } finally {
      setPromoting(false)
    }
  }

  const same = sameReviewValue
  const diffFields = bpDiff?.current && bpDiff?.prod ? [
    ...PROMOTE_FIELDS.filter(k => !same(bpDiff.current[k], bpDiff.prod[k]))
      .map(k => ({ key: k, from: bpDiff.prod[k], to: bpDiff.current[k] })),
    ...(!same(bpDiff.current.tools, bpDiff.prod.tools) ? [{ key: 'tools', from: null,
      to: `Tools changed. Current tools: ${bpDiff.current.tools.map(tool => tool.name).join(', ') || 'none'}` }] : []),
    // The design is large: name the parts that changed instead of dumping it.
    ...(() => {
      const keys = [...new Set([...Object.keys(bpDiff.current.blueprint), ...Object.keys(bpDiff.prod.blueprint)])]
        .filter(k => !same(bpDiff.current.blueprint[k], bpDiff.prod.blueprint[k]))
      return keys.length ? [{ key: 'blueprint', from: null, to: `Changed: ${keys.map(k => k.replace(/_/g, ' ')).join(', ')}` }] : []
    })(),
  ] : []

  const FIELD_LABEL = { system_prompt: 'System prompt', ai_provider: 'AI provider', ai_model: 'Model', output_type: 'Output format', form_schema: 'Form fields',
    tone: 'Tone', greeting: 'Greeting', input_placeholder: 'Input hint', app_type: 'App type', has_memory: 'Memory', blueprint: 'Design', pages: 'Pages', tools: 'Tools' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-[#141828] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div>
            <p className="text-white font-semibold text-sm">Promote to Production</p>
            <p className="text-slate-400 text-xs mt-0.5">{app.emoji} {app.name}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none px-1">×</button>
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
            reviewError ? <p role="alert" className="text-red-300 text-sm">{reviewError}</p> : bpDiff === null ? (
              <p className="text-slate-500 text-sm text-center py-6">Loading…</p>
            ) : diffFields.length === 0 && bpDiff.prod ? (
              <div className="text-center py-6">
                <p className="text-slate-300 text-sm font-semibold">No changes to promote</p>
                <p className="text-slate-500 text-xs mt-1">The draft matches the live version.</p>
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
                      <p className="text-xs text-red-300/70 line-through leading-relaxed">{diffSnippet(from, to)}</p>
                    )}
                    <p className="text-xs text-green-300 leading-relaxed">{diffSnippet(to, from)}</p>
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
            <button onClick={() => setStep('confirm')} disabled={!bpDiff || !!reviewError || (!!bpDiff.prod && diffFields.length === 0)}
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
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

// One group on Deploy (Publish, Share, Embed…). Defined outside AppDeployCard
// so its inputs keep focus while typing.
function DeployCard({ icon, title, subtitle, right, cardRef, children }) {
  return (
    <div ref={cardRef} className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3 scroll-mt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-white font-semibold uppercase tracking-wide">{icon} {title}</p>
          {subtitle && <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
        {right}
      </div>
      {/* Content is a function so it renders inside the boundary: a crash
          here shows an error in this card only. */}
      <SafeCard name={title}>{children}</SafeCard>
    </div>
  )
}

// What end users see: the live version's page, drawn from the server's copy
// of it (the real app page would show you, the developer, the draft).
function LivePreviewCard({ appId, hasChanges, liveUrl, isPublished, liveVersion, promotedAt }) {
  const [view, setView] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setError('')
    getLivePreview(appId).then(next => {
      if (active) { setView(next); setError('') }
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [appId, hasChanges, isPublished, liveVersion, promotedAt])

  const fields = view?.app_type === 'native' ? (view.form_schema || []).filter(f => f.label) : []
  const caption = !view ? '' : view.source === 'live'
    ? `Live${view.live_version ? ` · v${view.live_version}` : ''}${hasChanges ? ' — your draft changes are not shown until you promote them' : ''}`
    : view.source === 'offline' ? 'Unpublished — this is the last live version' : 'Not published yet — this is how it will look'
  const box = 'w-full bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-[11px] text-slate-500'

  return (
    <DeployCard icon="👀" title="What users will see" subtitle={caption}
      right={<a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-slate-400 hover:text-white shrink-0">Open app page ↗</a>}>{() => (<>
      {error && <p className="text-xs text-amber-300">{error}</p>}
      {!view && !error && <p className="text-xs text-slate-500">Loading preview…</p>}
      {view && (
        <div className="rounded-xl border border-white/8 bg-[#0A0F1E] p-4 space-y-3" aria-label="Preview of the app page">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0" style={{ background: (view.color || '#6C5CE7') + '33' }}>{view.emoji || '✨'}</div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{view.name}</p>
              {view.description && <p className="text-[11px] text-slate-400 line-clamp-2">{view.description}</p>}
            </div>
          </div>
          {view.app_type === 'chatbot' ? (
            <div className="space-y-2">
              <div className="bg-white/5 rounded-xl rounded-tl-sm px-3 py-2 text-[11px] text-slate-300 max-w-[85%]">{view.greeting || 'Hi! How can I help?'}</div>
              <div className={box}>{view.input_placeholder || 'Type a message…'}</div>
            </div>
          ) : fields.length ? (
            <div className="space-y-2">
              {fields.slice(0, 5).map(f => (
                <div key={f.id || f.label}>
                  <p className="text-[10px] text-slate-400 mb-1">{f.label}{f.required && <span className="text-red-400"> *</span>}</p>
                  <div className={`${box} ${f.type === 'textarea' ? 'h-12' : ''}`}>{f.placeholder || (f.type === 'select' ? 'Select…' : '')}</div>
                </div>
              ))}
              {fields.length > 5 && <p className="text-[10px] text-slate-600">+ {fields.length - 5} more field{fields.length - 5 === 1 ? '' : 's'}</p>}
            </div>
          ) : view.app_type === 'data' ? (
            <div className={`${box} border-dashed text-center py-4`}>📄 Upload a file (CSV, Excel, PDF…)</div>
          ) : (
            <div className={`${box} h-14`}>{view.input_placeholder || 'Describe what you need…'}</div>
          )}
          <div className="flex justify-end">
            <span className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7]/60 text-white/80">{view.app_type === 'chatbot' ? 'Send' : '▶ Run'}</span>
          </div>
        </div>
      )}
    </>)}</DeployCard>
  )
}

function AppDeployCard({ app: initialApp, onUpdate, onFixInDesign, onMovePhase, onOpenKeys, user }) {
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
  const [justLive, setJustLive]     = useState(null)
  const [exporting, setExporting]   = useState(false)   // { version } right after publishing / promoting
  const [trigger, setTrigger]       = useState(undefined)   // undefined = loading, null = none, string = token
  const [triggerBusy, setTriggerBusy] = useState(false)
  const [confirmTrigger, setConfirmTrigger] = useState(null)   // 'replace' | 'off'
  const [webhookSecret, setWebhookSecret] = useState('')
  const [testingWebhook, setTestingWebhook] = useState(false)
  const [visitorAccess, setVisitorAccess] = useState(!!app.embed_public)
  const [domainsText, setDomainsText] = useState((app.embed_allowed_domains || []).join('\n'))
  const [savingAccess, setSavingAccess] = useState(false)
  const [bp, setBp]                 = useState(null)   // null = loading, false = no row, object = loaded
  const descriptionRef = useRef(null)
  const publishRef = useRef(null)
  const embedRef = useRef(null)
  const toast = useToast()
  const { providers, loaded: providersLoaded } = useProviderStatus(user?.id)

  useEffect(() => {
    setApp(a => ({ ...a, live_version: initialApp.live_version, is_published: initialApp.is_published, promoted_at: initialApp.promoted_at }))
    loadRelease()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadRelease only reads app.id
  }, [initialApp.live_version, initialApp.is_published, initialApp.promoted_at])

  const [runStats, setRunStats] = useState(null)
  // The server's publish check (GET /release): the same checks and tests
  // that decide whether Publish / Promote is allowed.
  const [release, setRelease] = useState(null)
  const [releaseError, setReleaseError] = useState('')
  function loadRelease() {
    return getRelease(app.id).then(r => { setRelease(r); setReleaseError('') }).catch(e => setReleaseError(e.message))
  }

  useEffect(() => {
    supabase.from('app_blueprints').select('blueprint, readiness_score')
      .eq('app_id', app.id).maybeSingle()
      .then(({ data }) => setBp(data ? migrateBlueprint({ ...EMPTY_BP, ...data.blueprint }) : false))
    loadRelease()
    // Run history summary: every user's runs (the server reads them all)
    getAppStats(app.id)
      .then(st => setRunStats({ total: st.total, users: st.users, visitorRuns: st.visitor_runs, apiRuns: st.api_runs, satisfaction: st.satisfaction, rated: st.rated,
        avgIn: st.avg_in, avgOut: st.avg_out, lastRun: st.last_run ? new Date(st.last_run) : null }))
      .catch(() => setRunStats(null))
    getTrigger(app.id).then(r => setTrigger(r.token || null)).catch(() => setTrigger(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadRelease only reads app.id
  }, [app.id])

  function copy(text, label) {
    navigator.clipboard.writeText(text).then(() => toast(`${label} copied`, 'success', 2000))
  }

  function openChecklistFix(item) {
    if (item.id === 'desc') {
      // Fixed right here: the description editor is in the Publish card.
      descriptionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => descriptionRef.current?.focus(), 300)
      return
    }
    if (item.id === 'key') {
      onOpenKeys?.()
      return
    }
    if (item.id === 'tests') {
      toast('Opening Test to run the current draft suite before publishing.', 'info', 4000)
      onMovePhase?.(app.id, 'test')
      return
    }
    if (item.id === 'design' || item.id === 'prompt' || item.id === 'model' || item.id === 'schema' || item.id === 'price') {
      const labels = {
        design: 'Design readiness',
        prompt: 'the system prompt',
        model: 'the AI model',
        schema: 'the output schema',
        price: 'pricing',
      }
      toast(`Opening Design to fix ${labels[item.id]}. Run tests again before publishing.`, 'info', 4000)
      onFixInDesign?.(app.id, labels[item.id])
      return
    }
  }

  // ── Publish checklist ──────────────────────────────────────────────────────
  const jsonFormat = bp && bp.output_contract?.format === 'json'
  // Each item shows the server's own messages when it fails; anything the
  // server reports that isn't one of the named items counts under Design.
  const serverChecks = release?.checks || []
  const pick = re => serverChecks.filter(m => re.test(m))
  const problems = {
    prompt: pick(/system prompt/i), desc: pick(/description/i), model: pick(/AI model/i),
    price: pick(/price_per_run/i), schema: pick(/output_schema|output schema field/i),
  }
  const named = new Set(Object.values(problems).flat())
  problems.design = serverChecks.filter(m => !named.has(m))
  problems.tests = release?.test_problems || []
  const tests = release?.tests || {}
  const item = (id, label, fix, skip) => ({ id, fix, skip, ok: !problems[id].length, label: problems[id].length ? problems[id].join(' · ') : label })
  const checklist = [
    item('design', 'Design ready to publish', 'Fix in Design'),
    item('tests', tests.required_total ? `Quality gate passed (${tests.required_passed}/${tests.required_total})` : 'Tests passed for this draft', 'Run tests in Test tab'),
    item('prompt', 'System prompt written', 'Open Prompt Studio in Design tab'),
    item('desc', 'Description filled', 'Write it below'),
    item('model', 'AI model selected', 'Choose a model in Design'),
    item('price', 'Pricing configured', 'Set the price in Design', !app.is_paid),
    item('schema', 'Output schema defined', 'Add at least one field in Design → Output Contract', !jsonFormat && !problems.schema.length),
  ].filter(c => !c.skip)

  // Not a blocker: without the developer's key, "free" apps run on each
  // user's own key or the Aistrix free allowance.
  const provider = providerById(providers, app.ai_provider || 'claude')
  const providerName = PROVIDER_STYLE[provider?.id]?.name || provider?.label || 'AI'
  const keyWarning = providersLoaded && (app.billing_mode || 'free') === 'free' && !app.custom_model_url && !provider?.connected
    ? { id: 'key', warn: true, label: `No ${providerName} key: users will run it on their own key or the Aistrix free allowance`, fix: 'Add your key' }
    : null
  const blockers = checklist.filter(c => !c.ok)

  const canPublish = !!release?.ready
  // Draft differs from the live version (the server compares them).
  const hasChanges = !!release?.has_changes

  async function togglePublish() {
    setPublishing(true)
    const next = !app.is_published
    if (next && !canPublish) {
      setPublishing(false)
      toast([...serverChecks, ...problems.tests].join('; ') || 'Not ready to publish yet', 'error', 6000)
      return
    }
    try {
      // Publishing promotes the draft (checks + tests, saves the live version);
      // unpublishing just takes the app offline.
      const res = next ? await publishApp(app.id) : await unpublishApp(app.id)
      if (next && res?.pending_review) {
        // An app's first release waits for the Aistrix team; nothing is live yet.
        const updated = { ...app, is_published: false, status: 'pending', has_draft_changes: false, ...(res.version ? { live_version: res.version } : {}) }
        setApp(updated)
        onUpdate?.(updated)
        toast(res.message, 'info', 9000)
        return
      }
      const updated = { ...app, is_published: next, ...(next ? { has_draft_changes: false, promoted_at: res?.promoted_at, change_note: null, ...(res?.version ? { live_version: res.version } : {}) } : {}) }
      setApp(updated)
      onUpdate?.(updated)
      setJustLive(next ? { version: res?.version || app.live_version || null, again: !!res?.unchanged } : null)
      if (next) track(EVENTS.BUILD_PUBLISHED, { app_id: app.id, version: res?.version ?? null, back_online: !!res?.unchanged })
      if (!next) toast('App set to draft', 'info', 3000)
    } catch (e) {
      toast(`Publish blocked: ${e.message}`, 'error', 9000)
      track(EVENTS.BUILD_PUBLISH_BLOCKED, { app_id: app.id, problems: e.errors?.length || 1 })
    } finally {
      setPublishing(false)
      loadRelease()
    }
  }

  // A teammate changed a setting first: show their values instead of ours.
  function takeTheirs(current) {
    const updated = { ...app, ...current }
    setApp(updated)
    onUpdate?.(updated)
  }

  async function saveDescription() {
    const clean = description.trim()
    if (!clean) { toast('Description is required before publishing', 'error'); return }
    setSavingDescription(true)
    const { error } = await saveAppFields(supabase, app, { description: clean })
    setSavingDescription(false)
    if (error) { if (error.current) { takeTheirs(error.current); setDescription(error.current.description || '') } toast(error.message, 'error', 7000); return }
    const updated = { ...app, description: clean }
    setApp(updated)
    onUpdate?.(updated)
    toast('Description saved', 'success', 2000)
  }

  // ── Context requirements ───────────────────────────────────────────────────
  async function toggleContext(id) {
    const ctx = app.required_context || []
    const next = ctx.includes(id) ? ctx.filter(c => c !== id) : [...ctx, id]
    const { error } = await saveAppFields(supabase, app, { required_context: next })
    if (error) { if (error.current) takeTheirs(error.current); toast(error.message, 'error', 7000); return }
    const updated = { ...app, required_context: next }
    setApp(updated)
    onUpdate?.(updated)
  }

  // ── Webhook ────────────────────────────────────────────────────────────────
  async function saveWebhook() {
    setSavingWebhook(true)
    const { error } = await saveAppFields(supabase, app, { webhook_url: webhookUrl.trim() || null })
    setSavingWebhook(false)
    if (error) { if (error.current) { takeTheirs(error.current); setWebhookUrl(error.current.webhook_url || '') } toast(error.message, 'error', 7000); return }
    const updated = { ...app, webhook_url: webhookUrl.trim() || null }
    setApp(updated)
    onUpdate?.(updated)
    toast('Webhook saved', 'success', 2000)
  }

  async function testWebhook() {
    setTestingWebhook(true)
    try {
      const r = await sendTestWebhook(app.id)
      if (r.ok) toast(`Test sent — your server answered ${r.status}`, 'success', 4000)
      else toast(r.error || `Test sent, but your server answered ${r.status}`, 'error', 6000)
    } catch (e) {
      toast(e.message, 'error', 6000)
    } finally {
      setTestingWebhook(false)
    }
  }

  async function showWebhookSecret() {
    try { setWebhookSecret((await getWebhookSecret(app.id)).secret) } catch (e) { toast(e.message, 'error') }
  }

  // ── Inbound trigger ────────────────────────────────────────────────────────
  async function makeTrigger() {
    setTriggerBusy(true)
    try { setTrigger((await createTrigger(app.id)).token); toast(trigger ? 'New trigger link created' : 'Trigger link created', 'success', 2500) }
    catch (e) { toast(e.message, 'error', 6000) }
    finally { setTriggerBusy(false); setConfirmTrigger(null) }
  }

  async function removeTrigger() {
    setTriggerBusy(true)
    try { await deleteTrigger(app.id); setTrigger(null); toast('Trigger link turned off', 'info', 2500) }
    catch (e) { toast(e.message, 'error', 6000) }
    finally { setTriggerBusy(false); setConfirmTrigger(null) }
  }

  // ── Website visitors (embed) ───────────────────────────────────────────────
  async function saveAccess() {
    const domains = domainsText.split(/[\s,]+/).map(d => d.trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean)
    const bad = domains.find(d => !/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && d !== 'localhost')
    if (bad) { toast(`"${bad}" is not a valid domain`, 'error'); return }
    if (visitorAccess && !domains.length) {
      toast('Add at least one allowed domain before enabling visitor access', 'error'); return
    }
    setSavingAccess(true)
    const patch = { embed_public: visitorAccess && !app.is_paid, embed_allowed_domains: domains }
    const { error } = await saveAppFields(supabase, app, patch)
    setSavingAccess(false)
    if (error) {
      if (error.current) {
        takeTheirs(error.current)
        if ('embed_public' in error.current) setVisitorAccess(!!error.current.embed_public)
        if ('embed_allowed_domains' in error.current) setDomainsText((error.current.embed_allowed_domains || []).join('\n'))
      }
      toast(error.current ? error.message : `Could not save: ${error.message}`, 'error', 7000); return
    }
    const updated = { ...app, ...patch }
    setApp(updated)
    onUpdate?.(updated)
    setDomainsText(domains.join('\n'))
    toast('Widget access saved', 'success')
  }

  // ── Run quota ──────────────────────────────────────────────────────────────
  async function saveQuota() {
    const val = maxRuns === '' ? null : parseInt(maxRuns, 10)
    if (maxRuns !== '' && (isNaN(val) || val < 1)) { toast('Enter a valid number', 'error'); return }
    setSavingQuota(true)
    const { error } = await saveAppFields(supabase, app, { max_runs_per_day: val })
    setSavingQuota(false)
    if (error?.current) { takeTheirs(error.current); setMaxRuns(error.current.max_runs_per_day || ''); toast(error.message, 'error', 7000); return }
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
  // /embed/ (not /app/): visitor access and the allowed-sites list apply there.
  const embedUrl = `${window.location.origin}/embed/${app.id}`
  const embedCodes = {
    iframe: `<iframe
  src="${embedUrl}"
  width="100%"
  height="640"
  frameborder="0"
  allow="clipboard-write"
  style="border-radius:12px;border:1px solid rgba(255,255,255,0.08)"
></iframe>`,
    js: `<div id="aistrix-app-${app.id.slice(0, 8)}"></div>
<script>
  (function () {
    var iframe = document.createElement('iframe');
    iframe.src = '${embedUrl}';
    iframe.width = '100%';
    iframe.height = '640';
    iframe.frameBorder = '0';
    iframe.allow = 'clipboard-write';
    iframe.style.borderRadius = '12px';
    document.getElementById('aistrix-app-${app.id.slice(0, 8)}').appendChild(iframe);
  })();
</script>`,
  }

  // Links can be copied ahead of launch; until then they don't work.
  const inactiveTag = <span className="ml-2 normal-case text-amber-400/80 bg-amber-500/8 border border-amber-500/20 px-1.5 py-px rounded">Inactive until published</span>
  const liveUrl = `${window.location.origin}/app/${app.id}`
  const btnPrimary = 'bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white border-transparent shadow-lg shadow-[#6C5CE7]/20'
  const btnIdle = 'bg-white/3 text-slate-500 border-white/5 cursor-default'
  const btnSoft = 'text-xs font-semibold px-3 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors disabled:opacity-40'

  // ── Launch status: what's true now, and the one thing to do next ──
  const live = app.is_published
  const wasLive = !!release?.has_live_version
  // An app's first release waits for the Aistrix team (release.review).
  const inReview = release?.review === 'pending'
  const changesRequested = release?.review === 'rejected'
  const steps = [
    { label: 'Draft', ok: !hasChanges || !live,
      value: !release ? '…' : live ? (hasChanges ? `Changed since ${app.live_version ? `v${app.live_version}` : 'live'}` : 'Same as live') : wasLive ? (hasChanges ? 'Changed' : 'Unchanged') : 'New app' },
    { label: 'Test gate', ok: !problems.tests.length,
      value: !release ? '…' : problems.tests.length ? 'Not passed' : tests.required_total ? `${tests.required_passed}/${tests.required_total} passed` : 'Passed' },
    { label: 'Publish checks', ok: !serverChecks.length,
      value: !release ? '…' : serverChecks.length ? `${serverChecks.length} to fix` : 'All pass' },
    { label: 'Live version', ok: live,
      value: live ? (app.live_version ? `v${app.live_version}` : 'Live') : inReview ? 'In review' : wasLive ? 'Offline' : 'Not live' },
  ]
  const fixCount = blockers.length
  const action = !release
    ? { label: 'Checking…', disabled: true }
    : inReview
      ? { label: '⏳ Waiting for review', disabled: true }
    : !live
      ? (canPublish ? { label: wasLive && !hasChanges ? '🚀 Put it back online' : '🚀 Publish app', onClick: togglePublish }
                    : { label: `Fix ${fixCount} item${fixCount === 1 ? '' : 's'} to publish`, onClick: () => publishRef.current?.scrollIntoView({ behavior: 'smooth' }), soft: true })
      : !hasChanges
        ? { label: `● Published${app.live_version ? ` · v${app.live_version}` : ''} · no changes`, disabled: true }
        : canPublish
          ? { label: '🚀 Promote draft to live', onClick: () => setShowPromote(true) }
          : { label: `Fix ${fixCount} item${fixCount === 1 ? '' : 's'} to promote`, onClick: () => publishRef.current?.scrollIntoView({ behavior: 'smooth' }), soft: true }
  const headline = !release
    ? (releaseError ? null : 'Checking this draft…')
    : inReview ? "Waiting for review by the Aistrix team. It goes live as soon as it's approved."
    : changesRequested && !fixCount ? "The Aistrix team asked for changes. Publish again once they're made."
    : fixCount ? `${live ? "Can't promote" : "Can't publish"} yet — ${fixCount} thing${fixCount === 1 ? '' : 's'} to fix`
      : !live ? (wasLive ? 'Ready to go back online' : 'Ready to publish')
        : hasChanges ? 'Your changes are ready to go live' : 'Live and up to date'

  const accessRows = [
    { label: 'Who can open it', value: !live ? 'Only you and your workspace (not live)'
      : app.visibility === 'private' ? 'Only you and your workspace'
      : app.visibility === 'invite' ? 'Only people you invite' : 'Anyone with the link' },
    { label: 'Price', value: app.is_paid ? `$${Number(app.price_per_run || 0).toFixed(2)} per run` : 'Free' },
    { label: 'Who pays for AI', value: app.billing_mode === 'byok'
      ? 'Each user, with their own API key'
      : `Your API key — ${app.free_runs_per_user_day ?? 20} runs per user per day, then their own key` },
    { label: 'Website visitors', value: app.embed_public && !app.is_paid
      ? `Can use it without an account on ${(app.embed_allowed_domains || []).join(', ') || 'any site'}`
      : 'Must sign in to Aistrix' },
  ]

  async function downloadPdf() {
    setExporting(true)
    try {
      const versions = await listVersions(app.id).then(r => r.versions || []).catch(() => [])
      await downloadReport(deployReport(app, {
        release, versions, stats: runStats,
        checklist: [...checklist, ...(keyWarning ? [keyWarning] : [])],
        access: [...accessRows.map(r => [r.label, r.value]), ['Daily run limit', app.max_runs_per_day ? `${app.max_runs_per_day} runs per day` : 'None']],
        links: { 'App page': liveUrl, 'API endpoint': `${PUBLIC_API_URL}/v1/apps/${app.id}/run`,
          'Inbound trigger': trigger ? 'Enabled (link not included in reports)' : 'Off',
          'Webhook': app.webhook_url ? 'Set (signed requests)' : 'Not set' },
      }))
    } catch (e) {
      toast(`Couldn't create the PDF: ${e.message}`, 'error', 6000)
    } finally {
      setExporting(false)
    }
  }

  const checkRow = c => (
    <button key={c.id} type="button" onClick={() => !c.ok && openChecklistFix(c)}
      className={`w-full flex items-center gap-2 text-xs rounded-lg px-1.5 py-1 text-left transition-colors ${!c.ok ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}>
      <span className={c.ok ? 'text-green-400' : c.warn ? 'text-amber-400' : 'text-red-400'}>{c.ok ? '✓' : c.warn ? '⚠' : '✗'}</span>
      <span className={c.ok ? 'text-slate-300' : c.warn ? 'text-amber-200/80' : 'text-slate-400'}>{c.label}</span>
      {!c.ok && <span className="text-[10px] text-slate-400 ml-auto shrink-0 pl-2">{c.fix} →</span>}
    </button>
  )

  return (
    <div className="space-y-4">

      {/* 1 · Launch command center */}
      <SafeCard name="Launch status">{() => (
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 overflow-hidden relative space-y-4">
        <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: '#00B894' }} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: (app.color || '#6C5CE7') + '33' }}>
            <AppEmojiWithType app={app} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest font-bold text-[#00B894]">Launch</p>
            <p className="text-white font-semibold text-sm truncate">{app.name}</p>
            <p className="text-[10px] text-slate-500 truncate">{getAppTypeLabel(app)} · {app.ai_provider === 'openai' ? '🟢' : app.ai_provider === 'gemini' ? '🔵' : '🟣'} {app.ai_model || 'default'}</p>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <button onClick={() => onMovePhase?.(app.id, 'test')}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/18 text-amber-300 border border-amber-500/20 transition-colors">← Test</button>
            <button onClick={() => onMovePhase?.(app.id, 'design')}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/8 text-slate-300 border border-white/10 transition-colors">Design</button>
            <button onClick={downloadPdf} disabled={exporting} title="Download the deploy status as a PDF"
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/8 text-slate-300 border border-white/10 transition-colors disabled:opacity-40">
              {exporting ? '…' : '⬇ PDF'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {steps.map(st => (
            <div key={st.label} className="rounded-xl bg-[#0E1424] border border-white/8 px-3 py-2 min-w-0">
              <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">{st.label}</p>
              <p className={`text-xs font-semibold mt-0.5 truncate ${!release && st.label !== 'Live version' ? 'text-slate-500' : st.ok ? 'text-green-300' : 'text-amber-300'}`}>{st.value}</p>
            </div>
          ))}
        </div>

        {releaseError && !release ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-red-300">Couldn't check this app: {releaseError}</span>
            <button onClick={loadRelease} className="text-[10px] text-slate-400 hover:text-white shrink-0">Retry</button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className={`text-sm font-semibold ${!release ? 'text-slate-500' : fixCount ? 'text-amber-200' : 'text-green-300'}`}>{headline}</p>
            {changesRequested && release.review_notes && <p className="text-xs text-amber-200">Review notes: {release.review_notes}</p>}
            {fixCount > 0 && <div className="space-y-0.5">{blockers.map(checkRow)}</div>}
          </div>
        )}

        <button onClick={action.onClick} disabled={action.disabled || publishing}
          className={`w-full text-sm font-semibold py-2.5 rounded-xl transition-all border disabled:opacity-60 ${action.disabled ? btnIdle : action.soft ? 'bg-amber-500/10 hover:bg-amber-500/18 text-amber-200 border-amber-500/25' : btnPrimary}`}>
          {publishing && !live ? 'Publishing…' : action.label}
        </button>
      </div>
      )}</SafeCard>

      {/* 4 · Success right after going live; a slim link row after that */}
      {live && justLive && (
        <div className="bg-emerald-500/8 border border-emerald-500/25 rounded-2xl p-5 space-y-3 relative">
          <button onClick={() => setJustLive(null)} aria-label="Dismiss" className="absolute top-3 right-3 text-slate-500 hover:text-white text-lg leading-none px-1">×</button>
          <div>
            <p className="text-emerald-300 text-base font-bold">🎉 Your app is {justLive.again ? 'live again' : 'live'}{justLive.version ? ` · v${justLive.version}` : ''}</p>
            <p className="text-slate-400 text-xs mt-1">People with access can use it now. Share it or put it on your website.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <a href={liveUrl} target="_blank" rel="noopener noreferrer"
              className={`text-center text-sm font-semibold py-2.5 rounded-xl border transition-all ${btnPrimary}`}>Open app ↗</a>
            <button onClick={() => copy(liveUrl, 'App link')}
              className="text-sm font-semibold py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-colors">📋 Copy link</button>
            <button onClick={() => embedRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="text-sm font-semibold py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-colors">⬡ Embed on website</button>
          </div>
        </div>
      )}
      {live && !justLive && (
        <div className="bg-[#171B33] border border-white/5 rounded-2xl px-4 py-3 flex items-center gap-3 min-w-0">
          <span className="text-green-400 text-xs shrink-0">● Live</span>
          <code className="flex-1 text-[11px] text-slate-300 truncate">{liveUrl}</code>
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-400 hover:text-white shrink-0">Open ↗</a>
          <button aria-label="Copy app link" onClick={() => copy(liveUrl, 'App link')} className="text-slate-500 hover:text-white transition-colors text-xs shrink-0">📋</button>
        </div>
      )}

      {/* Publish */}
      <DeployCard cardRef={publishRef} icon="🚀" title="Publish" subtitle="Everything the server checks before this draft can go live.">{() => (<>
        {!release ? (
          <p className="text-xs text-slate-500">{releaseError ? 'Checklist unavailable.' : 'Checking this draft…'}</p>
        ) : (
          <div className="space-y-1">
            {checklist.map(checkRow)}
            {keyWarning && checkRow(keyWarning)}
          </div>
        )}
        <div className="space-y-1 pt-1">
          <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Description</label>
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="Explain what this app does, who it helps, and what result it produces."
            className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] text-slate-500">Shown on the app page, marketplace cards and install screens.</p>
            <button onClick={async () => { await saveDescription(); loadRelease() }} disabled={savingDescription || description.trim() === (app.description || '').trim()}
              className={`${btnSoft} shrink-0`}>
              {savingDescription ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {live && (
          <button onClick={togglePublish} disabled={publishing}
            className="w-full text-xs py-2 rounded-xl bg-white/4 hover:bg-white/8 text-slate-400 border border-white/8 transition-colors disabled:opacity-40">
            {publishing ? 'Unpublishing…' : '⏸ Unpublish (set to draft)'}
          </button>
        )}
      </>)}</DeployCard>

      {/* Health after launch */}
      <DeployCard icon="📈" title="Health after launch"
        subtitle="Everyone who used the live app: signed-in users, website visitors and API calls. Your own draft and test runs aren't counted.">{() => (<>
        {!runStats ? (
          <p className="text-xs text-slate-500">No run data yet.</p>
        ) : runStats.total === 0 ? (
          <p className="text-[11px] text-slate-500">{live ? 'No runs yet — share the app link to get your first run.' : 'Runs show up here once the app is live.'}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Total runs', value: runStats.total.toLocaleString(), sub: [runStats.users ? `${runStats.users} signed-in ${runStats.users === 1 ? 'person' : 'people'}` : null,
                  runStats.visitorRuns ? `${runStats.visitorRuns} by visitors` : null, runStats.apiRuns ? `${runStats.apiRuns} via API` : null].filter(Boolean).join(' · ') || null, color: '#A29BFE' },
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
              <p className="text-[10px] text-slate-600">Last run: {runStats.lastRun.toLocaleDateString()} {runStats.lastRun.toLocaleTimeString()}</p>
            )}
          </>
        )}
      </>)}</DeployCard>

      {/* 5 · What users will see */}
      <SafeCard name="What users will see"><LivePreviewCard appId={app.id} hasChanges={hasChanges} liveUrl={liveUrl}
        isPublished={app.is_published} liveVersion={app.live_version} promotedAt={app.promoted_at} /></SafeCard>

      {/* Share */}
      <DeployCard icon="🔗" title="Share" subtitle={live ? 'Send people straight to the app.' : 'The link works once the app is published.'}>{() => (<>
        <div className="flex items-center gap-2 bg-[#0E1424] rounded-lg px-3 py-2 min-w-0">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] text-slate-500 uppercase">App page{!live && inactiveTag}</p>
            <code className={`text-[10px] truncate block ${live ? 'text-slate-300' : 'text-slate-600'}`}>{liveUrl}</code>
          </div>
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-slate-500 hover:text-white shrink-0">↗</a>
          <button aria-label="Copy app link" onClick={() => copy(liveUrl, 'App link')} className="text-slate-500 hover:text-white transition-colors text-xs shrink-0">📋</button>
        </div>
      </>)}</DeployCard>

      {/* Embed */}
      <DeployCard cardRef={embedRef} icon="⬡" title="Embed" subtitle="Put the app on your own website.">{() => (<>
        <div className="flex gap-1 bg-[#0E1424] p-0.5 rounded-lg w-fit">
          {['iframe', 'js'].map(t => (
            <button key={t} onClick={() => setEmbedTab(t)}
              className={`text-[10px] font-semibold px-3 py-1 rounded-md transition-all ${embedTab === t ? 'bg-[#6C5CE7] text-white' : 'text-slate-500 hover:text-white'}`}>
              {t === 'iframe' ? 'iFrame' : 'JavaScript'}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre className="text-[11px] text-slate-300 bg-[#0E1424] rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap">{embedCodes[embedTab] || embedCodes.iframe}</pre>
          <button onClick={() => copy(embedCodes[embedTab] || embedCodes.iframe, 'Embed code')}
            className="absolute top-2 right-2 text-[10px] text-slate-500 hover:text-white bg-white/5 px-2 py-1 rounded-md transition-colors">
            📋 Copy
          </button>
        </div>
        <div className="space-y-2">
          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Who can use the widget</p>
          <label className="text-[10px] text-slate-500 block">Allowed websites (one per line)</label>
          <textarea rows={3} value={domainsText} onChange={e => setDomainsText(e.target.value)}
            placeholder={'example.com\nshop.example.com'}
            className="w-full bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 font-mono resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors" />
          <p className="text-[10px] text-slate-600">Empty = any site can embed it for signed-in users. To let visitors use it without an account, list the sites. A domain also covers its subdomains.</p>
          <label className={`flex items-start gap-2 ${app.is_paid ? 'opacity-50' : 'cursor-pointer'}`}>
            <input type="checkbox" className="mt-0.5" disabled={app.is_paid}
              checked={visitorAccess && !app.is_paid} onChange={e => setVisitorAccess(e.target.checked)} />
            <span className="text-xs text-slate-400">
              Let website visitors use it without an Aistrix account
              <span className="block text-[10px] text-slate-600 mt-0.5">
                {app.is_paid
                  ? 'Not available for paid apps.'
                  : 'Requires allowed websites. Runs are rate-limited per visitor and use your saved API key when you have one. Otherwise visitors must sign in.'}
              </span>
            </span>
          </label>
          <div className="flex justify-end">
            <button onClick={saveAccess} disabled={savingAccess} className={btnSoft}>
              {savingAccess ? 'Saving…' : 'Save access settings'}
            </button>
          </div>
        </div>
      </>)}</DeployCard>

      {/* API / Trigger */}
      <DeployCard icon="🔌" title="API & trigger" subtitle="Run the live app from code, Zapier or Make. API keys and code samples are further down.">{() => (<>
        <div className="flex items-center gap-2 bg-[#0E1424] rounded-lg px-3 py-2 min-w-0">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] text-slate-500 uppercase">API endpoint{!live && inactiveTag}</p>
            <code className={`text-[10px] truncate block ${live ? 'text-slate-300' : 'text-slate-600'}`}>{`${PUBLIC_API_URL}/v1/apps/${app.id}/run`}</code>
          </div>
          <button aria-label="Copy API endpoint" onClick={() => copy(`${PUBLIC_API_URL}/v1/apps/${app.id}/run`, 'API endpoint')} className="text-slate-500 hover:text-white transition-colors text-xs shrink-0">📋</button>
        </div>
        <div className="bg-[#0E1424] rounded-lg px-3 py-2 min-w-0">
          <p className="text-[9px] text-slate-500 uppercase">Inbound trigger{trigger && !live && inactiveTag}</p>
          {trigger ? (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <code className={`flex-1 text-[10px] truncate block ${live ? 'text-slate-300' : 'text-slate-600'}`}>{`${PUBLIC_API_URL}/webhooks/${trigger}`}</code>
                <button aria-label="Copy trigger link" onClick={() => copy(`${PUBLIC_API_URL}/webhooks/${trigger}`, 'Trigger link')} className="text-slate-500 hover:text-white transition-colors text-xs shrink-0">📋</button>
              </div>
              <p className="text-[9px] text-slate-600 mt-0.5">POST {'{"input":"..."}'} to run the live version. Keep it secret: anyone with the link can run the app on your key.</p>
              <div className="flex gap-3 mt-1.5">
                <button onClick={() => setConfirmTrigger('replace')} disabled={triggerBusy} className="text-[10px] text-slate-400 hover:text-white disabled:opacity-40 transition-colors">↻ Replace link</button>
                <button onClick={() => setConfirmTrigger('off')} disabled={triggerBusy} className="text-[10px] text-slate-400 hover:text-red-300 disabled:opacity-40 transition-colors">Turn off</button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] text-slate-600">Let Zapier, Make or your server run the live version with a POST. Runs use your key and limits.</p>
              <button onClick={makeTrigger} disabled={triggerBusy || trigger === undefined}
                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors disabled:opacity-40 shrink-0">
                {triggerBusy ? 'Creating…' : 'Create link'}
              </button>
            </div>
          )}
        </div>
      </>)}</DeployCard>

      {/* Webhook */}
      <DeployCard icon="🔔" title="Webhook" subtitle="Aistrix POSTs the result to your URL after every successful run. Useful for Zapier, Make, or your own backend.">{() => (<>
        <div className="flex gap-2">
          <input
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://your-server.com/webhook"
            className="flex-1 min-w-0 bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
          />
          <button onClick={saveWebhook} disabled={savingWebhook} className={`${btnSoft} shrink-0`}>
            {savingWebhook ? '…' : 'Save'}
          </button>
          {app.webhook_url && (
            <button onClick={testWebhook} disabled={testingWebhook || webhookUrl.trim() !== app.webhook_url}
              title={webhookUrl.trim() !== app.webhook_url ? 'Save the URL first' : 'Send a signed sample payload'}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-white/4 hover:bg-white/8 text-slate-300 border border-white/8 transition-colors disabled:opacity-40 shrink-0">
              {testingWebhook ? 'Sending…' : 'Send test'}
            </button>
          )}
        </div>
        {app.webhook_url && (
          <div className="bg-[#0E1424] rounded-lg px-3 py-2">
            <p className="text-[9px] text-slate-500 uppercase font-semibold mb-1">Payload sent on each run</p>
            <pre className="text-[10px] text-slate-300 leading-relaxed">{`{
  "event": "run.completed",
  "app_id": "${app.id}",
  "input": "<user input>",
  "result": "<AI output>",
  "provider": "<AI provider>",
  "model": "<model>",
  "timestamp": "<ISO 8601>"
}`}</pre>
            <p className="text-[9px] text-slate-500 uppercase font-semibold mt-3 mb-1">Signature</p>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Each request has an <code className="text-slate-300">X-Aistrix-Signature: t=…,v1=…</code> header. To check it came from Aistrix,
              compute HMAC-SHA256 of <code className="text-slate-300">{'"<t>.<raw body>"'}</code> with your signing secret and compare it to <code className="text-slate-300">v1</code>.
              A test send has <code className="text-slate-300">"event": "test"</code>.
            </p>
            <div className="flex items-center gap-2 mt-2 min-w-0">
              <code className="flex-1 text-[10px] text-slate-300 truncate">{webhookSecret || 'whsec_••••••••••••••••'}</code>
              {webhookSecret
                ? <button aria-label="Copy signing secret" onClick={() => copy(webhookSecret, 'Signing secret')} className="text-slate-500 hover:text-white transition-colors text-xs shrink-0">📋</button>
                : <button onClick={showWebhookSecret} className="text-[10px] text-slate-400 hover:text-white transition-colors shrink-0">Show secret</button>}
            </div>
          </div>
        )}
      </>)}</DeployCard>

      {/* Limits & access */}
      <DeployCard icon="👥" title="Limits & access" subtitle="Who can use the app, who pays for the AI, and how much it can run.">{() => (<>
        <div className="space-y-1.5">
          {accessRows.map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-3 text-[11px]">
              <span className="text-slate-500 shrink-0">{label}</span>
              <span className="text-slate-300 text-right">{value}</span>
            </div>
          ))}
        </div>

        <div className="space-y-2 pt-2 border-t border-white/5">
          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Daily run limit</p>
          <p className="text-[11px] text-slate-400">
            Across all users, API calls and website visitors (resets at midnight UTC). Your own test runs don't count. Leave blank for unlimited.
          </p>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              value={maxRuns}
              onChange={e => setMaxRuns(e.target.value)}
              placeholder="e.g. 500 (unlimited if blank)"
              min="1"
              className="flex-1 min-w-0 bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            />
            <button onClick={saveQuota} disabled={savingQuota} className={`${btnSoft} shrink-0`}>
              {savingQuota ? '…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-white/5">
          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Required context (user profiles)</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Aistrix asks the user to fill in their profile before running the app, and adds it to the AI context.
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
      </>)}</DeployCard>

      {confirmTrigger && (
        <ConfirmDialog
          title={confirmTrigger === 'replace' ? 'Replace the trigger link?' : 'Turn off the trigger link?'}
          subtitle={`${app.emoji || ''} ${app.name}`.trim()}
          confirmLabel={confirmTrigger === 'replace' ? 'Replace link' : 'Turn off'}
          busyLabel={confirmTrigger === 'replace' ? 'Replacing…' : 'Turning off…'}
          danger={confirmTrigger === 'off'}
          onCancel={() => setConfirmTrigger(null)}
          onConfirm={confirmTrigger === 'replace' ? makeTrigger : removeTrigger}>
          {confirmTrigger === 'replace'
            ? 'The current link stops working right away. Update Zapier, Make or your server with the new link.'
            : 'Anything using the link (Zapier, Make, your server) gets an error from now on. You can create a new link later.'}
        </ConfirmDialog>
      )}

      {showPromote && (
        <PromoteModal
          app={app}
          user={user}
          onClose={() => setShowPromote(false)}
          onPromoted={updated => { setApp(updated); onUpdate?.(updated); loadRelease(); setJustLive({ version: updated.live_version || null }) }}
        />
      )}
    </div>
  )
}

function SdkSnippets({ app }) {
  const [lang, setLang] = useState('curl')
  const [copied, setCopied] = useState(null)
  const appId = app.id

  function cp(text, key) {
    navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500) })
  }

  const snippets = {
    curl: {
      label: 'cURL',
      code: `curl -X POST ${PUBLIC_API_URL}/v1/apps/${appId}/run \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Your input here"}'`,
    },
    python: {
      label: 'Python',
      code: `import requests

response = requests.post(
    "${PUBLIC_API_URL}/v1/apps/${appId}/run",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"input": "Your input here"}
)
print(response.json()["output"])`,
    },
    node: {
      label: 'Node.js',
      code: `const res = await fetch("${PUBLIC_API_URL}/v1/apps/${appId}/run", {
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
      code: `# Create the trigger link in Deploy → Share links, then POST to it.
# No API key needed: the link itself is the secret. Runs the live version.

curl -X POST ${PUBLIC_API_URL}/webhooks/YOUR_TRIGGER_TOKEN \\
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

export function DeployTab({ apps, user, onAppUpdated, onFixInDesign, selectedAppId, onMovePhase, onOpenKeys, onMonitor }) {
  const activeAppId = apps.some(a => a.id === selectedAppId) ? selectedAppId : apps[0]?.id ?? null
  const selectedApp = apps.find(a => a.id === activeAppId)

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Create an app in the Design tab to start deploying.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      {selectedApp?.is_published && onMonitor && <div className="rounded-2xl border border-emerald-500/20 bg-[#171B33] p-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-300 flex-1">After publishing, collect feedback and turn weak answers into regression tests.</p>
        <button className="rounded-xl bg-[#6C5CE7] px-4 py-2 text-xs font-semibold text-white" onClick={() => onMonitor(selectedApp.id)}>Monitor this app →</button>
      </div>}
      {/* Selected app deploy card */}
      {selectedApp && (
        <AppDeployCard
          key={selectedApp.id}
          app={selectedApp}
          onUpdate={onAppUpdated}
          onFixInDesign={onFixInDesign}
          onMovePhase={onMovePhase}
          onOpenKeys={onOpenKeys}
          user={user}
        />
      )}

      {selectedApp && (selectedApp.is_published || selectedApp.live_version) && (
        <SafeCard name="Published versions" resetKey={selectedApp.id}>
          <PublishedVersions key={`versions-${selectedApp.id}-${selectedApp.live_version ?? ''}`} app={selectedApp} onAppUpdated={onAppUpdated} />
        </SafeCard>
      )}

      {/* API Keys */}
      <SafeCard name="API keys"><ApiKeySection user={user} /></SafeCard>

      {/* SDK / Integration snippets */}
      {selectedApp && <SafeCard name="Integration snippets" resetKey={selectedApp.id}><SdkSnippets app={selectedApp} /></SafeCard>}
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
