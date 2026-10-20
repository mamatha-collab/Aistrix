// Settings sections for the account itself: the developer's tier (limits and
// usage), developer alert emails, and the account's data (export, delete).
import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { downloadManageFile, manageRequest } from '../lib/manageApi'
import { useToast } from '../hooks/useToast'
import ConfirmDialog from './ConfirmDialog'

const button = 'bg-[#1F2444] hover:bg-[#272C52] border border-white/10 text-slate-300 text-sm px-4 py-2 rounded-xl transition-colors disabled:opacity-40'
// [limit key, label, usage key (null: no usage count)]
const LIMIT_ROWS = [
  ['draft_apps', 'Draft apps', 'draft_apps'],
  ['published_apps', 'Published apps', 'published_apps'],
  ['tests_per_day', 'Test runs today', 'tests_today'],
  ['concurrent_tests', 'Test runs at a time', null],
]

export function DeveloperPlan() {
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { manageRequest('/v1/developer/plan').then(setPlan).catch(e => setError(e.message)) }, [])
  if (error) return <p role="alert" className="text-sm text-amber-200">Your plan couldn&apos;t be loaded: {error}</p>
  if (!plan) return <p role="status" className="text-sm text-slate-400">Loading your plan…</p>
  const verified = plan.all_limits?.verified
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-white font-medium">{plan.label}</p>
      <span className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded-full">$0</span>
    </div>
    {plan.limits ? <div className="divide-y divide-white/5 text-sm">
      {LIMIT_ROWS.map(([key, label, usageKey]) => <div key={key} className="flex justify-between gap-3 py-2">
        <span className="text-slate-400">{label}</span>
        <span className="text-white">{usageKey ? `${plan.usage[usageKey]} of ${plan.limits[key]}` : plan.limits[key]}</span>
      </div>)}
      <div className="flex justify-between gap-3 py-2">
        <span className="text-slate-400">Usage analytics</span>
        <span className="text-white">{plan.limits.analytics === 'standard' ? 'Standard' : 'Basic'}</span>
      </div>
    </div> : <p className="text-sm text-slate-400">No limits on apps or test runs.</p>}
    <p className="text-xs text-slate-500 leading-relaxed">
      AI usage runs on your own keys (API Keys).
      {plan.tier === 'staff' ? ' Your apps go live without review.' : " An app's first release is reviewed by the Aistrix team; later releases go live straight away."}
      {plan.tier === 'free' && verified ? ` Verified developers get ${verified.draft_apps} drafts, ${verified.published_apps} published apps, ${verified.tests_per_day} test runs a day and Standard analytics.` : ''}
    </p>
  </div>
}

export function DeveloperEmailAlerts({ user }) {
  const toast = useToast()
  const [on, setOn] = useState(null)
  useEffect(() => {
    supabase.from('developer_profiles').select('email_alerts').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => setOn(error ? null : data?.email_alerts !== false))
  }, [user.id])

  async function toggle() {
    const next = !on
    setOn(next)
    const { error } = await supabase.from('developer_profiles').upsert({ user_id: user.id, email_alerts: next }, { onConflict: 'user_id' })
    if (error) { setOn(!next); toast(error.message, 'error'); return }
    toast(next ? 'Alert emails on' : 'Alert emails off', 'success', 2000)
  }

  return <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-white/5">
    <div>
      <p className="text-sm text-white">Developer alert emails</p>
      <p className="text-xs text-slate-400 mt-0.5">Refunds, chargebacks, failed payouts, new customer feedback, review decisions and Monitor alerts.</p>
    </div>
    <button role="switch" aria-checked={!!on} aria-label="Developer alert emails" disabled={on === null} onClick={toggle}
      className={`text-xs px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 ${on ? 'text-green-400 bg-green-400/10' : 'text-slate-400 bg-white/5'}`}>
      {on === null ? '…' : on ? '✓ On' : 'Off'}
    </button>
  </div>
}

const CONFIRM_TEXT = 'delete my account'

export function AccountData() {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [check, setCheck] = useState(null)       // { can_delete, blockers }
  const [typed, setTyped] = useState('')

  async function exportData() {
    setBusy('export')
    try { await downloadManageFile('/v1/account/export', 'aistrix-account.json') }
    catch (e) { toast(e.message, 'error') }
    finally { setBusy('') }
  }

  async function startDelete() {
    setBusy('check')
    try { setCheck(await manageRequest('/v1/account/deletion-check')); setTyped('') }
    catch (e) { toast(e.message, 'error') }
    finally { setBusy('') }
  }

  async function deleteAccount() {
    try {
      await manageRequest('/v1/account/delete', { method: 'POST', body: JSON.stringify({ confirm: typed }) })
    } catch (e) { toast(e.message, 'error', 8000); return }
    await supabase.auth.signOut()
    window.location.assign('/')
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={!!busy} onClick={exportData}>{busy === 'export' ? 'Preparing…' : 'Download my data'}</button>
      <button className={`${button} !text-red-300`} disabled={!!busy} onClick={startDelete}>{busy === 'check' ? 'Checking…' : 'Delete account'}</button>
    </div>
    <p className="text-xs text-slate-500">The download has everything your account owns (never secret values or keys).</p>
    {check && !check.can_delete && <div role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-200 space-y-1">
      <p className="font-semibold">Before your account can be deleted:</p>
      <ul className="list-disc pl-4 space-y-0.5">{check.blockers.map(b => <li key={b}>{b}</li>)}</ul>
    </div>}
    {check?.can_delete && <ConfirmDialog title="Delete your account?" danger confirmLabel="Delete account" busyLabel="Deleting…"
      confirmDisabled={typed.trim().toLowerCase() !== CONFIRM_TEXT} onCancel={() => setCheck(null)} onConfirm={deleteAccount}>
      Your apps, runs, files, keys and settings are deleted for good. Sales records stay (without your name) for accounting.
      <label className="block mt-3 text-slate-400">Type <strong className="text-white">{CONFIRM_TEXT}</strong> to confirm
        <input aria-label="Type delete my account to confirm" value={typed} onChange={e => setTyped(e.target.value)}
          className="mt-1.5 w-full bg-[#0F1225] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-400" />
      </label>
    </ConfirmDialog>}
  </div>
}
