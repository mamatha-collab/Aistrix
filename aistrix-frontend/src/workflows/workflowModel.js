// Developer workflows (Dev Studio → Workflows): the steps, their wiring and
// what stops a workflow from being released. Pure functions, no I/O.
// The server runs the same wiring (main.py resolve_input_map) and checks
// every step's input again when it runs.

export const FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'array', 'object']

export const TRANSFORMS = [
  { id: '', label: 'As is' },
  { id: 'to_text', label: 'As text' },
  { id: 'to_number', label: 'As number' },
  { id: 'to_boolean', label: 'As yes/no' },
  { id: 'json', label: 'Parse JSON' },
]

export const DEFAULT_TRIGGER = { type: 'manual', fields: [] }

// "Run only if" checks (the server's flow_condition_met). Steps whose check
// fails are skipped, which is how a workflow branches.
export const CONDITION_OPS = [
  { id: 'equals', label: 'is', symbol: '=' },
  { id: 'not_equals', label: 'is not', symbol: '≠' },
  { id: 'contains', label: 'contains', symbol: '∋' },
  { id: 'gt', label: 'is more than', symbol: '>' },
  { id: 'gte', label: 'is at least', symbol: '≥' },
  { id: 'lt', label: 'is less than', symbol: '<' },
  { id: 'lte', label: 'is at most', symbol: '≤' },
  { id: 'empty', label: 'is empty', symbol: 'empty', noValue: true },
  { id: 'not_empty', label: 'has a value', symbol: 'has value', noValue: true },
]

// Short text for the canvas: the branch name, or the check itself.
export function conditionLabel(cond) {
  if (!cond?.from) return null
  if (cond.label?.trim()) return cond.label.trim()
  const op = CONDITION_OPS.find(o => o.id === (cond.op || 'equals'))
  const field = String(cond.from).split('.').slice(1).join('.') || cond.from
  return `${field} ${op?.symbol || '='}${op?.noValue ? '' : ` ${cond.value ?? ''}`}`.trim()
}

export const isApproval = step => step?.step_type === 'human_approval'
export const isApiCall = step => step?.step_type === 'api_call'
export const isAppStep = step => !!step && !step.step_type

export function newStepId(steps = []) {
  const used = new Set(steps.map(s => s?.id).filter(Boolean))
  let n = steps.length + 1
  while (used.has(`s${n}`)) n += 1
  return `s${n}`
}

// Old flows had no step ids; wiring needs them.
export function withStepIds(steps = []) {
  const used = new Set(steps.map(s => s?.id).filter(Boolean))
  let n = 0
  return steps.map(s => {
    if (s?.id) return s
    do { n += 1 } while (used.has(`s${n}`))
    used.add(`s${n}`)
    return { ...s, id: `s${n}` }
  })
}

export function newAppStep(steps, app) {
  return {
    id: newStepId(steps), app_id: app?.id || null, app_name: app?.name || 'Choose an app', app_emoji: app?.emoji || null,
    version: app?.is_published ? 'published' : 'draft', pinned_version: app?.is_published ? (app.live_version || null) : null,
    input_map: {},
  }
}

export function newApprovalStep(steps) {
  return { id: newStepId(steps), step_type: 'human_approval', approval_type: 'approve', app_name: 'Review & approve' }
}

// Which schema a step runs with: the draft, a pinned release, or whatever is live.
export function schemaVersion(step) {
  if (step?.version === 'draft') return 'draft'
  return step?.pinned_version ? String(step.pinned_version) : 'live'
}

export const schemaKey = step => (isAppStep(step) && step.app_id ? `${step.app_id}@${schemaVersion(step)}` : null)

export function versionLabel(step) {
  if (!isAppStep(step)) return null
  if (step.version === 'draft') return 'Draft · editors only'
  return step.pinned_version ? `Published · v${step.pinned_version}` : 'Published · live'
}

const fieldName = f => f?.field || f?.name

// Fields a step produces for later steps. Anything without declared
// structured fields still offers its whole output as "text".
export function outputFields(step, schemas) {
  const schema = schemas[schemaKey(step)]
  const declared = isAppStep(step) && schema?.structured ? (schema.output || []) : []
  return [...declared.map(f => ({ field: fieldName(f), type: f.type || 'string' })), { field: 'text', type: 'string', whole: true }]
}

export function inputFields(step, schemas) {
  const schema = schemas[schemaKey(step)]
  return (schema?.input || []).map(f => ({ field: fieldName(f), type: f.type || 'string', required: f.required !== false, label: f.label || f.description }))
    .filter(f => f.field)
}

