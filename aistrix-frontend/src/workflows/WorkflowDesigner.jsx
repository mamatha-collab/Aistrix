import { Fragment, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, GitBranch, Play, Plus, Sparkles, Trash2, UserCheck, Webhook, Wand2, X } from 'lucide-react'
import {
  CONDITION_OPS, FIELD_TYPES, TRANSFORMS, autoMap, conditionLabel, inputFields, schemaKey, isApiCall, isApproval, isAppStep, newApprovalStep, newAppStep,
  sourceOptions, stepIssues, typeFit, versionLabel,
} from './workflowModel'
import { fetchVersions } from './workflowApi'
import ConfirmDialog from '../components/ConfirmDialog'

const fieldBase = 'min-w-0 rounded-lg border border-white/10 bg-[#0E1424] px-2.5 py-1.5 text-xs text-white focus:border-[#6C5CE7] focus:outline-none'
const field = `w-full ${fieldBase}`
const smallBtn = 'inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-40'
const CHIP = {
  trigger: 'bg-[#6C5CE7]/15 text-[#A29BFE] border-[#6C5CE7]/30',
  published: 'bg-green-500/15 text-green-300 border-green-500/25',
  draft: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  approval: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
  api: 'bg-slate-500/15 text-slate-300 border-white/10',
}

function Chip({ kind, children }) {
  return <span className={`inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold ${CHIP[kind]}`}>{children}</span>
}

function StepCard({ number, icon, title, chip, chipKind, subtitle, selected, issues = [], branch, onClick }) {
  const errors = issues.filter(i => i.level === 'error').length
  const warns = issues.length - errors
  return (
    <button onClick={onClick} aria-pressed={selected}
      className={`relative w-44 shrink-0 rounded-2xl border p-3 pt-4 text-center transition-colors ${
        selected ? 'border-[#6C5CE7] bg-[#6C5CE7]/10 shadow-[0_0_0_3px_rgba(108,92,231,0.18)]' : 'border-white/10 bg-[#171B33] hover:border-white/25'}`}>
      <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 text-[10px] font-bold text-slate-300">{number}</span>
      {branch && (
        <span title={`Runs only if ${branch}`} className="absolute -top-2.5 left-1/2 inline-flex max-w-[90%] -translate-x-1/2 items-center gap-1 truncate rounded-full border border-[#6C5CE7]/40 bg-[#111827] px-2 py-0.5 text-[10px] font-semibold text-[#C9C2FF]">
          <GitBranch size={10} aria-hidden="true" className="shrink-0" /><span className="truncate">If {branch}</span>
        </span>
      )}
      {(errors > 0 || warns > 0) && (
        <span title={`${errors} problem${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`}
          className={`absolute right-2 top-2 ${errors ? 'text-red-400' : 'text-amber-400'}`}><CircleAlert size={14} aria-hidden="true" /></span>
      )}
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#0E1424] text-lg text-[#A29BFE]">{icon}</span>
      <p className="mt-2 truncate text-sm font-semibold text-white">{title}</p>
      <div className="mt-1"><Chip kind={chipKind}>{chip}</Chip></div>
      {subtitle && <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-slate-400">{subtitle}</p>}
    </button>
  )
}

function Connector({ onAddApp, onAddApproval, last }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`relative flex shrink-0 items-center ${last ? 'w-16' : 'w-14'}`}>
      <span className="h-px flex-1 bg-white/15" />
      <button onClick={() => setOpen(o => !o)} aria-label="Add a step here" aria-expanded={open}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-[#0E1424] text-slate-300 hover:border-[#6C5CE7] hover:text-white">
        <Plus size={13} aria-hidden="true" />
      </button>
      {!last && <span className="h-px flex-1 bg-white/15" />}
      {open && (
        <div role="menu" className="absolute left-1/2 top-9 z-20 w-40 -translate-x-1/2 rounded-xl border border-white/10 bg-[#111827] p-1 shadow-xl">
          <button role="menuitem" onClick={() => { setOpen(false); onAddApp() }} className="w-full rounded-lg px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5">App step</button>
          <button role="menuitem" onClick={() => { setOpen(false); onAddApproval() }} className="w-full rounded-lg px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5">Approval</button>
        </div>
      )}
    </div>
  )
}

