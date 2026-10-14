import { useState, useEffect, useMemo, Suspense } from 'react'
import { supabase } from '../../supabase'
import { useToast } from '../../hooks/useToast'
import { track, EVENTS } from '../../lib/analytics'
import { timeAgo } from '../../utils'
import ToolsEditor from '../../components/ToolsEditor'
import { VersionSetupCard } from '../../components/VersionManager'
import PublishedVersions from '../../components/PublishedVersions'
import { useVersions } from '../../hooks/useVersions'
import { AppEmojiWithType, ComingSoonCard, DeveloperProfileEditor, DiffEditor, StatTile, modelCost } from './shared'


// ─── Marketplace listing helpers ─────────────────────────────────────────────

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

export function SellTab({ apps, user, onAppUpdated }) {
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

export function MonitorTab({ apps, appStats, loading, totalStats, runs, entitlements, user }) {
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

export function EvaluateTab({ apps, appStats, runs, user }) {
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

export function ImproveTab({ apps, user, runs, selectedAppId }) {
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

export function VersionTab({ apps, user, onAppUpdated, selectedAppId }) {
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

      {appObj && <PublishedVersions app={appObj} onAppUpdated={onAppUpdated} />}

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

function EntitlementsSection({ apps }) {
  const [entitlements, setEntitlements] = useState(null)
  const [needsSetup, setNeedsSetup]     = useState(false)
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

function ConnectPayoutPanel() {
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
    } catch {}
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
    } catch {}
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

export function MonetizeTab({ apps, runs, loading, user }) {
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
              {profitData.map(({ app, appRuns, avgIn, avgOut, costPerRun, pricePerRun, margin, marginPct }) => {
                const hasCost = costPerRun != null
                const isProfit  = hasCost && margin > 0
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

// ─── Secrets Tab ─────────────────────────────────────────────────────────────

export function SecretsTab({ apps, selectedAppId }) {
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
