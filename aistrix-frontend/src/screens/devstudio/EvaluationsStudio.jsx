import { cloneElement, useEffect, useId, useRef, useState } from 'react'
import { useBuilderNavigation } from '../../hooks/useBuilderNavigation'
import { buildSuite, editSuite, newCase, newCheck, newSuite } from '../../lib/evaluationEditor'
import { getPlatformEvals, getPlatformRelease, getPlatformResource, getPlatformRun, getPlatformEvents, listPlatformResources, releasePlatformSpec, runPlatformEval, validatePlatformSpec } from '../../lib/platformApi'

const card = 'rounded-xl border border-white/10 bg-[#131929] p-4 sm:p-5 space-y-4 min-w-0'
const input = 'w-full rounded-lg border border-white/15 bg-[#0E1424] p-3 text-sm text-white min-h-11 disabled:opacity-50'
const button = 'min-h-11 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40'
const primary = `${button} bg-violet-500/20 border-violet-400/40 hover:bg-violet-500/30`
const percent = value => `${Math.round(value * 100)}%`
const money = value => value == null ? 'Not reported' : `$${Number(value).toFixed(6)}`
const pretty = value => JSON.stringify(value, null, 2)
function Field({ label, children }) {
  const id = useId()
  return <div className="space-y-2 text-sm text-slate-400"><label className="block" htmlFor={id}>{label}</label>{cloneElement(children, { id })}</div>
}
function ErrorMessage({ error }) { return error ? <p role="alert" className="text-sm text-amber-300 whitespace-pre-wrap break-words">{error}</p> : null }
function explain(error) { return [error.message, ...(error.problems || []).map(problem => `${problem.path}: ${problem.message}`)].join('\n') }

function CaseEditor({ entry, index, onChange, onRemove, disabled }) {
  const updateCheck = (i, changes) => onChange({ ...entry, checks: entry.checks.map((rule, j) => j === i ? { ...rule, ...changes } : rule) })
  return <fieldset className="rounded-lg border border-white/10 p-4 space-y-4 min-w-0" disabled={disabled}>
    <legend className="text-sm text-white px-2">Test case {index + 1}</legend>
    <div className="flex flex-wrap gap-3 items-end"><div className="flex-1"><Field label={`Case ${index + 1} name`}><input className={input} value={entry.name} onChange={event => onChange({ ...entry, name: event.target.value })} required maxLength={120} /></Field></div><button type="button" className={button} onClick={onRemove}>Remove case {index + 1}</button></div>
    <Field label={`Case ${index + 1} input (JSON object)`}><textarea className={`${input} font-mono`} rows={4} value={entry.input} onChange={event => onChange({ ...entry, input: event.target.value })} /></Field>
    {entry.checks.map((rule, i) => <div key={i} className="rounded-lg bg-white/5 p-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><Field label={`Case ${index + 1} check ${i + 1} type`}><select className={input} value={rule.type} onChange={event => updateCheck(i, { type: event.target.value })}>{[['not_empty', 'Not empty'], ['equals', 'Equals'], ['contains', 'Contains'], ['number_close', 'Number within tolerance'], ['json_schema', 'Matches JSON schema']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label={`Case ${index + 1} check ${i + 1} output path`}><input className={input} placeholder="vendor.name (blank for whole output)" value={rule.path} onChange={event => updateCheck(i, { path: event.target.value })} /></Field></div>
      {['equals', 'contains', 'number_close'].includes(rule.type) && <Field label={`Case ${index + 1} check ${i + 1} expected value (JSON)`}><textarea className={`${input} font-mono`} rows={2} placeholder={'"ACME" or 120 or true'} value={rule.value} onChange={event => updateCheck(i, { value: event.target.value })} /></Field>}
      {rule.type === 'number_close' && <Field label={`Case ${index + 1} check ${i + 1} tolerance`}><input className={input} type="number" min="0" step="any" value={rule.tolerance} onChange={event => updateCheck(i, { tolerance: event.target.value })} /></Field>}
      {rule.type === 'json_schema' && <Field label={`Case ${index + 1} check ${i + 1} JSON schema`}><textarea className={`${input} font-mono`} rows={4} value={rule.schema} onChange={event => updateCheck(i, { schema: event.target.value })} /></Field>}
      <button type="button" className={button} onClick={() => onChange({ ...entry, checks: entry.checks.filter((_, j) => i !== j) })}>Remove check {i + 1}</button>
    </div>)}
    <button type="button" className={button} onClick={() => onChange({ ...entry, checks: [...entry.checks, newCheck()] })}>Add check to case {index + 1}</button>
  </fieldset>
}

