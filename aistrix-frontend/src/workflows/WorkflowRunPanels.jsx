import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, Circle, CircleAlert, CircleCheck, CircleMinus, CirclePause, CircleStop, CircleX, Copy, Download, LoaderCircle, Play, RefreshCw, Sparkles } from 'lucide-react'
import { releaseProblems, isApproval } from './workflowModel'
import { cancelRun, deleteSchedule, getRun, getSchedule, listRuns, putSchedule, resumeRun, setWebhook, startRun, webhookUrl } from './workflowApi'

const field = 'w-full min-w-0 rounded-lg border border-white/10 bg-[#0E1424] px-2.5 py-1.5 text-xs text-white focus:border-[#6C5CE7] focus:outline-none'
const primary = 'inline-flex items-center gap-1.5 rounded-xl bg-[#6C5CE7] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#7C6CFF] disabled:opacity-50'
const secondary = 'inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50'
const tiny = 'inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10 hover:text-white'
const card = 'rounded-2xl border border-white/8 bg-[#171B33] p-4'

const RUN_LABEL = { running: 'Working', waiting_approval: 'Needs approval', done: 'Done', failed: 'Failed', cancelled: 'Stopped' }
const runLabel = r => (r.status === 'failed' && / rejected: /.test(r.error || '') ? 'Rejected' : RUN_LABEL[r.status] || r.status)
const TRIGGER_LABEL = { interactive: 'Test', webhook: 'Webhook', schedule: 'Schedule' }
const POLL_MS = 1000

// ── Downloads ────────────────────────────────────────────────────────────────
const slug = s => String(s || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workflow'

function saveFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function asJson(text) {
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? JSON.stringify(v, null, 2) : null } catch { return null }
}

export function downloadStep(flow, index, record) {
  const json = asJson(record.output || '')
  const base = `${slug(flow.name)}-step${index + 2}-${slug(record.name)}`
  if (json) saveFile(`${base}.json`, json, 'application/json')
  else saveFile(`${base}.txt`, record.output || '', 'text/plain')
}

export function downloadRun(flow, run) {
  const steps = (run.steps || []).map(r => ({
    step: r.index + 2, name: r.name, status: r.status, version: r.version || null,
    output: asJson(r.output || '') ? JSON.parse(r.output) : (r.output || ''), error: r.error || null,
  }))
  saveFile(`${slug(flow.name)}-run-${String(run.started_at || '').slice(0, 10) || run.id.slice(0, 8)}.json`, JSON.stringify({
    workflow: flow.name, run_id: run.id, started_by: TRIGGER_LABEL[run.trigger] || run.trigger, status: run.status,
    started_at: run.started_at || null, finished_at: run.finished_at || null, input: run.seed_input || '', error: run.error || null, steps,
  }, null, 2), 'application/json')
}