export function WorkflowCanvas({ flow, apps, schemas, selected, onSelect, onChange }) {
  const appById = new Map(apps.map(a => [a.id, a]))
  const insertAt = (i, step) => {
    const steps = [...flow.steps]
    steps.splice(i, 0, step)
    onChange({ ...flow, steps })
    onSelect(i)
  }
  const trigger = flow.trigger || {}
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start px-1 pb-2 pt-4">
        <StepCard number={1} icon={trigger.type === 'webhook' ? <Webhook size={18} /> : <Play size={18} />}
          title={trigger.type === 'webhook' ? 'Webhook' : 'Manual start'} chip="Trigger" chipKind="trigger"
          subtitle={(trigger.fields || []).length ? `Brings ${(trigger.fields || []).map(f => f.field).filter(Boolean).join(', ')}` : 'Starts with text input'}
          selected={selected === 'trigger'} onClick={() => onSelect('trigger')} />
        {flow.steps.map((step, i) => {
          const app = appById.get(step.app_id)
          const issues = stepIssues(flow, i, schemas)
          return (
            <Fragment key={step.id}>
              <div className="flex h-[132px] items-center">
                <Connector onAddApp={() => insertAt(i, newAppStep(flow.steps, null))} onAddApproval={() => insertAt(i, newApprovalStep(flow.steps))} />
              </div>
              {isApproval(step) ? (
                <StepCard number={i + 2} icon={<UserCheck size={18} />} title={step.app_name || 'Review & approve'} chip="Approval" chipKind="approval"
                  subtitle={step.approval_type === 'edit' ? 'A person reviews and can edit before it continues' : 'A person approves before it continues'}
                  branch={conditionLabel(step.run_if)} selected={selected === i} onClick={() => onSelect(i)} />
              ) : isApiCall(step) ? (
                <StepCard number={i + 2} icon="🔗" title={step.app_name || 'API call'} chip={`${step.api_method || 'GET'} request`} chipKind="api"
                  subtitle={step.api_url} branch={conditionLabel(step.run_if)} selected={selected === i} onClick={() => onSelect(i)} />
              ) : (
                <StepCard number={i + 2} icon={app?.emoji || step.app_emoji || '✨'} title={app?.name || step.app_name || 'Choose an app'}
                  chip={step.app_id ? versionLabel(step) : 'Not set up'} chipKind={step.version === 'draft' || !step.app_id ? 'draft' : 'published'}
                  subtitle={app?.description} issues={issues} branch={conditionLabel(step.run_if)} selected={selected === i} onClick={() => onSelect(i)} />
              )}
            </Fragment>
          )
        })}
        <div className="flex h-[132px] items-center">
          <Connector last onAddApp={() => insertAt(flow.steps.length, newAppStep(flow.steps, null))}
            onAddApproval={() => insertAt(flow.steps.length, newApprovalStep(flow.steps))} />
        </div>
      </div>
    </div>
  )
}

// ── Settings panel for the selected card ────────────────────────────────────