function RunInspection({ id }) {
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let active = true
    Promise.all([getPlatformRun(id), getPlatformEvents(id)]).then(([run, events]) => { if (active) setState({ ...run, ...events }) }).catch(error => { if (active) setState({ error: error.message }) })
    return () => { active = false }
  }, [id])
  return <section className={card}><h3 className="text-white font-semibold">Case execution</h3><p className="text-xs text-slate-400 break-all">{id}</p>{state.loading && <p role="status">Loading run…</p>}<ErrorMessage error={state.error} />{state.run && <><p className="text-sm text-slate-300">{state.run.status} · {money(state.run.cost_usd)}</p><details><summary className="text-sm text-white cursor-pointer">Output, errors, and step traces</summary><pre className="text-xs text-slate-300 whitespace-pre-wrap break-words max-h-96 overflow-auto mt-3">{pretty({ output: state.run.output, error: state.run.error, steps: state.run.steps, events: state.events })}</pre></details></>}</section>
}

export default function EvaluationsStudio({ navigationGuardRef }) {
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [appKey, setAppKey] = useState('')
  const [appDetail, setAppDetail] = useState(null)
  const [releaseId, setReleaseId] = useState('')
  const [target, setTarget] = useState(null)
  const [workload, setWorkload] = useState('')
  const [suiteKey, setSuiteKey] = useState('')
  const [suiteDetail, setSuiteDetail] = useState(null)
  const [suiteId, setSuiteId] = useState('')
  const [draft, setDraft] = useState(newSuite)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [runId, setRunId] = useState('')
  const [refresh, setRefresh] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useBuilderNavigation({ enabled: true, navigationGuardRef, hasChanges: dirty, busy: !!busy })

  useEffect(() => {
    let active = true
    setLoading(true)
    listPlatformResources().then(data => { if (active) { setResources(data.resources || []); setLoading(false) } }).catch(err => { if (active) { setError(err.message); setLoading(false) } })
    return () => { active = false }
  }, [refresh])
  useEffect(() => {
    let active = true
    setAppDetail(null)
    if (appKey) getPlatformResource(appKey).then(data => { if (active) setAppDetail(data) }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [appKey, refresh])
  useEffect(() => {
    let active = true
    setSuiteDetail(null)
    if (suiteKey) getPlatformResource(suiteKey).then(data => { if (active) setSuiteDetail(data) }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [suiteKey, refresh])
  useEffect(() => {
    let active = true
    setTarget(null); setResults([]); setSelected(null); setRunId('')
    if (releaseId) Promise.all([getPlatformRelease(releaseId), getPlatformEvals(releaseId)]).then(([detail, history]) => {
      if (!Array.isArray(detail.gate?.checks) || typeof detail.gate.eligible !== 'boolean') throw new Error('The server did not report this release’s evaluation gate. Refresh or update the Platform API before continuing.')
      if (active) { setTarget(detail); setResults(history.results || []) }
    }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [releaseId, refresh])
  const targetRef = target?.release.ref || ''
  const externalSteps = target?.evaluation?.workloads.find(item => item.name === workload)?.external_steps || []
  const apps = resources.filter(resource => resource.kind === 'Application')
  const suites = resources.filter(resource => resource.kind === 'EvalSuite')
  const changed = update => { setDraft(prev => ({ ...prev, ...update })); setDirty(true); setMessage('') }
  function canReplace() { return !busy && (!dirty || window.confirm('Discard unsaved evaluation changes?')) }
  function resetEditor() { setDraft(newSuite()); setSaved(null); setDirty(false); setMessage(''); setError('') }
  function chooseApp(key) { if (canReplace()) { setAppKey(key); setReleaseId(''); setWorkload(''); resetEditor() } }
  function chooseRelease(id) { if (canReplace()) { setReleaseId(id); setWorkload(''); resetEditor() } }
  async function loadSuite() {
    if (!canReplace()) return
    setBusy('load'); setError('')
    try {
      const data = await getPlatformRelease(suiteId)
      if (data.spec.kind !== 'EvalSuite') throw new Error('Choose an Eval Suite release.')
      if (data.spec.spec.target.ref !== targetRef || data.spec.spec.target.workload !== workload) throw new Error(`This suite targets ${data.spec.spec.target.ref}, workload ${data.spec.spec.target.workload}. Choose that target before loading it.`)
      const next = editSuite(data.spec)
      setDraft(next); setDirty(false); setSaved({ ref: data.release.ref, signature: JSON.stringify(buildSuite(next, targetRef, workload)) }); setMessage('Loaded immutable suite. Change its version before releasing edits.')
    } catch (err) { setError(explain(err)) } finally { if (mounted.current) setBusy('') }
  }
  async function saveSuite(event) {
    event.preventDefault(); setBusy('save'); setError(''); setMessage('')
    try {
      const doc = buildSuite(draft, targetRef, workload, externalSteps)
      const validation = await validatePlatformSpec(doc)
      if (!validation.valid) throw Object.assign(new Error('Suite validation failed.'), { problems: validation.problems })
      const data = await releasePlatformSpec(doc)
      setSaved({ ref: data.release.ref, signature: JSON.stringify(doc) }); setDirty(false); setMessage(`Released ${data.release.ref}. The release is immutable.`); setRefresh(value => value + 1)
    } catch (err) { setError(explain(err)) } finally { if (mounted.current) setBusy('') }
  }
  let unchanged = false
  try { unchanged = !!saved && saved.signature === JSON.stringify(buildSuite(draft, targetRef, workload, externalSteps)) } catch { /* Validation errors are shown on release. */ }
  async function runSuite() {
    if (!unchanged || busy) return
    setBusy('run'); setError(''); setMessage('Running evaluation. Model calls can take several minutes.')
    try {
      const data = await runPlatformEval(saved.ref)
      const [history, detail] = await Promise.all([getPlatformEvals(releaseId), getPlatformRelease(releaseId)])
      if (mounted.current) { setResults(history.results || []); setTarget(detail); setSelected(data.result); setRunId(''); setMessage('Evaluation finished. Results are saved against this application release.') }
    } catch (err) { if (mounted.current) { setError(`${explain(err)}\nIf the connection ended, refresh results before starting another evaluation.`); setMessage('') } }
    finally { if (mounted.current) setBusy('') }
  }

  return <div role="region" aria-label="Evaluation Studio" className="max-w-5xl mx-auto space-y-5 pb-8">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-semibold text-white">Evaluations</h1><p className="text-sm text-slate-400 mt-2">Test pinned application releases and inspect production evaluation requirements.</p></div><button className={button} disabled={!!busy} onClick={() => { setError(''); setRefresh(value => value + 1) }}>Refresh results</button></header>
    <ErrorMessage error={error} />{message && <p role="status" className="text-sm text-violet-300">{message}</p>}
    {loading && !resources.length && <p role="status" className="text-sm text-slate-400">Loading platform resources…</p>}
    {!loading && !error && !apps.length && <section className={card}><h2 className="text-white font-semibold">Release an application first</h2><p className="text-sm text-slate-400">Evaluations target immutable Platform Application pipeline releases. Release one through the CLI or Platform API to start. Existing AI App quality tools remain available in Studio.</p></section>}
    <section className={card}>
      <h2 className="text-white font-semibold">1. Choose the target</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Application"><select className={input} value={appKey} disabled={!!busy} onChange={event => chooseApp(event.target.value)}><option value="">Choose application</option>{apps.map(app => <option key={app.key} value={app.key}>{app.namespace}/{app.name}</option>)}</select></Field>
        <Field label="Application release"><select className={input} disabled={!appDetail || !!busy} value={releaseId} onChange={event => chooseRelease(event.target.value)}><option value="">Choose pinned release</option>{appDetail?.releases.map(release => <option key={release.id} value={release.id}>{release.version}</option>)}</select></Field>
        <Field label="Workload"><select className={input} disabled={!target || !!busy} value={workload} onChange={event => { if (canReplace()) { setWorkload(event.target.value); resetEditor() } }}><option value="">Choose workload</option>{target?.release.workloads.map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
      </div>
      {target && <p className="text-xs text-slate-500 break-all">{targetRef}<br />Release ID: {target.release.id}<br />Content hash: {target.release.content_hash}</p>}
    </section>
    {target && <section className={card} aria-label="Production evaluation gate"><h2 className="text-white font-semibold">Production evaluation gate</h2>
      {target.gate?.checks.length ? <><p className={`text-sm ${target.gate.eligible ? 'text-emerald-300' : 'text-amber-300'}`}>{target.gate.eligible ? 'Required evaluations passed' : 'Production blocked by required evaluations'}</p><ul className="space-y-2 text-sm text-slate-300">{target.gate.checks.map(check => <li key={check.suite} className="break-all">{check.suite} · {check.status}{check.pass_rate != null ? ` · ${percent(check.pass_rate)} passed, ${percent(check.required)} required` : ''}</li>)}</ul></> : <p className="text-sm text-amber-200">No required suites are configured on this release. Passing an optional suite does not add a production gate.</p>}
      <p className="text-xs text-slate-400">Required suite references come from the application specification’s tests field. Adding requirements needs a new application release; this view does not promote or change the release.</p>
    </section>}
    {target && workload && <>
      <section className={card}><h2 className="text-white font-semibold">2. Create or load a suite</h2><div className="grid gap-3 sm:grid-cols-2"><Field label="Existing suite"><select className={input} value={suiteKey} disabled={!!busy} onChange={event => { setSuiteKey(event.target.value); setSuiteId('') }}><option value="">Choose suite</option>{suites.map(suite => <option key={suite.key} value={suite.key}>{suite.namespace}/{suite.name}</option>)}</select></Field><Field label="Suite release"><select className={input} disabled={!suiteDetail || !!busy} value={suiteId} onChange={event => setSuiteId(event.target.value)}><option value="">Choose suite version</option>{suiteDetail?.releases.map(release => <option key={release.id} value={release.id}>{release.version}</option>)}</select></Field></div><div className="flex flex-wrap gap-3"><button className={button} disabled={!suiteId || !!busy} onClick={loadSuite}>Load released suite</button><button className={button} disabled={!!busy} onClick={() => { if (canReplace()) resetEditor() }}>New suite</button></div></section>
      <form onSubmit={saveSuite} className={card} aria-label="Evaluation suite editor">
        <fieldset disabled={!!busy} className="space-y-5 min-w-0">
          <div className="grid gap-3 sm:grid-cols-3">{[['Namespace', 'namespace'], ['Suite name', 'name'], ['Suite version', 'version']].map(([label, key]) => <Field key={key} label={label}><input className={input} value={draft[key]} required onChange={event => changed({ [key]: event.target.value })} /></Field>)}</div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Required pass rate (%)"><input className={input} type="number" min="0" max="100" step="any" value={draft.requiredPassRate} onChange={event => changed({ requiredPassRate: event.target.value })} /></Field><Field label="Approval behavior during evaluation"><select className={input} value={draft.approvals} onChange={event => changed({ approvals: event.target.value })}><option value="approve">Simulate approval</option><option value="reject">Simulate rejection</option></select></Field></div>
          {draft.cases.map((entry, index) => <CaseEditor key={index} entry={entry} index={index} disabled={!!busy} onChange={next => changed({ cases: draft.cases.map((item, i) => i === index ? next : item) })} onRemove={() => changed({ cases: draft.cases.filter((_, i) => i !== index) })} />)}
          <button className={button} type="button" disabled={draft.cases.length >= 200} onClick={() => changed({ cases: [...draft.cases, newCase(draft.cases.length + 1)] })}>Add test case</button>
          <Field label="External step replacements (JSON object keyed by step ID)"><textarea className={`${input} font-mono`} rows={4} value={draft.mocks} onChange={event => changed({ mocks: event.target.value })} /></Field>
          <p className="text-xs text-slate-400">{externalSteps.length ? `Replacements required for: ${externalSteps.join(', ')}. These outputs replace external write steps.` : 'No external write steps reported for this workload.'} Model calls use your configured provider keys and may incur charges.</p>
          <details className="space-y-3"><summary className="cursor-pointer text-sm text-slate-300">Shared checks and dataset</summary><Field label="Shared checks (JSON array)"><textarea className={`${input} font-mono`} rows={3} value={draft.sharedChecks} onChange={event => changed({ sharedChecks: event.target.value })} /></Field><Field label="Pinned dataset reference (optional)"><input className={input} placeholder="Dataset/team/invoices@1.0.0" value={draft.dataset} onChange={event => changed({ dataset: event.target.value })} /></Field></details>
          <div className="flex flex-wrap gap-3"><button type="submit" className={primary}>Validate and release suite</button><button className={primary} type="button" disabled={!unchanged} onClick={runSuite}>Run released suite</button></div>
        </fieldset>
        {saved && <p className="text-xs text-slate-400 break-all">Released: {saved.ref}{!unchanged ? ' · Editor changed. Release a new version before running.' : ''}</p>}
      </form>
    </>}
    {target && <section className={card}><h2 className="text-white font-semibold">3. Evaluation history</h2>{!results.length && <p className="text-sm text-slate-400">No evaluations recorded for this release.</p>}<div className="space-y-2">{results.map(result => <button key={result.id} className={`${button} w-full text-left ${selected?.id === result.id ? 'bg-violet-500/15' : ''}`} onClick={() => { setSelected(result); setRunId('') }}><span className="block break-all">{result.suite}</span><span className="text-xs text-slate-400">{result.passed ? 'Passed' : 'Failed'} · {percent(result.pass_rate)} · {money(result.cost_usd)} · {result.created_at}</span></button>)}</div></section>}
    {selected && <section className={card} aria-label="Evaluation result"><h2 className="text-white font-semibold">{selected.passed ? 'Evaluation passed' : 'Evaluation failed'}</h2><p className="text-sm text-slate-400 break-all">{selected.suite} · {percent(selected.pass_rate)} passed · {percent(selected.required)} required · {money(selected.cost_usd)}</p><p className="text-xs text-slate-500 break-all">Result ID: {selected.id} · Release ID: {selected.release_id}</p>{selected.cases.map((entry, i) => <article key={i} className="rounded-lg border border-white/10 p-3 space-y-2"><h3 className="text-sm text-white">{entry.name} · {entry.passed ? 'Passed' : 'Failed'}</h3>{entry.failures?.map((failure, j) => <p key={j} className="text-sm text-amber-300 break-words">{failure}</p>)}{entry.run_id ? <button className={button} onClick={() => setRunId(entry.run_id)}>Inspect case {i + 1} execution</button> : <p className="text-xs text-slate-400">Input refused before execution.</p>}</article>)}<button className={button} onClick={() => setBaseline({ ...selected, target: targetRef })}>Use as comparison baseline</button></section>}
    {baseline && <section className={card}><div className="flex justify-between gap-3"><h2 className="text-white font-semibold">Result comparison</h2><button className={button} onClick={() => setBaseline(null)}>Clear baseline</button></div><p className="text-xs text-slate-400 break-all">Baseline: {baseline.target} · {baseline.suite}</p>{selected && selected.id !== baseline.id ? <><div className="overflow-x-auto"><table className="w-full text-sm text-slate-300 text-left"><thead><tr><th className="p-2">Metric</th><th className="p-2">Baseline</th><th className="p-2">Selected</th></tr></thead><tbody>{[['Pass rate', percent(baseline.pass_rate), percent(selected.pass_rate)], ['Model cost', money(baseline.cost_usd), money(selected.cost_usd)], ['Cases', baseline.cases.length, selected.cases.length]].map(row => <tr key={row[0]}>{row.map((value, i) => <td key={i} className="p-2 border-t border-white/10">{value}</td>)}</tr>)}</tbody></table></div><p className="text-xs text-slate-400">Selected: {targetRef} · {selected.suite}. Compare equivalent cases, checks, model settings, and thresholds when assessing releases.</p></> : <p className="text-sm text-slate-400">Select another result here or choose another application release to compare.</p>}</section>}
    {runId && <RunInspection key={runId} id={runId} />}
  </div>
}
