import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { feedbackSummary, regressionId, saveRunRegression } from '../../lib/operationsLoop'
import { useToast } from '../../hooks/useToast'

const button = 'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-40'
const field = 'w-full rounded-xl border border-white/10 bg-[#0E1424] px-3 py-2 text-sm text-white'

export default function OperationsWorkflow({ stage, apps, runs, user, selectedAppId, onSelectApp, selectedRunId, onSelectRun, onNavigate, onFix, loading, error, onRefresh }) {
  const toast = useToast()
  const app = apps.find(a => a.id === selectedAppId) || apps[0]
  const appRuns = runs.filter(r => r.app_id === app?.id)
  const issues = appRuns.filter(r => r.rating_value === -1)
  const run = appRuns.find(r => r.id === selectedRunId) || issues[0] || appRuns[0]
  const appId = app?.id
  const runId = run?.id
  const runInput = run?.input || ''
  const summary = feedbackSummary(appRuns)
  const [input, setInput] = useState('')
  const [expectation, setExpectation] = useState('')
  const [type, setType] = useState('must-contain')
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [reading, setReading] = useState(false)
  const [caseError, setCaseError] = useState('')
  const [retry, setRetry] = useState(0)
  const currentKey = useRef('')
  currentKey.current = `${app?.id}:${run?.id}`

  useEffect(() => {
    let active = true
    setInput(runInput)
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
  }, [appId, runId, runInput, user.id, retry])

  async function save() {
    const key = currentKey.current
    setSaving(true)
    try {
      const result = await saveRunRegression(supabase, { appId: app.id, userId: user.id, run, input, type, expectation })
      if (currentKey.current === key) setSaved(result.testCase)
      toast(result.existing ? 'This run already has a regression test. Edit it in Test.' : 'Regression test saved. Run it against your draft in Test.', 'success')
    } catch (e) { toast(`Could not save regression test: ${e.message}`, 'error') }
    finally { if (currentKey.current === key) setSaving(false) }
  }

  if (!app) return null
  return <section aria-label="Operate and Grow workflow" className="rounded-2xl border border-[#6C5CE7]/25 bg-[#171B33] p-4 sm:p-5 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-white text-base font-semibold">Keep improving your app</h2>
        <p className="text-slate-400 text-xs mt-1">Review real feedback, capture a regression test, and validate a draft before publishing.</p></div>
      <button className={button} disabled={loading} onClick={onRefresh}>{loading ? 'Refreshing…' : 'Refresh feedback'}</button>
    </div>
    <label className="block text-xs text-slate-400">App to operate
      <select aria-label="App to operate" className={`${field} mt-1`} value={app.id} onChange={e => { onSelectApp(e.target.value); onSelectRun(null) }}>
        {apps.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_published ? ' · Live' : ' · Not published'}</option>)}
      </select>
    </label>
    {error && <div role="alert" className="text-amber-300 text-sm">{error} Use Refresh feedback to retry.</div>}
    {stage === 'monitor' && !error && <>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[[summary.total, 'Runs for this app'], [summary.negative, 'Not useful'], [summary.satisfaction == null ? '—' : `${summary.satisfaction}%`, 'Useful feedback']].map(([value, label]) => <div key={label} className="rounded-xl bg-[#0E1424] p-3"><p className="text-white font-bold">{value}</p><p className="text-xs text-slate-400">{label}</p></div>)}
      </div>
      <p className="text-xs text-slate-400">Up to 500 recent runs you have access to across your apps. {summary.rated} rated for this app. History does not identify the published version, so this is feedback to investigate rather than a release comparison.</p>
      {!app.is_published && <p className="text-amber-300 text-xs">Publish this app through Build to start collecting live feedback.</p>}
      {issues.length ? <div className="space-y-2"><h3 className="text-sm text-white font-semibold">Needs attention</h3>
        {issues.slice(0, 10).map(r => <div key={r.id} className="flex gap-3 items-center rounded-xl border border-white/5 p-3">
          <p className="flex-1 min-w-0 truncate text-xs text-slate-300">{r.feedback_text || r.input || 'Run marked not useful'}</p>
          <button className={button} onClick={() => { onSelectRun(r.id); onNavigate('evaluate', app.id) }}>Review run</button>
        </div>)}</div> : <p className="text-xs text-slate-400">{summary.rated ? 'No negative feedback in the loaded runs. Keep collecting feedback.' : 'No rated feedback yet. Open the live app and ask users to rate useful and not-useful answers.'}</p>}
    </>}
    {['evaluate', 'improve'].includes(stage) && <>
      {!appRuns.length ? <p className="text-sm text-slate-400">No runs to review for this app yet. You can still open Design or validate the draft in Test.</p> : <>
        <label className="block text-xs text-slate-400">Run to investigate
          <select aria-label="Run to investigate" className={`${field} mt-1`} value={run?.id || ''} onChange={e => onSelectRun(e.target.value)}>
            {appRuns.map(r => <option key={r.id} value={r.id}>{r.rating_value === -1 ? 'Not useful' : r.rating_value === 1 ? 'Useful' : 'Unrated'} · {new Date(r.created_at).toLocaleString()} · {String(r.input || '').slice(0, 60)}</option>)}
          </select>
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          {[['Original input', run?.input], ['Observed answer', run?.output]].map(([label, value]) => <details key={label} className="rounded-xl bg-[#0E1424] p-3 text-xs text-slate-300"><summary className="cursor-pointer font-semibold">{label}</summary><pre className="mt-2 whitespace-pre-wrap max-h-56 overflow-auto font-sans">{value || 'Not recorded'}</pre></details>)}
        </div>
        {run?.feedback_text && <p className="text-xs text-amber-200">Feedback: {run.feedback_text}</p>}
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
      </>}
      <div className="flex flex-wrap gap-2">
        {stage === 'evaluate' && <button className={button} onClick={() => onNavigate('improve', app.id)}>Continue to Improve</button>}
        <button className={button} onClick={() => onFix(app.id, run, saved)}>Open draft fix in Design</button>
        <button className={button} onClick={() => onNavigate('test', app.id)}>Validate in Test</button>
      </div>
      <p className="text-xs text-slate-400">{app.is_published ? `Live ${app.live_version ? `v${app.live_version}` : 'version'} stays available while you edit. ` : ''}Design → Test → Publish → Monitor closes the loop. Published updates still require the existing release checks.</p>
    </>}
    {stage === 'sell' && <div className="text-sm text-slate-300 space-y-2"><p>Marketplace is optional. Publish, collect feedback, and fix quality issues before listing.</p><div className="flex gap-2"><button className={button} onClick={() => onNavigate('monitor', app.id)}>Review app health</button><button className={button} onClick={() => onNavigate('deploy', app.id)}>Review publish readiness</button></div></div>}
  </section>
}