function TriggerSettings({ flow, onChange }) {
  const trigger = flow.trigger || { type: 'manual', fields: [] }
  const set = patch => onChange({ ...flow, trigger: { ...trigger, ...patch } })
  const fields = trigger.fields || []
  const setField = (i, patch) => set({ fields: fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  return (
    <div className="space-y-4">
      <label className="block text-[11px] font-semibold text-slate-400">Starts
        <select className={`${field} mt-1`} value={trigger.type} onChange={e => set({ type: e.target.value })}>
          <option value="manual">Manually (Test, or from Business)</option>
          <option value="webhook">From a webhook (link in Deploy)</option>
        </select>
      </label>
      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-slate-400">Input fields</p>
        <p className="text-[11px] leading-snug text-slate-500">Fields the run starts with (a webhook sends them as JSON). Later steps connect to them. Without fields, steps can use the whole input text.</p>
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input aria-label="Field name" className={field} placeholder="email" value={f.field || ''}
              onChange={e => setField(i, { field: e.target.value.replace(/[^A-Za-z0-9_]/g, '_') })} />
            <select aria-label="Field type" className={`${fieldBase} w-24 shrink-0`} value={f.type || 'string'} onChange={e => setField(i, { type: e.target.value })}>
              {FIELD_TYPES.map(t => <option key={t} value={t}>{t === 'string' ? 'text' : t}</option>)}
            </select>
            <button aria-label={`Remove ${f.field || 'field'}`} onClick={() => set({ fields: fields.filter((_, j) => j !== i) })} className="text-slate-500 hover:text-red-400"><X size={14} /></button>
          </div>
        ))}
        <button className={smallBtn} onClick={() => set({ fields: [...fields, { field: '', type: 'string' }] })}><Plus size={12} /> Add field</button>
      </div>
    </div>
  )
}

function StepOrder({ flow, index, onChange, onSelect }) {
  const move = delta => {
    const steps = [...flow.steps]
    const [step] = steps.splice(index, 1)
    steps.splice(index + delta, 0, step)
    onChange({ ...flow, steps })
    onSelect(index + delta)
  }
  const [confirming, setConfirming] = useState(false)
  const step = flow.steps[index]
  const name = isApproval(step) ? (step.app_name || 'this approval step') : (step.app_name && step.app_id ? step.app_name : 'this step')
  // Later steps wired to this one lose those connections.
  const dependents = flow.steps.filter((s, i) => i > index && Object.values(s.input_map || {}).some(w => String(w?.from || '').startsWith(`${step.id}.`))).length
  const remove = () => {
    setConfirming(false)
    onChange({ ...flow, steps: flow.steps.filter((_, i) => i !== index) })
    onSelect('trigger')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {confirming && (
        <ConfirmDialog title={`Remove ${name} from the workflow?`} confirmLabel="Remove step" danger
          onCancel={() => setConfirming(false)} onConfirm={remove}>
          {dependents
            ? `${dependents} later step${dependents === 1 ? ' is' : 's are'} connected to it and will need new connections.`
            : isApproval(step) ? 'Nothing else in the workflow changes.' : "The app itself isn't changed."} The workflow is only changed when you save it.
        </ConfirmDialog>
      )}
      <button className={smallBtn} disabled={index === 0} onClick={() => move(-1)}><ArrowLeft size={12} /> Earlier</button>
      <button className={smallBtn} disabled={index === flow.steps.length - 1} onClick={() => move(1)}>Later <ArrowRight size={12} /></button>
      <button className={`${smallBtn} text-red-300 hover:text-red-200`} onClick={() => setConfirming(true)}><Trash2 size={12} /> Remove step</button>
    </div>
  )
}