// ── Progress ─────────────────────────────────────────────────────────────────
// A ring that fills as steps finish and spins while a step is working.
export function ProgressRing({ done, total, status, size = 44 }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const pct = total ? Math.min(done / total, 1) : 0
  const color = status === 'failed' ? '#F87171' : status === 'waiting_approval' ? '#7DD3FC' : status === 'done' ? '#4ADE80' : status === 'cancelled' ? '#94A3B8' : '#A29BFE'
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} role="img"
      aria-label={`${done} of ${total} steps finished${status === 'running' ? ', working' : ''}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 400ms ease' }} />
      </svg>
      {status === 'running' && (
        <svg width={size} height={size} className="absolute inset-0 animate-spin" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={`${c * 0.12} ${c}`} opacity="0.9" />
        </svg>
      )}
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">{done}/{total}</span>
    </span>
  )
}

function StepState({ state }) {
  if (state === 'ok') return <span className="inline-flex items-center gap-1 text-[11px] text-green-400"><CircleCheck size={14} aria-hidden="true" />Done</span>
  if (state === 'failed' || state === 'rejected') return <span className="inline-flex items-center gap-1 text-[11px] text-red-400"><CircleX size={14} aria-hidden="true" />{state === 'rejected' ? 'Rejected' : 'Failed'}</span>
  if (state === 'waiting_approval') return <span className="inline-flex items-center gap-1 text-[11px] text-sky-300"><CirclePause size={14} aria-hidden="true" />Waiting for approval</span>
  if (state === 'working') return <span className="inline-flex items-center gap-1 text-[11px] text-[#C9C2FF]"><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />Working…</span>
  if (state === 'skipped') return <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><CircleMinus size={14} aria-hidden="true" />Skipped</span>
  if (state === 'cancelled') return <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><CircleStop size={14} aria-hidden="true" />Stopped</span>
  if (state === 'not_run') return <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Circle size={14} aria-hidden="true" />Not run</span>
  return <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Circle size={14} aria-hidden="true" />Waiting to start</span>
}

function Output({ text }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > 600
  return (
    <div>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/8 bg-[#0E1424] p-2.5 text-[11px] leading-relaxed text-slate-200">{open || !long ? text : `${text.slice(0, 600)}…`}</pre>
      {long && <button onClick={() => setOpen(o => !o)} className="mt-1 text-[11px] text-[#A29BFE] hover:underline">{open ? 'Show less' : 'Show all'}</button>}
    </div>
  )
}

// Follows a run: polls while it's working, stops when it pauses or ends.
function useRun(flowId) {
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const timer = useRef(null)
  const stop = () => { clearTimeout(timer.current); timer.current = null }
  const follow = useCallback(next => {
    stop()
    setRun(next)
    if (next?.status !== 'running') return
    const tick = async () => {
      try {
        const fresh = await getRun(flowId, next.id)
        setRun(fresh)
        if (fresh.status === 'running') timer.current = setTimeout(tick, POLL_MS)
      } catch (e) { setError(e.message) }
    }
    timer.current = setTimeout(tick, POLL_MS)
  }, [flowId])
  useEffect(() => stop, [])
  return { run, follow, error, setError }
}

// One run, step by step: status, output, downloads, and the approval decision.
function RunView({ flow, run, onDecided }) {
  const [stopping, setStopping] = useState(false)
  const [edit, setEdit] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const records = run.steps || []
  const waiting = run.status === 'waiting_approval' ? records[records.length - 1] : null
  const waitingKey = waiting ? `${run.id}:${waiting.index}` : ''
  useEffect(() => { setEdit(waiting?.output || ''); setReason('') }, [waitingKey])   // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async approve => {
    setBusy(true); setError('')
    try {
      const step = flow.steps[waiting.index]
      onDecided(await resumeRun(flow.id, run.id, approve
        ? { approve: true, ...(isApproval(step) && step.approval_type === 'edit' ? { output: edit } : {}) }
        : { approve: false, reason }))
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const stop = async () => {
    setStopping(true); setError('')
    try { onDecided(await cancelRun(flow.id, run.id)) }
    catch (e) { setError(e.message) }
    finally { setStopping(false) }
  }
  const done = records.filter(r => r.status === 'ok' || r.status === 'skipped').length
  const stateOf = i => {
    const rec = records.find(r => r.index === i)
    // A run stopped while it waited: the approval is no longer open.
    if (rec?.status === 'waiting_approval' && run.status !== 'waiting_approval') return 'cancelled'
    if (rec) return rec.status
    if (run.status === 'running' && i === run.current_step) return 'working'
    return run.status === 'running' ? 'pending' : 'not_run'
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <ProgressRing done={done} total={flow.steps.length} status={run.status} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{runLabel(run)}</p>
          <p className="text-[11px] text-slate-400">
            {TRIGGER_LABEL[run.trigger] || run.trigger}{run.started_at ? ` · started ${new Date(run.started_at).toLocaleString()}` : ''}
          </p>
        </div>
        {(run.status === 'running' || run.status === 'waiting_approval') && (
          <button className={tiny} disabled={stopping} onClick={stop} title="Stop this run: a step already working finishes, nothing after it runs">
            <CircleStop size={12} /> {stopping ? 'Stopping…' : 'Stop'}</button>
        )}
        {records.some(r => r.output) && <button className={tiny} onClick={() => downloadRun(flow, run)}><Download size={12} /> Download all</button>}
      </div>
      {run.error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{run.error}</p>}
      {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}
      <ol className="space-y-2">
        {flow.steps.map((step, i) => {
          const rec = records.find(r => r.index === i)
          const state = stateOf(i)
          return (
            <li key={step.id} className={`rounded-xl border p-3 ${state === 'working' ? 'border-[#6C5CE7]/40 bg-[#6C5CE7]/5' : 'border-white/8 bg-[#111827]'}`}>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-[10px] font-bold text-slate-300">{i + 2}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{rec?.name || step.app_name}</span>
                {rec?.version && <span className="text-[10px] text-slate-400">{rec.version}</span>}
                {rec?.output && state !== 'waiting_approval' && (
                  <button className={tiny} aria-label={`Download step ${i + 2} result`} title="Download this step's result" onClick={() => downloadStep(flow, i, rec)}><Download size={12} /></button>
                )}
                <StepState state={state} />
              </div>
              {rec?.error && <p className="mt-2 text-[11px] text-red-300">{rec.error}</p>}
              {state === 'skipped' && <p className="mt-1.5 text-[11px] text-slate-400">Its “run only if” check didn't hold{rec?.reason ? ` (${rec.reason})` : ''}.</p>}
              {rec?.ai_filled?.length > 0 && <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-[#C9C2FF]"><Sparkles size={11} aria-hidden="true" />AI filled: {rec.ai_filled.join(', ')}</p>}
              {state === 'waiting_approval' ? (
                <div className="mt-2 space-y-2">
                  {isApproval(step) && step.approval_type === 'edit'
                    ? <textarea aria-label="Content to approve" rows={6} className={field} value={edit} onChange={e => setEdit(e.target.value)} />
                    : <Output text={rec.output} />}
                  <input aria-label="Reason (if rejecting)" className={field} placeholder="Reason (if rejecting)" value={reason} onChange={e => setReason(e.target.value)} />
                  <div className="flex gap-2">
                    <button className={primary} disabled={busy} onClick={() => decide(true)}>Approve</button>
                    <button className={secondary} disabled={busy} onClick={() => decide(false)}>Reject</button>
                  </div>
                </div>
              ) : <Output text={rec?.output} />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function WorkflowTest({ flow, dirty, onSave, onRunChanged }) {
  const fields = (flow.trigger?.fields || []).filter(f => f.field)
  const [values, setValues] = useState({})
  const [text, setText] = useState('')
  const [starting, setStarting] = useState(false)
  const { run, follow, error, setError } = useRun(flow.id)

  const input = fields.length ? JSON.stringify(Object.fromEntries(fields.map(f => [f.field, values[f.field] ?? '']))) : text
  const start = async () => {
    setStarting(true); setError('')
    try {
      if (dirty) await onSave()
      follow(await startRun(flow.id, input))
      onRunChanged?.()
    } catch (e) { setError(e.message) }
    finally { setStarting(false) }
  }
  const working = starting || run?.status === 'running'

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section aria-label="Sample input" className={`${card} space-y-3`}>
        <h3 className="text-sm font-semibold text-white">Sample input</h3>
        {fields.length ? fields.map(f => (
          <label key={f.field} className="block text-[11px] font-semibold text-slate-400">{f.field}
            <input className={`${field} mt-1`} value={values[f.field] || ''} onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value }))} />
          </label>
        )) : (
          <textarea aria-label="Input text" rows={6} className={field} placeholder="What the workflow starts with…" value={text} onChange={e => setText(e.target.value)} />
        )}
        <button className={primary} disabled={working || !flow.steps.length} onClick={start}>
          {working ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
          {working ? 'Running…' : 'Run test'}
        </button>
        <p className="text-[11px] leading-snug text-slate-500">Every app step is a real run on your own AI keys. Draft steps run here only, for you and other editors of that app.{dirty ? ' Your changes are saved first.' : ''}</p>
      </section>

      <section aria-label="Test results" className={`${card} space-y-3`}>
        <h3 className="text-sm font-semibold text-white">Results</h3>
        {error && <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
        {!run && !error && <p className="text-xs text-slate-400">Run a test to see what each step produces.</p>}
        {run && <RunView flow={flow} run={run} onDecided={next => { follow(next); onRunChanged?.() }} />}
      </section>
    </div>
  )
}

// Every run of the workflow: tests, webhook and scheduled runs. Runs that
// stopped at an approval step (e.g. from the webhook) are decided here.
export function WorkflowRuns({ flow }) {
  const [runs, setRuns] = useState(null)
  const [listError, setListError] = useState('')
  const [loading, setLoading] = useState(false)
  const { run, follow, error, setError } = useRun(flow.id)

  const refresh = useCallback(async () => {
    setLoading(true); setListError('')
    try { setRuns(await listRuns(flow.id)) }
    catch (e) { setListError(e.message); setRuns(r => r || []) }
    finally { setLoading(false) }
  }, [flow.id])
  useEffect(() => { refresh() }, [refresh])
  // The list follows the open run's status.
  useEffect(() => {
    if (run) setRuns(rs => rs?.map(r => (r.id === run.id ? { ...r, status: run.status, finished_at: run.finished_at, error: run.error } : r)))
  }, [run?.id, run?.status])   // eslint-disable-line react-hooks/exhaustive-deps

  const openRun = async id => {
    setError('')
    try { follow(await getRun(flow.id, id)) }
    catch (e) { setError(e.message) }
  }
  const waitingCount = (runs || []).filter(r => r.status === 'waiting_approval').length

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section aria-label="Run history" className={`${card} space-y-3`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Runs{waitingCount ? <span className="ml-2 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300">{waitingCount} need approval</span> : null}</h3>
          <button className={tiny} onClick={refresh} disabled={loading} aria-label="Refresh runs"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        {listError && <p role="alert" className="text-[11px] text-red-300">{listError}</p>}
        {runs === null ? <p className="text-xs text-slate-400">Loading runs…</p>
          : runs.length === 0 ? <p className="text-xs text-slate-400">No runs yet. Test the workflow or turn on its webhook link.</p>
          : (
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
              {runs.map(r => (
                <li key={r.id}>
                  <button onClick={() => openRun(r.id)} aria-current={run?.id === r.id ? 'true' : undefined}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${run?.id === r.id ? 'border-[#6C5CE7]/40 bg-[#6C5CE7]/10' : 'border-white/8 bg-[#111827] hover:border-white/20'}`}>
                    <div className="flex items-center gap-2">
                      {r.status === 'running' ? <LoaderCircle size={13} className="animate-spin text-[#C9C2FF]" />
                        : r.status === 'done' ? <CircleCheck size={13} className="text-green-400" />
                        : r.status === 'waiting_approval' ? <CirclePause size={13} className="text-sky-300" />
                        : r.status === 'cancelled' ? <CircleStop size={13} className="text-slate-400" />
                        : <CircleX size={13} className="text-red-400" />}
                      <span className="flex-1 text-xs font-semibold text-white">{runLabel(r)}</span>
                      <span className="text-[10px] text-slate-400">{TRIGGER_LABEL[r.trigger] || r.trigger}</span>
                    </div>
                    <p className="mt-0.5 pl-5 text-[10px] text-slate-500">{r.started_at ? new Date(r.started_at).toLocaleString() : ''}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>
      <section aria-label="Run details" className={`${card} space-y-3`}>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {run ? <RunView flow={flow} run={run} onDecided={follow} /> : <p className="text-xs text-slate-400">Pick a run to see each step's result.</p>}
      </section>
    </div>
  )
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = n => String(n).padStart(2, '0')

