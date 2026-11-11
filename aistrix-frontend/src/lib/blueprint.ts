import type { App, Blueprint, BlueprintInput, SchemaField, OutputContract, DeploymentPlan } from '../types/application'
import { isRecord } from '../types/domain'
import { inferPromptOutputFormat } from '../utils/starterBlueprint'
import { isFileApp } from './fileApps'
export function validInputFields(bp: Blueprint) {
  return (bp.inputs || []).filter(f =>
    f?.key?.trim() &&
    /^[a-z][a-z0-9_]*$/.test(f.key.trim()) &&
    f?.label?.trim() &&
    f?.type
  )
}

export function invalidInputFields(bp: Blueprint) {
  return (bp.inputs || []).filter(f =>
    !f?.key?.trim() ||
    !/^[a-z][a-z0-9_]*$/.test(f.key.trim()) ||
    !f?.label?.trim() ||
    !f?.type
  )
}

// ─── Schema utilities ─────────────────────────────────────────────────────────

const SCALAR_TYPES = ['string','number','boolean','string_array','number_array','enum']
export const ALL_FIELD_TYPES = [...SCALAR_TYPES, 'object']

// Map blueprint input types → schema field types
const INPUT_TO_SCHEMA: Record<string, string> = {
  short_text: 'string', long_text: 'string', url: 'string', date: 'string',
  number: 'number', boolean: 'boolean',
  select: 'enum', multi_select: 'string_array',
  json: 'object', csv: 'string_array',
  file: 'string', image: 'string', audio: 'string', video: 'string', document: 'string',
}

export function inputsToSchema(inputs: BlueprintInput[] = []): SchemaField[] {
  return inputs.map(f => ({
    field: f.key, type: INPUT_TO_SCHEMA[f.type] || 'string',
    description: f.label, required: f.required !== false,
    enum_values: f.options || [],
  }))
}

function schemaToInputFields(fields: SchemaField[] = []): BlueprintInput[] {
  return fields.map(f => ({
    key: f.field || f.name || '',
    label: f.label || f.description || f.field || f.name || '',
    type: f.type === 'number' ? 'number'
      : f.type === 'boolean' ? 'boolean'
      : f.type === 'enum' ? 'select'
      : f.type === 'string_array' ? 'multi_select'
      : f.type === 'object' ? 'json'
      : 'short_text',
    required: f.required !== false,
    pii: !!f.pii,
    placeholder: f.placeholder || '',
    options: f.enum_values || [],
  }))
}

export function getInputSchemaFields(bp: Blueprint = {}) {
  return bp.input_schema?.fields?.length ? bp.input_schema.fields : inputsToSchema(bp.inputs || [])
}

export function getOutputSchemaFields(bp: Blueprint = {}) {
  return bp.output_schema?.fields?.length
    ? bp.output_schema.fields
    : bp.output_contract?.fields || bp.output_contract?.required_fields || []
}

// Migrate old blueprint shape into first-class schema objects.
export function migrateBlueprint(raw: (Omit<Blueprint, 'production_modules'> & { production_modules?: (string | { id?: string })[] }) | null | undefined): Blueprint | null | undefined {
  if (!raw) return raw
  const normalizeSchemaFields = (fields: SchemaField[] = []): SchemaField[] => (fields || []).map(f => ({
    ...f,
    field: f.field || f.name || '',
    description: f.description || f.label || '',
    nested_fields: f.nested_fields?.length ? normalizeSchemaFields(f.nested_fields) : f.nested_fields,
  }))
  const oc: OutputContract = raw.output_contract || {}
  const outputFields = raw.output_schema?.fields?.length
    ? normalizeSchemaFields(raw.output_schema.fields)
    : normalizeSchemaFields(oc.fields || oc.required_fields || [])
  const inputFields = raw.input_schema?.fields?.length
    ? normalizeSchemaFields(raw.input_schema.fields)
    : inputsToSchema(raw.inputs || [])
  const inputs = raw.inputs?.length ? raw.inputs : schemaToInputFields(inputFields)
  return {
    ...raw,
    inputs,
    production_modules: moduleIds(raw.production_modules || []),
    deployment: normalizeDeployment(raw.deployment, raw.app || {}),
    input_schema: { type: 'object', ...(raw.input_schema || {}), fields: inputFields },
    output_schema: { type: 'object', ...(raw.output_schema || {}), fields: outputFields },
    output_contract: { ...oc, fields: outputFields, required_fields: undefined },
  }
}

function outputContractHasRules(oc: OutputContract = {}) {
  if (oc.format === 'json') {
    return (oc.fields || oc.required_fields || []).some(f => f?.field?.trim() && f?.type)
  }
  return !!(oc.format_rules && Object.values(oc.format_rules).some(v => {
    if (Array.isArray(v)) return v.length > 0
    return String(v || '').trim()
  }))
}

// The app's own output setting (apps.output_type) for a Design output format.
// JSON and tables are their own kinds; everything else is written text, so a
// key-value, cards or markdown app keeps its setting.
export function appOutputTypeFor(format: string | undefined, current: string | null | undefined) {
  if (format === 'json') return 'json'
  if (format === 'table') return 'table'
  return current === 'json' || current === 'table' ? 'markdown' : current || 'markdown'
}

export function outputContractMismatch(app: Partial<App> | null | undefined, bp: Blueprint | null | undefined) {
  const contractFormat = bp?.output_contract?.format
  if (contractFormat && app?.output_type && appOutputTypeFor(contractFormat, app.output_type) !== app.output_type) {
    return { kind: 'app' as const, appFormat: app.output_type, contractFormat }
  }
  const promptFormat = inferPromptOutputFormat(app?.system_prompt || '')
  if (!promptFormat || !contractFormat || promptFormat === contractFormat) return null
  return { kind: 'prompt' as const, promptFormat, contractFormat }
}