// Wiring choices for step idx: the trigger's fields, then earlier steps.
export function sourceOptions(flow, idx, schemas) {
  const options = []
  const trigger = flow.trigger || DEFAULT_TRIGGER
  for (const f of trigger.fields || []) if (f.field) options.push({ value: `trigger.${f.field}`, group: 'Trigger', label: f.field, type: f.type || 'string' })
  options.push({ value: 'trigger.text', group: 'Trigger', label: 'whole input', type: 'string' })
  ;(flow.steps || []).slice(0, idx).forEach((s, i) => {
    const group = `${i + 1}. ${s.app_name || 'Step'}`
    for (const f of outputFields(s, schemas)) options.push({ value: `${s.id}.${f.field}`, group, label: f.whole ? 'whole output' : f.field, type: f.type })
  })
  return options
}

// How safely a value of one type goes into a field of another.
export function typeFit(from, to) {
  if (!from || !to || from === to || to === 'string') return 'ok'   // anything can be text
  return 'lossy'   // text → number/date/yes-no etc. may not convert at run time
}

export const TRANSFORM_FOR = { number: 'to_number', boolean: 'to_boolean', object: 'json', array: 'json' }

// Suggest wires by field name (exact, then case/underscore-insensitive).
export function autoMap(targets, options, current = {}) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const next = { ...current }
  for (const t of targets) {
    if (next[t.field]) continue
    const exact = [...options].reverse().find(o => o.label === t.field)
    const loose = exact || [...options].reverse().find(o => norm(o.label) === norm(t.field))
    if (loose) {
      const transform = typeFit(loose.type, t.type) === 'lossy' ? TRANSFORM_FOR[t.type] : undefined
      next[t.field] = transform ? { from: loose.value, transform } : { from: loose.value }
    }
  }
  return next
}

// Problems with one step: { level: 'error' | 'warn', text, field? }.
// Errors stop a test from making sense; warnings (and drafts) stop release.
export function stepIssues(flow, idx, schemas) {
  const step = flow.steps[idx]
  const issues = []
  const cond = step.run_if
  if (cond?.from) {
    const known = new Set(sourceOptions(flow, idx, schemas).map(o => o.value))
    const loading = (flow.steps || []).slice(0, idx).some(s => schemaKey(s) && !(schemaKey(s) in schemas))
    if (!loading && !known.has(cond.from)) issues.push({ level: 'error', text: 'Its "run only if" check uses something that no longer exists.' })
    const op = CONDITION_OPS.find(o => o.id === (cond.op || 'equals'))
    if (!op?.noValue && String(cond.value ?? '').trim() === '') issues.push({ level: 'error', text: 'Its "run only if" check needs a value to compare with.' })
  }
  if (isApproval(step) || isApiCall(step)) return issues
  if (!step.app_id) return [{ level: 'error', text: 'Choose an app for this step.' }]
  if (step.version === 'draft') issues.push({ level: 'warn', draft: true, text: 'Uses a draft. Switch to a published version before release.' })
  const key = schemaKey(step)
  if (!(key in schemas)) return issues
  if (schemas[key]?.error) return [...issues, { level: 'error', text: schemas[key].error }]
  const options = sourceOptions(flow, idx, schemas)
  const byValue = new Map(options.map(o => [o.value, o]))
  const map = step.input_map || {}
  for (const f of inputFields(step, schemas)) {
    const wire = map[f.field]
    if (!wire) {
      if (f.required && !step.ai_fill) issues.push({ level: 'error', field: f.field, text: `"${f.field}" isn't connected.` })
      continue
    }
    if ('value' in wire) continue
    const src = byValue.get(wire.from)
    if (!src) issues.push({ level: 'error', field: f.field, text: `"${f.field}" is connected to something that no longer exists.` })
    else if (typeFit(src.type, f.type) === 'lossy' && !wire.transform) issues.push({ level: 'warn', field: f.field, text: `"${f.field}" expects ${f.type} but gets ${src.type}. Pick a conversion under Advanced.` })
    else {
      const from = (flow.steps || []).find(s => wire.from.startsWith(`${s.id}.`))
      if (from?.run_if?.from && f.required && !step.run_if?.from && !step.ai_fill) {
        issues.push({ level: 'warn', field: f.field, text: `"${f.field}" comes from a step that may be skipped (it runs only if ${conditionLabel(from.run_if)}).` })
      }
    }
  }
  return issues
}

export function workflowIssues(flow, schemas) {
  const issues = []
  if (!(flow.steps || []).length) issues.push({ level: 'error', step: null, text: 'Add a step after the trigger.' })
  ;(flow.steps || []).forEach((_, i) => {
    for (const issue of stepIssues(flow, i, schemas)) issues.push({ ...issue, step: i })
  })
  return issues
}

// Release = runs unattended (webhook): no errors and no draft steps.
export function releaseProblems(flow, schemas) {
  return workflowIssues(flow, schemas).filter(i => i.level === 'error' || i.draft)
}
