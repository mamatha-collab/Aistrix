import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { regressionId, saveRunRegression } from '../../lib/operationsLoop'
import { FEEDBACK_STATUSES, getAppFeedback, statusLabel, updateFeedback } from '../../lib/feedback'
import QualityPanel from './QualityPanel'
import ConfirmDialog from '../../components/ConfirmDialog'

import { BRAND } from '../../lib/brand'
const button = 'min-h-10 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-40'
const field = 'w-full min-w-0 rounded-xl border border-white/10 bg-[#0E1424] px-3 py-2 text-sm text-white'
const card = 'rounded-2xl border border-white/8 bg-[#171B33] p-4 sm:p-5'
const STATUS_STYLE = { new: 'text-amber-300', investigating: 'text-[#A29BFE]', fixed: 'text-sky-300', verified: 'text-emerald-300', dismissed: 'text-slate-400' }

// Eval owns triage and regression authoring. Improve receives only the issue
// context and links back here; Build → Test remains the single test runner.
export default function OperationsWorkflow({ stage, apps, user, selectedAppId, onSelectApp, selectedRunId, onSelectRun, onNavigate, onFix }) {
  const app = apps.find(a => a.id === selectedAppId) || apps[0]
  const appId = app?.id
  const [filter, setFilter] = useState('open')
  const [offset, setOffset] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [qualityKey, setQualityKey] = useState(0)
  const drafts = useRef({})
  const [inbox, setInbox] = useState({ key: '', items: [], counts: {}, loading: true, error: '' })
  const key = `${appId}:${filter}:${offset}`
  const currentKey = useRef(key)
  currentKey.current = key

  useEffect(() => { setOffset(0); setSelectedId(null) }, [appId, filter])
  useEffect(() => {
    if (!appId || stage === 'sell') return undefined
    const controller = new AbortController()
    let active = true
    setInbox(s => ({ ...(s.key === key ? s : { key, items: [], counts: {} }), loading: true, error: '' }))
    getAppFeedback(appId, filter, { offset, limit: 20, signal: controller.signal })
      .then(data => { if (active) setInbox({ key, ...data, loading: false, error: '', updatedAt: Date.now() }) })
      .catch(e => { if (active && e.name !== 'AbortError') setInbox(s => ({ ...s, loading: false, error: e.message || 'Feedback could not be loaded.' })) })
    return () => { active = false; controller.abort() }
  }, [appId, filter, offset, reloadKey, key, stage])

  const data = inbox.key === key ? inbox : { items: [], counts: {}, loading: true }
  const items = data.items || []
  const item = items.find(i => i.id === selectedId) || items.find(i => i.run_id === selectedRunId) || items[0]
  const openCount = (data.counts?.new || 0) + (data.counts?.investigating || 0)
  function patchLocal(id, patch) {
    if (currentKey.current !== key) return
    if (patch.test_case_id) setQualityKey(n => n + 1)
    setInbox(s => {
      if (s.key !== key) return s
      const old = s.items.find(i => i.id === id)
      const counts = { ...s.counts }
      if (old && patch.status && old.status !== patch.status) {
        counts[old.status] = Math.max(0, (counts[old.status] || 0) - 1)
        counts[patch.status] = (counts[patch.status] || 0) + 1
      }
      return { ...s, counts, items: s.items.map(i => i.id === id ? { ...i, ...patch } : i) }
    })
  }

  if (!app) return <p className={`${card} text-sm text-slate-400`}>Create an app in Build to start evaluating its quality.</p>
  if (stage === 'sell') return <section aria-label="Operate and Grow workflow" className={`${card} space-y-3`}><p className="text-sm text-slate-300">Marketplace is optional. Publish, collect feedback, and fix quality issues before listing.</p><label className="block text-xs text-slate-400">App to operate<select aria-label="App to operate" className={`${field} mt-1`} value={app.id} onChange={e => onSelectApp(e.target.value)}>{apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><div className="flex flex-wrap gap-2"><button className={button} onClick={() => onNavigate('monitor', app.id)}>Review app health</button><button className={button} onClick={() => onNavigate('deploy', app.id)}>Review publish readiness</button></div></section>
  const improve = stage === 'improve'
  return <section aria-label="Operate and Grow workflow" className="space-y-5 min-w-0">
    <header><h1 className="text-2xl font-semibold text-white">{improve ? 'Issue to improve' : 'Eval'}</h1><p className="text-sm text-slate-400 mt-1">{improve ? 'Use the evaluated issue to guide a draft fix.' : 'Understand customer feedback. Capture a test that proves the expected behavior.'}</p></header>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-slate-400 min-w-0">App to operate<select aria-label="App to operate" className={`${field} block mt-1 max-w-72`} value={app.id} onChange={e => { onSelectApp(e.target.value); onSelectRun?.(null); setSelectedId(null); setOffset(0) }}>{apps.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_published ? '' : ' · Not published'}</option>)}</select></label>
      {!improve && <label className="text-xs text-slate-400 min-w-0">Show<select aria-label="Feedback to show" className={`${field} block mt-1`} value={filter} onChange={e => { setFilter(e.target.value); setSelectedId(null); setOffset(0) }}><option value="open">Open (new, investigating)</option><option value="all">All feedback</option>{FEEDBACK_STATUSES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
      <button className={button} disabled={data.loading} onClick={() => setReloadKey(n => n + 1)}>{data.loading ? 'Refreshing…' : 'Refresh feedback'}</button>
    </div>
    {!improve && <QualityPanel key={appId} app={app} onNavigate={onNavigate} refreshKey={`${reloadKey}:${qualityKey}`} />}
    {data.error && <div role="alert" className={`${card} text-sm text-amber-300`}>{data.error} <button className="underline min-h-10" onClick={() => setReloadKey(n => n + 1)}>Try again</button><p className="text-xs mt-1">Feedback is unavailable. Retry before making changes.</p></div>}
    {data.loading && !items.length && <p role="status" className="text-sm text-slate-400">Loading feedback…</p>}
    {!data.error && !data.loading && !items.length && <div className={`${card} text-sm text-slate-400`}>{filter === 'open' ? (app.is_published ? 'No open feedback. Customer reports will appear here when shared.' : 'Publish this app through Build to start collecting customer feedback.') : 'No feedback with this status.'}</div>}
    {improve && !items.length && <div className="flex flex-wrap gap-2"><button className={button} onClick={() => onNavigate('evaluate', app.id)}>Review evidence in Eval</button><button className={button} onClick={() => onFix(app.id, null, null)}>Open draft fix in Design</button></div>}
    {!data.error && items.length > 0 && <>
      {!improve && <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-white">Customer feedback · {data.counts_truncated ? 'at least ' : ''}{openCount} open</h2><p className="text-xs text-slate-500">{data.updatedAt && `Updated ${new Date(data.updatedAt).toLocaleTimeString()}`} · Customer identity is not included</p></div>}
      {data.counts_truncated && <p role="status" className="text-xs text-amber-300">Status counts cover the first 5,000 reports. Use the pages below to review the full queue.</p>}
      <div className={improve ? '' : 'grid grid-cols-1 xl:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)] gap-4 items-start'}>
        {!improve && <div className={`${card} min-w-0 space-y-3`}>
          <div className="space-y-2 max-h-[560px] overflow-y-auto" aria-label="Feedback list">{items.map(i => <button key={i.id} onClick={() => { setSelectedId(i.id); onSelectRun?.(i.run_id) }} aria-pressed={item?.id === i.id} className={`w-full rounded-xl border p-3 text-left space-y-2 ${item?.id === i.id ? 'border-[#6C5CE7]/50 bg-[#6C5CE7]/10' : 'border-white/5 hover:bg-white/5'}`}><span className="block text-sm text-slate-200 break-words line-clamp-2">{i.comment || i.shared_input || (i.rating === -1 ? 'Answer marked not useful' : 'Answer marked useful')}</span><span className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]"><span className={STATUS_STYLE[i.status]}>{statusLabel(i.status)}</span><span className="text-slate-500">{new Date(i.created_at).toLocaleDateString()}</span></span></button>)}</div>
          <div className="flex flex-wrap gap-2 items-center justify-between border-t border-white/8 pt-3"><button className={button} disabled={offset === 0 || data.loading} onClick={() => { setOffset(n => Math.max(0, n - 20)); setSelectedId(null) }}>Previous</button><span className="text-xs text-slate-500">Page {offset / 20 + 1}</span><button className={button} disabled={data.next_offset == null || data.loading} onClick={() => { setOffset(data.next_offset); setSelectedId(null) }}>Next</button></div>
        </div>}
        {item && <FeedbackDetail key={`${appId}:${item.id}`} item={item} app={app} user={user} improve={improve} patchLocal={patchLocal} onNavigate={onNavigate} onFix={onFix} draft={drafts.current[`${appId}:${item.id}`]} onDraft={value => { drafts.current[`${appId}:${item.id}`] = value }} />}
      </div>
    </>}
    {!improve && <p className="text-xs text-slate-500">Eval records evidence and regression tests. Improve plans a fix; Build → Test runs it. Customer ratings are a signal, not an automated quality score.</p>}
  </section>
}

function FeedbackDetail({ item, app, user, improve, patchLocal, onNavigate, onFix, draft, onDraft }) {
  const [input, setInput] = useState(draft?.input ?? item.shared_input ?? '')
  const [expectation, setExpectation] = useState(draft?.expectation ?? '')
  const [type, setType] = useState(draft?.type ?? 'must-contain')
  const [note, setNote] = useState(draft?.note ?? item.note ?? '')
  const [saved, setSaved] = useState(null)
  const [reading, setReading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [caseError, setCaseError] = useState('')
  const [linkError, setLinkError] = useState('')
  const [message, setMessage] = useState('')
  const [verify, setVerify] = useState(false)
  const [retry, setRetry] = useState(0)
  const active = useRef(true)
  useEffect(() => { onDraft({ input, expectation, type, note }) }, [input, expectation, type, note]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    let current = true
    setReading(true); setCaseError('')
    Promise.resolve(item.test_case_id || regressionId(app.id, item.run_id, user.id))
      .then(id => supabase.from('app_test_cases').select('*').eq('id', id).eq('app_id', app.id).maybeSingle())
      .then(({ data, error: problem }) => {
        if (!current) return
        if (problem) setCaseError(problem.message)
        else if (item.test_case_id && !data) setCaseError('The linked test is unavailable. Review access or restore it in Test before creating another case.')
        else if (data) setSaved(data)
      }).catch(e => { if (current) setCaseError(e.message) }).finally(() => { if (current) setReading(false) })
    return () => { current = false }
  }, [app.id, item.run_id, item.test_case_id, user.id, retry])

  async function update(patch) {
    setBusy(true); setError(''); setMessage('')
    try {
      await updateFeedback(item.id, patch)
      patchLocal(item.id, patch)
      if (active.current) setMessage('Triage saved.')
    } catch (e) { if (active.current) setError(`Could not save triage: ${e.message}`) }
    finally { if (active.current) setBusy(false) }
  }
  function changeStatus(status) {
    if (status !== 'verified') { update({ status }); return }
    if (!saved || !note.trim()) { setError('Save a regression test and add a verification note identifying the tested release before marking verified.'); return }
    if (!app.is_published) { setError('Publish the fix and check the live app before marking verified.'); return }
    if (!app.promoted_at || new Date(app.promoted_at) <= new Date(item.created_at)) { setError('Publish a release made after this feedback was reported, then check the live app before marking verified.'); return }
    setError(''); setVerify(true)
  }
  async function link(testCase) {
    const patch = { test_case_id: testCase.id, ...(item.status === 'new' ? { status: 'investigating' } : {}) }
    try { await updateFeedback(item.id, patch); patchLocal(item.id, patch); if (active.current) setLinkError('') }
    catch (e) { if (active.current) setLinkError(`Test saved, but feedback linking failed: ${e.message}`) }
  }
  async function save() {
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await saveRunRegression(supabase, { appId: app.id, userId: user.id, run: { id: item.run_id, app_id: app.id }, input, type, expectation })
      if (active.current) setSaved(result.testCase)
      await link(result.testCase)
    } catch (e) { if (active.current) setError(`Could not save regression test: ${e.message}`) }
    finally { if (active.current) setBusy(false) }
  }
  const shared = item.shared_input != null || item.shared_output != null
  return <section aria-label="Selected feedback" className={`${card} min-w-0 space-y-4`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><h2 className="text-base font-semibold text-white">{improve ? 'Evaluated issue' : 'Review feedback'}</h2><p className="text-sm text-slate-200 mt-2 whitespace-pre-wrap break-words">{item.comment || 'No comment left.'}</p><p className="text-xs text-slate-500 mt-2">{item.rating === -1 ? 'Not useful' : 'Useful'} · {new Date(item.created_at).toLocaleString()}</p></div>
      {!improve && <label className="text-xs text-slate-400">Status<select aria-label="Feedback status" disabled={busy} className={`${field} block mt-1`} value={item.status} onChange={e => changeStatus(e.target.value)}>{FEEDBACK_STATUSES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    </div>
    {verify && <ConfirmDialog title="Verify this feedback?" confirmLabel="Confirm verification" onCancel={() => setVerify(false)} onConfirm={async () => { await update({ status: 'verified', note: note.trim() }); if (active.current) setVerify(false) }}>
      Confirm that you checked the linked regression test and the live {app.live_version ? `v${app.live_version}` : 'release'}, and that they resolve this report. This records your review; {BRAND} has not automatically verified the fix.
    </ConfirmDialog>}
    {!improve && <>
      {shared ? <div className="grid sm:grid-cols-2 gap-3">{[['Customer question', item.shared_input], ['Answer they got', item.shared_output]].map(([name, value]) => <details key={name} className="min-w-0 rounded-xl bg-[#0E1424] p-3 text-xs text-slate-300"><summary className="cursor-pointer min-h-6 font-semibold">{name}</summary><pre className="mt-2 whitespace-pre-wrap break-words max-h-56 overflow-auto font-sans">{value == null ? 'Not shared' : value === '' ? 'Shared, but empty' : value}</pre></details>)}</div> : <p className="text-xs text-slate-400">The customer didn't share their question or the answer. Write a test input that reproduces the problem.</p>}
      <div><label className="block text-xs text-slate-400">Triage note / verification evidence<textarea aria-label="Triage note" rows={3} maxLength={1000} className={`${field} mt-1`} placeholder="Record your findings. For verification, include the tested release and evidence." value={note} onChange={e => setNote(e.target.value)} /></label><div className="flex flex-wrap justify-between items-center gap-2 mt-2"><span className="text-[11px] text-slate-500">Private to app editors · {note.length}/1000</span><button className={button} disabled={busy || note === (item.note || '')} onClick={() => update({ note: note.trim() || null })}>Save note</button></div></div>
      <p className="text-xs text-slate-500">Fixed means a change was made. Verified is your confirmation that the linked test and live release resolve the report; record that evidence in the note.</p>
    </>}
    {error && <p role="alert" className="text-sm text-amber-300 break-words">{error}</p>}{message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
    {caseError && <p role="alert" className="text-xs text-amber-300">Could not check saved regression tests: {caseError} <button className="underline min-h-10" onClick={() => setRetry(n => n + 1)}>Retry coverage check</button></p>}
    {linkError && <p role="alert" className="text-xs text-amber-300">{linkError} <button disabled={busy} className="underline min-h-10" onClick={async () => { setBusy(true); await link(saved); if (active.current) setBusy(false) }}>Retry feedback link</button></p>}
    {reading ? <p role="status" className="text-xs text-slate-400">Checking regression coverage…</p> : saved ? <div role="status" className="text-sm text-emerald-300">Regression test saved. Run and edit it in Build → Test; saving a case does not mean the app has passed.<p className="text-xs mt-2 break-words text-slate-400">{saved.name}</p></div> : !improve && <div className="space-y-3 border-t border-white/8 pt-4"><h3 className="text-sm font-semibold text-white">Capture a regression</h3><label className="block text-xs text-slate-400">Regression input<textarea aria-label="Regression input" rows={3} className={`${field} mt-1`} value={input} onChange={e => setInput(e.target.value)} /></label><p className="text-xs text-slate-400">Review the input and define the corrected behavior. The customer's answer is never used as the expected answer.</p><label className="block text-xs text-slate-400">Check<select aria-label="Regression check" className={`${field} mt-1`} value={type} onChange={e => setType(e.target.value)}><option value="must-contain">Answer must contain</option><option value="must-not-contain">Answer must not contain</option></select></label><label className="block text-xs text-slate-400">Expected behavior<input aria-label="Expected behavior" placeholder="Required phrase or forbidden claim" className={`${field} mt-1`} value={expectation} onChange={e => setExpectation(e.target.value)} /></label><button className={`${button} !bg-[#6C5CE7]`} disabled={busy || !!caseError || !input.trim() || !expectation.trim()} onClick={save}>{busy ? 'Saving regression…' : 'Save regression test'}</button></div>}
    {improve && <><p className="text-xs text-slate-400">{item.note || 'No triage note yet.'}</p><button className={button} onClick={() => onNavigate('evaluate', app.id)}>Review evidence in Eval</button></>}
    <div className="flex flex-wrap gap-2 border-t border-white/8 pt-4">{!improve ? <button className={`${button} !bg-[#6C5CE7]`} onClick={() => onNavigate('improve', app.id)}>Continue to Improve</button> : <button className={`${button} !bg-[#6C5CE7]`} onClick={() => onFix(app.id, { id: item.run_id, feedback_text: item.comment }, saved)}>Open draft fix in Design</button>}<button className={button} onClick={() => onNavigate('test', app.id)}>Validate in Test</button></div>
  </section>
}