export const mismatchLabel = (m: NonNullable<ReturnType<typeof outputContractMismatch>>) => m.kind === 'app'
  ? `App returns ${m.appFormat === 'json' ? 'JSON' : m.appFormat}, contract is ${m.contractFormat}`
  : `Prompt expects ${m.promptFormat}, contract is ${m.contractFormat}`

export function moduleIds(raw: (string | { id?: string })[] = []): string[] {
  return raw.map(m => typeof m === 'string' ? m : m?.id).filter((id): id is string => !!id)
}

function defaultDeployment(app: Partial<App> = {}): DeploymentPlan {
  return {
    runtime_type: app.app_type === 'api' ? 'api' : app.app_type === 'agent' ? 'agent' : isFileApp(app) ? 'file' : 'prompt',
    entrypoint: '',
    port: '',
    command: '',
    job_mode: 'sync',
    timeout_seconds: 120,
    cpu: '1',
    memory_mb: 1024,
    gpu: false,
    scale_to_zero: true,
    storage: { input_files: false, output_files: false, persistent: false, retention_days: 30 },
    outputs: [],
    secrets: [],
    cost: { estimated_model_usd: 0.02, estimated_runtime_usd: 0, estimated_storage_usd: 0 },
  }
}

export function normalizeDeployment(dep: Partial<DeploymentPlan> | null = {}, app: Partial<App> = {}): DeploymentPlan {
  const d = { ...defaultDeployment(app), ...(dep || {}) }
  return {
    ...d,
    storage: { ...defaultDeployment(app).storage, ...(d.storage || {}) },
    cost: { ...defaultDeployment(app).cost, ...(d.cost || {}) },
    outputs: Array.isArray(d.outputs) ? d.outputs : [],
    secrets: Array.isArray(d.secrets) ? d.secrets : [],
  }
}

export function estimateMonthlyCost(dep: Partial<DeploymentPlan> = {}, runs = 1000) {
  const cost = normalizeDeployment(dep).cost
  const perRun = Number(cost.estimated_model_usd || 0) + Number(cost.estimated_runtime_usd || 0) + Number(cost.estimated_storage_usd || 0)
  return { perRun, monthly: perRun * runs }
}

export function isMissingBlueprintTable(error: unknown) {
  if (!isRecord(error)) return false
  return error.code === '42P01' ||
    error?.code === 'PGRST205' ||
    (typeof error.message === 'string' && error.message.includes('app_blueprints')) ||
    (typeof error.message === 'string' && error.message.includes('schema cache')) ||
    (typeof error.message === 'string' && error.message.includes('does not exist'))
}

// Chatbots answer in short conversational replies: an output format is enough,
// they don't need required sections (which their replies would never contain).
export function outputRulesSatisfied(app: Partial<App> | null | undefined, oc: OutputContract) {
  return outputContractHasRules(oc) || (app?.app_type === 'chatbot' && !!oc.format)
}

// The same rules the server applies before publishing
// (validate_app_publish_ready), checked live while editing.
const FIELD_NAME_RE = /^[a-z][a-z0-9_]*$/
export function readinessChecks(app: Partial<App> | null | undefined, bp: Blueprint) {
  const oc = bp.output_contract || {}
  const hasValidInputs = validInputFields(bp).length > 0 && invalidInputFields(bp).length === 0
  const hasFormatRules = outputRulesSatisfied(app, oc)
  const mismatch = outputContractMismatch(app, bp)
  const outFields = getOutputSchemaFields(bp)
  const jsonFieldsOk = oc.format !== 'json' || (outFields.length > 0 && outFields.every(f => FIELD_NAME_RE.test((f.field || f.name || '').trim()) && f.type))
  return [
    { key: 'business', label: 'Business',   ok: !!(bp.business_problem?.trim() && bp.audience?.trim()) },
    { key: 'inputs',   label: 'Inputs',     ok: hasValidInputs },
    { key: 'output',   label: 'Output',     ok: !!(oc.format && hasFormatRules && !mismatch && jsonFieldsOk) },
    { key: 'prompt',   label: 'Prompt',     ok: (app?.system_prompt?.trim().length || 0) > 200 },
    { key: 'details',  label: 'Description & model', ok: !!(app?.description?.trim() && app?.ai_model && (!app?.is_paid || app?.price_per_run != null)) },
    { key: 'perms',    label: 'Permissions',ok: bp.permissions !== undefined },
  ]
}

const READINESS_WEIGHTS: Record<string, number> = { business: 15, inputs: 20, output: 20, prompt: 20, details: 15, perms: 10 }
export function calcReadiness(app: Partial<App> | null | undefined, bp: Blueprint) {
  return readinessChecks(app, bp).reduce((s, c) => s + (c.ok ? (READINESS_WEIGHTS[c.key] || 0) : 0), 0)
}

export const EMPTY_BP: Blueprint = {
  business_problem: '',
  audience: '',
  inputs: [],
  input_schema: { type: 'object', fields: [] },
  output_schema: { type: 'object', fields: [] },
  output_contract: { format: 'markdown', fields: [], format_rules: {} },
  ai_behavior: { tone_preset: '', refusal_rules: '', fallback_behavior: '' },
  permissions: { stores_user_data: false, requires_external_api: false, handles_sensitive_data: false },
  production_modules: [],
  deployment: defaultDeployment(),
  copilot_suggestions: {},
}