// Schedules run on whole UTC hours. The picker lists those hours in the
// person's own time (e.g. 09:30 in India), and weekly days follow along.
const offsetMin = (date = new Date()) => -date.getTimezoneOffset()
const dayShift = (hourUtc, off) => Math.floor((hourUtc * 60 + off) / 1440)
export function localTimeLabel(hourUtc, off = offsetMin()) {
  const m = (((hourUtc * 60 + off) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}
export const toUtcDay = (localDay, hourUtc, off = offsetMin()) => (((localDay - dayShift(hourUtc, off)) % 7) + 7) % 7
export const toLocalDay = (utcDay, hourUtc, off = offsetMin()) => (((utcDay + dayShift(hourUtc, off)) % 7) + 7) % 7
const defaultHourUtc = (off = offsetMin()) => ((Math.round((9 * 60 - off) / 60) % 24) + 24) % 24

function WorkflowSchedule({ flow, problems, dirty }) {
  const [schedule, setSchedule] = useState(undefined)
  const [form, setForm] = useState(() => ({ frequency: 'daily', hourUtc: defaultHourUtc(), day: 1, input: '' }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => {
    let live = true
    getSchedule(flow.id).then(s => {
      if (!live) return
      setSchedule(s)
      if (s) setForm({ frequency: s.frequency, hourUtc: s.hour_utc, input: s.seed_input || '',
        day: s.day_of_week == null ? 1 : toLocalDay(s.day_of_week, s.hour_utc) })
    }).catch(e => { if (live) { setError(e.message); setSchedule(null) } })
    return () => { live = false }
  }, [flow.id])
  const save = async enabled => {
    setBusy(true); setError(''); setSaved('')
    try {
      setSchedule(await putSchedule(flow.id, {
        enabled, frequency: form.frequency, hour_utc: form.hourUtc, seed_input: form.input,
        day_of_week: form.frequency === 'weekly' ? toUtcDay(form.day, form.hourUtc) : null,
      }))
      setSaved(enabled ? 'Schedule saved' : 'Schedule paused')
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setError(''); setSaved('')
    try { await deleteSchedule(flow.id); setSchedule(null) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  const blocked = dirty || problems.length > 0
  const fields = (flow.trigger?.fields || []).filter(f => f.field)
  return (
    <section aria-label="Schedule" className={`${card} space-y-3 xl:col-span-2`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-white"><CalendarClock size={15} aria-hidden="true" /> Schedule</h3>
        {schedule && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${schedule.enabled ? 'border-green-500/25 bg-green-500/15 text-green-300' : 'border-white/10 bg-white/5 text-slate-300'}`}>
          {schedule.enabled ? 'On' : 'Paused'}</span>}
      </div>
      <p className="text-[11px] leading-snug text-slate-400">Run the workflow every day or every week, as you, on your keys, with the published releases only. Runs that reach an approval step wait under Runs and notify you.</p>
      {schedule === undefined ? <p className="text-xs text-slate-400">Loading…</p> : (
        <div className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
          <label className="text-[11px] font-semibold text-slate-400">Repeat
            <select className={`${field} mt-1`} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </select>
          </label>
          {form.frequency === 'weekly' && (
            <label className="text-[11px] font-semibold text-slate-400">On
              <select className={`${field} mt-1`} value={form.day} onChange={e => setForm(f => ({ ...f, day: Number(e.target.value) }))}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
          )}
          <label className="text-[11px] font-semibold text-slate-400">At (your time)
            <select className={`${field} mt-1`} value={form.hourUtc} onChange={e => setForm(f => ({ ...f, hourUtc: Number(e.target.value) }))}>
              {Array.from({ length: 24 }, (_, h) => h).sort((a, b) => localTimeLabel(a).localeCompare(localTimeLabel(b)))
                .map(h => <option key={h} value={h}>{localTimeLabel(h)}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-slate-400 sm:col-span-3">Input each run starts with{fields.length ? ` (JSON with ${fields.map(f => f.field).join(', ')})` : ''}
            <textarea rows={3} className={`${field} mt-1`} value={form.input} onChange={e => setForm(f => ({ ...f, input: e.target.value }))}
              placeholder={fields.length ? JSON.stringify(Object.fromEntries(fields.map(f => [f.field, '…']))) : 'What each run starts with'} />
          </label>
        </div>
      )}
      {schedule?.next_run_at && schedule.enabled && <p className="text-[11px] text-slate-400">Next run: {new Date(schedule.next_run_at).toLocaleString()}{schedule.last_run_at ? ` · last run ${new Date(schedule.last_run_at).toLocaleString()}` : ''}</p>}
      {blocked && <p className="text-[11px] text-amber-200">{dirty ? 'Save your changes first.' : 'Fix the release checks first: scheduled runs use published releases only.'}</p>}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      {saved && <p role="status" className="text-xs text-green-300">{saved}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy || blocked || schedule === undefined} onClick={() => save(true)}>{schedule ? 'Save schedule' : 'Turn on schedule'}</button>
        {schedule?.enabled && <button className={secondary} disabled={busy} onClick={() => save(false)}>Pause</button>}
        {schedule && <button className={secondary} disabled={busy} onClick={remove}>Remove schedule</button>}
      </div>
    </section>
  )
}

export function WorkflowDeploy({ flow, schemas, dirty, onTokenChange }) {
  const problems = releaseProblems(flow, schemas)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const toggle = async on => {
    setBusy(true); setError('')
    try { onTokenChange(await setWebhook(flow.id, on)) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  const url = flow.webhook_token ? webhookUrl(flow.webhook_token) : ''
  const sample = JSON.stringify(Object.fromEntries((flow.trigger?.fields || []).filter(f => f.field).map(f => [f.field, '…'])))
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section aria-label="Release checks" className={`${card} space-y-3`}>
        <h3 className="text-sm font-semibold text-white">Release checks</h3>
        {problems.length === 0 && !dirty ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-green-300"><CircleCheck size={14} /> Ready: every step uses a published release and its inputs are connected.</p>
        ) : (
          <ul className="space-y-1.5">
            {dirty && <li className="flex gap-1.5 text-xs text-amber-200"><CircleAlert size={14} className="mt-px shrink-0" /> Save your changes first.</li>}
            {problems.map((p, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-amber-200"><CircleAlert size={14} className="mt-px shrink-0" />
                {p.step != null ? `Step ${p.step + 2} (${flow.steps[p.step]?.app_name}): ` : ''}{p.text}</li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Webhook link" className={`${card} space-y-3`}>
        <h3 className="text-sm font-semibold text-white">Webhook link</h3>
        <p className="text-[11px] leading-snug text-slate-400">Other systems start the workflow by sending a POST to this link. It runs as you, on your keys, with the published releases only. Runs that reach an approval step wait under Runs.</p>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {url ? (
          <>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-[#0E1424] px-2.5 py-1.5 text-[11px] text-slate-200">{url}</code>
              <button className={secondary} onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
                <Copy size={13} /> {copied ? 'Copied' : 'Copy'}</button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-white/8 bg-[#0E1424] p-2.5 text-[11px] text-slate-300">{`curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '${sample === '{}' ? '{"input": "…"}' : sample}'`}</pre>
            <button className={secondary} disabled={busy} onClick={() => toggle(false)}>Turn off link</button>
          </>
        ) : (
          <button className={primary} disabled={busy || dirty || problems.length > 0} onClick={() => toggle(true)}>Turn on webhook link</button>
        )}
      </section>
      <WorkflowSchedule flow={flow} problems={problems} dirty={dirty} />
    </div>
  )
}