// "Run only if": a step with a check runs only when it holds, otherwise it's
// skipped. Two steps with opposite checks are two branches.
function StepCondition({ flow, index, schemas, onChange }) {
  const step = flow.steps[index]
  const cond = step.run_if || null
  const set = next => onChange({ ...flow, steps: flow.steps.map((s, i) => {
    if (i !== index) return s
    const { run_if: _drop, ...rest } = s
    return next ? { ...rest, run_if: next } : rest
  }) })
  const options = sourceOptions(flow, index, schemas)
  const groups = [...new Set(options.map(o => o.group))]
  const op = CONDITION_OPS.find(o => o.id === (cond?.op || 'equals'))
  return (
    <div className="space-y-2 rounded-xl border border-white/8 bg-[#0E1424]/60 px-3 py-2.5">
      <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-300">
        <input type="checkbox" checked={!!cond} onChange={e => set(e.target.checked ? { from: options[0]?.value || 'trigger.text', op: 'equals', value: '' } : null)} />
        <GitBranch size={12} aria-hidden="true" /> Run only if…
      </label>
      {cond && (
        <div className="space-y-1.5">
          <select aria-label="Check this value" className={field} value={cond.from} onChange={e => set({ ...cond, from: e.target.value })}>
            {groups.map(g => (
              <optgroup key={g} label={g}>
                {options.filter(o => o.group === g).map(o => <option key={o.value} value={o.value}>{g === 'Trigger' ? 'Trigger' : g.split('. ')[1]}.{o.label}</option>)}
              </optgroup>
            ))}
          </select>
          <div className="flex gap-1.5">
            <select aria-label="Comparison" className={`${fieldBase} w-32 shrink-0`} value={cond.op || 'equals'} onChange={e => set({ ...cond, op: e.target.value })}>
              {CONDITION_OPS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {!op?.noValue && <input aria-label="Compare with" className={field} placeholder="value" value={cond.value ?? ''} onChange={e => set({ ...cond, value: e.target.value })} />}
          </div>
          <input aria-label="Branch name" className={field} placeholder="Branch name (e.g. Qualified)" value={cond.label || ''} onChange={e => set({ ...cond, label: e.target.value })} />
          <p className="text-[10px] leading-snug text-slate-500">When the check fails the step is skipped and the run goes on. Give another step the opposite check to make a second branch.</p>
        </div>
      )}
    </div>
  )
}

function ApprovalSettings({ flow, index, schemas, onChange, onSelect }) {
  const step = flow.steps[index]
  const set = patch => onChange({ ...flow, steps: flow.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
  return (
    <div className="space-y-4">
      <label className="block text-[11px] font-semibold text-slate-400">Name
        <input className={`${field} mt-1`} value={step.app_name || ''} onChange={e => set({ app_name: e.target.value })} />
      </label>
      <label className="block text-[11px] font-semibold text-slate-400">The reviewer can
        <select className={`${field} mt-1`} value={step.approval_type || 'approve'} onChange={e => set({ approval_type: e.target.value })}>
          <option value="approve">Approve or reject</option>
          <option value="edit">Edit, then approve or reject</option>
        </select>
      </label>
      <p className="text-[11px] leading-snug text-slate-500">The run pauses here. Approve it in Test; webhook and scheduled runs wait under Runs, and you get a notification.</p>
      <StepCondition flow={flow} index={index} schemas={schemas} onChange={onChange} />
      <StepOrder flow={flow} index={index} onChange={onChange} onSelect={onSelect} />
    </div>
  )
}

const versionCache = new Map()

function AppStepSettings({ flow, index, apps, schemas, onChange, onSelect }) {
  const step = flow.steps[index]
  const app = apps.find(a => a.id === step.app_id)
  const [versions, setVersions] = useState(() => versionCache.get(step.app_id) || null)
  const set = patch => onChange({ ...flow, steps: flow.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) })

  useEffect(() => {
    let live = true
    if (!step.app_id) { setVersions(null); return undefined }
    if (versionCache.has(step.app_id)) { setVersions(versionCache.get(step.app_id)); return undefined }
    setVersions(null)
    fetchVersions(step.app_id)
      .then(v => { versionCache.set(step.app_id, v.versions || []); if (live) setVersions(v.versions || []) })
      .catch(() => { if (live) setVersions([]) })
    return () => { live = false }
  }, [step.app_id])

  const chooseApp = id => {
    const next = apps.find(a => a.id === id)
    set({ app_id: id || null, app_name: next?.name || 'Choose an app', app_emoji: next?.emoji || null, input_map: {},
      version: next?.is_published ? 'published' : 'draft', pinned_version: next?.is_published ? (next.live_version || null) : null })
  }
  const versionValue = step.version === 'draft' ? 'draft' : String(step.pinned_version || 'live')
  const chooseVersion = v => set(v === 'draft' ? { version: 'draft', pinned_version: null }
    : { version: 'published', pinned_version: v === 'live' ? null : Number(v) })

  const targets = inputFields(step, schemas)
  const options = sourceOptions(flow, index, schemas)
  const groups = [...new Set(options.map(o => o.group))]
  const byValue = new Map(options.map(o => [o.value, o]))
  const map = step.input_map || {}
  const issues = stepIssues(flow, index, schemas)
  const setWire = (target, wire) => {
    const next = { ...map }
    if (wire) next[target] = wire
    else delete next[target]
    set({ input_map: next })
  }
  const loading = step.app_id && !(schemaKey(step) in schemas)

  return (
    <div className="space-y-4">
      <label className="block text-[11px] font-semibold text-slate-400">App
        <select className={`${field} mt-1`} value={step.app_id || ''} onChange={e => chooseApp(e.target.value)}>
          <option value="">Choose an app…</option>
          {apps.map(a => <option key={a.id} value={a.id}>{a.emoji ? `${a.emoji} ` : ''}{a.name}{a.is_published ? '' : ' (not published)'}</option>)}
        </select>
      </label>
      {step.app_id && (
        <label className="block text-[11px] font-semibold text-slate-400">Version
          <select className={`${field} mt-1`} value={versionValue} onChange={e => chooseVersion(e.target.value)}>
            {app?.is_published && <option value="live">Published · whatever is live{app.live_version ? ` (now v${app.live_version})` : ''}</option>}
            {(versions || []).map(v => <option key={v.version_num} value={String(v.version_num)}>Published · v{v.version_num}{v.is_live ? ' (live)' : ''}</option>)}
            <option value="draft">Draft · testing only</option>
          </select>
          {versions === null && <span className="mt-1 block text-[10px] text-slate-500">Loading releases…</span>}
        </label>
      )}

      {step.app_id && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-slate-400">Input mapping</p>
            {targets.length > 0 && <button className={smallBtn} onClick={() => set({ input_map: autoMap(targets, options, map) })}><Wand2 size={12} /> Auto-connect</button>}
          </div>
          {loading ? <p className="text-[11px] text-slate-500">Loading the app's fields…</p>
            : targets.length === 0 ? (
              <p className="text-[11px] leading-snug text-slate-500">This app takes free text: it gets the previous step's whole output{index === 0 ? ' (the trigger input)' : ''}. Declare input fields in its Design → schema to connect fields one by one.</p>
            ) : targets.map(t => {
              const wire = map[t.field]
              const src = wire?.from ? byValue.get(wire.from) : null
              const problem = issues.find(i => i.field === t.field)
              const fixed = wire && 'value' in wire
              return (
                <div key={t.field} className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-24 shrink-0 truncate text-xs text-slate-200" title={`${t.field} (${t.type})${t.label ? ` — ${t.label}` : ''}`}>
                      {t.field}{t.required && <span className="text-red-400">*</span>}
                    </span>
                    <span className="text-slate-500" aria-hidden="true">←</span>
                    {fixed ? (
                      <input aria-label={`${t.field} fixed value`} className={field} value={wire.value} onChange={e => setWire(t.field, { value: e.target.value })} />
                    ) : (
                      <select aria-label={`${t.field} comes from`} className={field} value={wire?.from || ''}
                        onChange={e => e.target.value === '__fixed' ? setWire(t.field, { value: '' })
                          : setWire(t.field, e.target.value ? { from: e.target.value, ...(wire?.transform ? { transform: wire.transform } : {}) } : null)}>
                        <option value="">Not connected</option>
                        {groups.map(g => (
                          <optgroup key={g} label={g}>
                            {options.filter(o => o.group === g).map(o => <option key={o.value} value={o.value}>{g === 'Trigger' ? 'Trigger' : g.split('. ')[1]}.{o.label}</option>)}
                          </optgroup>
                        ))}
                        <option value="__fixed">Fixed value…</option>
                      </select>
                    )}
                    {fixed && <button aria-label="Connect instead" onClick={() => setWire(t.field, null)} className="text-slate-500 hover:text-white"><X size={14} /></button>}
                    <span className={problem ? (problem.level === 'error' ? 'text-red-400' : 'text-amber-400') : 'text-green-400'} title={problem?.text || 'Connected'}>
                      {problem ? <CircleAlert size={13} /> : wire ? <CircleCheck size={13} /> : null}
                    </span>
                  </div>
                  {src && typeFit(src.type, t.type) === 'lossy' && !wire.transform && (
                    <p className="pl-[7.5rem] text-[10px] text-amber-300">Gets {src.type}, expects {t.type}: pick a conversion under Advanced.</p>
                  )}
                </div>
              )
            })}
          {targets.length > 0 && (
            <label className="flex items-start gap-2 pt-1 text-[11px] text-slate-300">
              <input type="checkbox" className="mt-0.5" checked={!!step.ai_fill} onChange={e => set({ ai_fill: e.target.checked || undefined })} />
              <span><Sparkles size={11} className="mr-1 inline text-[#A29BFE]" aria-hidden="true" />Fill unconnected fields with AI
                <span className="block text-[10px] text-slate-500">When a field isn't connected, a small AI call finds it in the trigger and earlier results. It uses your own key and never invents values.</span></span>
            </label>
          )}
        </div>
      )}

      {step.app_id && <StepCondition flow={flow} index={index} schemas={schemas} onChange={onChange} />}

      <details className="rounded-xl border border-white/8 bg-[#0E1424]/60 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-semibold text-slate-400">Advanced</summary>
        <div className="mt-3 space-y-3">
          {Object.entries(map).filter(([, w]) => w?.from).map(([target, w]) => (
            <label key={target} className="flex items-center gap-2 text-[11px] text-slate-300">
              <span className="w-24 shrink-0 truncate">{target}</span>
              <select className={field} value={w.transform || ''} onChange={e => setWire(target, { from: w.from, ...(e.target.value ? { transform: e.target.value } : {}) })}>
                {TRANSFORMS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          ))}
          <StepOrder flow={flow} index={index} onChange={onChange} onSelect={onSelect} />
        </div>
      </details>
    </div>
  )
}

export function StepSettings({ flow, selected, apps, schemas, onChange, onSelect }) {
  const step = selected === 'trigger' ? null : flow.steps[selected]
  const title = selected === 'trigger' ? 'Trigger' : isApproval(step) ? 'Approval' : step?.app_name || 'Step'
  return (
    <aside aria-label="Step settings" className="w-full shrink-0 space-y-4 rounded-2xl border border-white/8 bg-[#111827] p-4 xl:w-80">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#0E1424] text-[#A29BFE]">
          {selected === 'trigger' ? <Play size={15} /> : isApproval(step) ? <UserCheck size={15} /> : <span className="text-base">{step?.app_emoji || '✨'}</span>}
        </span>
        <h3 className="min-w-0 truncate text-sm font-semibold text-white">{title}</h3>
      </div>
      {selected === 'trigger' ? <TriggerSettings flow={flow} onChange={onChange} />
        : !step ? null
        : isApproval(step) ? <ApprovalSettings flow={flow} index={selected} schemas={schemas} onChange={onChange} onSelect={onSelect} />
        : isAppStep(step) ? <AppStepSettings key={step.id} flow={flow} index={selected} apps={apps} schemas={schemas} onChange={onChange} onSelect={onSelect} />
        : <div className="space-y-3"><p className="text-xs text-slate-400">API call steps are edited in Business flows for now.</p><StepOrder flow={flow} index={selected} onChange={onChange} onSelect={onSelect} /></div>}
    </aside>
  )
}
