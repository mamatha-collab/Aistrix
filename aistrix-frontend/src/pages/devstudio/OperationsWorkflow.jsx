import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { regressionId, saveRunRegression } from '../../lib/operationsLoop'
import { FEEDBACK_STATUSES, getAppFeedback, statusLabel, updateFeedback } from '../../lib/feedback'
import { useToast } from '../../hooks/useToast'

const button = 'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-40'
const field = 'w-full rounded-xl border border-white/10 bg-[#0E1424] px-3 py-2 text-sm text-white'
const STATUS_STYLE = {
  new: 'bg-amber-500/10 text-amber-300', investigating: 'bg-[#6C5CE7]/15 text-[#A29BFE]', fixed: 'bg-sky-500/10 text-sky-300',
  verified: 'bg-emerald-500/10 text-emerald-300', dismissed: 'bg-white/5 text-slate-400',
}

// Evaluate → Improve: customer feedback for the app (shared by customers when
// they rate a run), turned into a regression test and a draft fix, then
// validated in Test before publishing. Triage status is saved per item.
export default function OperationsWorkflow({ stage, apps, user, selectedAppId, onSelectApp, selectedRunId, onSelectRun, onNavigate, onFix }) {
  const toast = useToast()
  const app = apps.find(a => a.id === selectedAppId) || apps[0]
  const appId = app?.id
  const [filter, setFilter] = useState('open')
  const [inbox, setInbox] = useState({ loading: true, error: '', items: [], counts: {} })
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [input, setInput] = useState('')
  const [expectation, setExpectation] = useState('')
  const [type, setType] = useState('must-contain')
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [reading, setReading] = useState(false)
  const [caseError, setCaseError] = useState('')
  const [retry, setRetry] = useState(0)
  const [statusBusy, setStatusBusy] = useState(false)
  const currentKey = useRef('')

  const reload = useCallback(() => setReloadKey(n => n + 1), [])
  useEffect(() => {
    if (!appId) return undefined
    let active = true
    setInbox(s => ({ ...s, loading: true, error: '' }))
    getAppFeedback(appId, filter)
      .then(data => { if (active) setInbox({ loading: false, error: '', items: data.items || [], counts: data.counts || {} }) })
      .catch(e => { if (active) setInbox({ loading: false, error: e.message || 'Feedback could not be loaded.', items: [], counts: {} }) })
    return () => { active = false }
  }, [appId, filter, reloadKey])

  const items = inbox.items
  const item = items.find(i => i.id === selectedId) || items.find(i => i.run_id === selectedRunId) || items[0] || null
  const itemId = item?.id
  const runId = item?.run_id
  const sharedInput = item?.shared_input || ''
  currentKey.current = `${appId}:${itemId}`

  useEffect(() => {
    let active = true
    setInput(sharedInput)
    setExpectation('')
    setSaved(null)
    setCaseError('')
    setSaving(false)
    if (!appId || !runId) { setReading(false); return }
    setReading(true)
    regressionId(appId, runId, user.id).then(id => supabase.from('app_test_cases').select('*').eq('id', id).eq('app_id', appId).eq('user_id', user.id).maybeSingle())
      .then(({ data, error: readError }) => {
        if (!active) return
        if (readError) setCaseError(readError.message)
        else if (data) { setSaved(data); setInput(data.input); setExpectation(data.rules?.[0]?.value || ''); setType(data.rules?.[0]?.type || 'must-contain') }
      }).catch(e => { if (active) setCaseError(e.message) })
      .finally(() => { if (active) setReading(false) })
    return () => { active = false }
  }, [appId, runId, sharedInput, user.id, retry])

  function patchLocal(id, patch) {
    setInbox(s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, ...patch } : i) }))
  }

  async function setStatus(next) {
    if (!item || next === item.status) return
    setStatusBusy(true)
    try {
      await updateFeedback(item.id, { status: next })
      patchLocal(item.id, { status: next })
      toast(`Marked ${statusLabel(next).toLowerCase()}`, 'success', 2000)
    } catch (e) { toast(`Could not update the status: ${e.message}`, 'error') }
    finally { setStatusBusy(false) }
  }

  async function save() {
    const key = currentKey.current
    setSaving(true)
    try {
      const result = await saveRunRegression(supabase, { appId: app.id, userId: user.id, run: { id: item.run_id, app_id: app.id }, input, type, expectation })
      if (currentKey.current === key) setSaved(result.testCase)
      // Link the test to the feedback and move it on (never to "fixed": a saved test isn't a fix).
      const patch = { test_case_id: result.testCase.id, ...(item.status === 'new' ? { status: 'investigating' } : {}) }
      updateFeedback(item.id, patch).then(() => patchLocal(item.id, patch))
        .catch(e => toast(`Test saved, but the feedback status wasn't updated: ${e.message}`, 'error'))
      toast(result.existing ? 'This feedback already has a regression test. Edit it in Test.' : 'Regression test saved. Run it against your draft in Test.', 'success')
    } catch (e) { toast(`Could not save regression test: ${e.message}`, 'error') }
    finally { if (currentKey.current === key) setSaving(false) }
  }

  if (!app) return null
  const openCount = (inbox.counts.new || 0) + (inbox.counts.investigating || 0)
  return <section aria-label="Operate and Grow workflow" className="rounded-2xl border border-[#6C5CE7]/25 bg-[#171B33] p-4 sm:p-5 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-white text-base font-semibold">Keep improving your app</h2>
        <p className="text-slate-400 text-xs mt-1">Review customer feedback, capture a regression test, and validate a draft before publishing.</p></div>
      <button className={button} disabled={inbox.loading} onClick={reload}>{inbox.loading ? 'Refreshing…' : 'Refresh feedback'}</button>
    </div>
    <label className="block text-xs text-slate-400">App to operate
      <select aria-label="App to operate" className={`${field} mt-1`} value={app.id} onChange={e => { onSelectApp(e.target.value); onSelectRun?.(null); setSelectedId(null) }}>
        {apps.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_published ? ' · Live' : ' · Not published'}</option>)}
      </select>
    </label>
    {['evaluate', 'improve'].includes(stage) && <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm text-white font-semibold">Customer feedback{openCount ? ` · ${openCount} open` : ''}</h3>
        <label className="text-xs text-slate-400 flex items-center gap-2">Show
          <select aria-label="Feedback to show" className={`${field} !w-auto !py-1.5`} value={filter} onChange={e => { setFilter(e.target.value); setSelectedId(null) }}>
            <option value="open">Open (new, investigating)</option>
            <option value="all">All</option>
            {FEEDBACK_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>
      {inbox.error ? <div role="alert" className="text-amber-300 text-sm">{inbox.error} <button className="underline" onClick={reload}>Try again</button></div>
        : inbox.loading && !items.length ? <p role="status" className="text-xs text-slate-400">Loading feedback…</p>
        : !items.length ? <p className="text-xs text-slate-400">{filter === 'open'
          ? (app.is_published ? 'No open feedback. When customers mark an answer "not useful", it appears here.' : 'Publish this app through Build to start collecting customer feedback.')
          : 'No feedback with this status.'}</p>
        : <div className="space-y-2" aria-label="Feedback list">
          {items.slice(0, 20).map(i => <button key={i.id} onClick={() => { setSelectedId(i.id); onSelectRun?.(i.run_id) }} aria-pressed={item?.id === i.id}
            className={`w-full flex gap-3 items-center rounded-xl border p-3 text-left ${item?.id === i.id ? 'border-[#6C5CE7]/50 bg-[#6C5CE7]/10' : 'border-white/5 hover:bg-white/5'}`}>
            <span aria-label={i.rating === -1 ? 'Not useful' : 'Useful'}>{i.rating === -1 ? '👎' : '👍'}</span>
            <span className="flex-1 min-w-0 truncate text-xs text-slate-300">{i.comment || i.shared_input || 'Marked not useful (no comment)'}</span>
            <span className="text-[10px] text-slate-500 shrink-0">{new Date(i.created_at).toLocaleDateString()}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[i.status] || STATUS_STYLE.new}`}>{statusLabel(i.status)}</span>
          </button>)}
        </div>}

      {item && <div className="space-y-3 border-t border-white/5 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-0 text-sm text-white">{item.comment ? `“${item.comment}”` : 'No comment left.'}</p>
          <label className="text-xs text-slate-400 flex items-center gap-2">Status
            <select aria-label="Feedback status" disabled={statusBusy} className={`${field} !w-auto !py-1.5`} value={item.status} onChange={e => setStatus(e.target.value)}>
              {FEEDBACK_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </div>
        {item.shared_input || item.shared_output ? <div className="grid sm:grid-cols-2 gap-3">
          {[['Customer question', item.shared_input], ['Answer they got', item.shared_output]].map(([label, value]) => <details key={label} className="rounded-xl bg-[#0E1424] p-3 text-xs text-slate-300"><summary className="cursor-pointer font-semibold">{label}</summary><pre className="mt-2 whitespace-pre-wrap max-h-56 overflow-auto font-sans">{value || 'Not shared'}</pre></details>)}
        </div> : <p className="text-xs text-slate-400">The customer didn't share their question or the answer. Write a test input that reproduces the problem.</p>}
        {caseError && <p role="alert" className="text-xs text-amber-300">Could not check saved regression tests: {caseError}. <button className="underline" onClick={() => setRetry(n => n + 1)}>Retry coverage check</button></p>}
        {reading ? <p role="status" className="text-xs text-slate-400">Checking regression coverage…</p> : saved ? <div role="status" className="text-sm text-emerald-300">Regression test saved. Run and edit it in Build → Test; saving a case does not mean the app has passed.</div> : <div className="space-y-3">
          <label className="block text-xs text-slate-400">Regression input
            <textarea aria-label="Regression input" rows={3} className={`${field} mt-1`} value={input} onChange={e => setInput(e.target.value)} />
          </label>
          <p className="text-xs text-slate-400">Review this input before saving it to your test suite. Define the corrected behavior; the observed answer is not used as the expected answer.</p>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Regression check" className={`${field} sm:!w-auto`} value={type} onChange={e => setType(e.target.value)}><option value="must-contain">Answer must contain</option><option value="must-not-contain">Answer must not contain</option></select>
            <input aria-label="Expected behavior" placeholder="Required phrase or forbidden claim" className={`${field} flex-1`} value={expectation} onChange={e => setExpectation(e.target.value)} />
          </div>
          <button className={`${button} !bg-[#6C5CE7]`} disabled={saving || reading || !!caseError || !expectation.trim() || !input.trim()} onClick={save}>{saving ? 'Saving regression…' : 'Save regression test'}</button>
        </div>}
      </div>}
      <div className="flex flex-wrap gap-2">
        {stage === 'evaluate' && <button className={button} onClick={() => onNavigate('improve', app.id)}>Continue to Improve</button>}
        <button className={button} onClick={() => onFix(app.id, item ? { id: item.run_id, feedback_text: item.comment } : null, saved)}>Open draft fix in Design</button>
        <button className={button} onClick={() => onNavigate('test', app.id)}>Validate in Test</button>
      </div>
      <p className="text-xs text-slate-400">{app.is_published ? `Live ${app.live_version ? `v${app.live_version}` : 'version'} stays available while you edit. ` : ''}Design → Test → Publish → Monitor closes the loop. Mark feedback verified once the fix is live and Monitor looks healthy.</p>
    </>}
    {stage === 'sell' && <div className="text-sm text-slate-300 space-y-2"><p>Marketplace is optional. Publish, collect feedback, and fix quality issues before listing.</p><div className="flex gap-2"><button className={button} onClick={() => onNavigate('monitor', app.id)}>Review app health</button><button className={button} onClick={() => onNavigate('deploy', app.id)}>Review publish readiness</button></div></div>}
  </section>
}
