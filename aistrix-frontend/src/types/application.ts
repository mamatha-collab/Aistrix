import type { Database } from './database'
import type { Json } from './domain'

export type TableRow<K extends keyof Database['public']['Tables']> = Database['public']['Tables'][K]['Row']
export type SchemaField = {
  pii?: boolean
  id?: string
  field?: string
  name?: string
  label?: string
  type: string
  required?: boolean
  description?: string
  placeholder?: string
  options?: string
  enum_values?: string[]
  nested_fields?: SchemaField[]
  children?: SchemaField[]
  default?: Json
  min?: number
  max?: number
}
export type AppPage = {
  id?: string
  name: string
  title?: string
  system_prompt?: string
  prompt?: string
  description?: string
  fields?: SchemaField[]
  form_schema?: SchemaField[]
  output_type?: string
}
export interface ChangeNote { reason?: string; note?: string; source_run_id?: string }
type AppJsonFields = 'form_schema' | 'pages' | 'pages_public' | 'prod_snapshot' | 'change_note'
export type App = Omit<Partial<TableRow<'apps'>>, AppJsonFields | 'id' | 'name'> & {
  id: string
  name: string
  form_schema?: SchemaField[] | null
  pages?: AppPage[] | null
  pages_public?: AppPage[] | null
  prod_snapshot?: Partial<App> | null
  change_note?: ChangeNote | null
  dev_phase?: string
  domains?: { name?: string; emoji?: string; color?: string; slug?: string } | null
  tools?: Tool[]
}
export interface Tool {
  id?: string
  app_id?: string
  name: string
  description?: string
  type: string
  is_active?: boolean
  config?: Record<string, Json | undefined>
  parameters?: Json
  schema?: Json
}
export interface OutputContract {
  format?: string
  fields?: SchemaField[]
  required_fields?: SchemaField[]
  format_rules?: Record<string, string | string[] | boolean | undefined>
}
export interface Blueprint {
  business_problem?: string
  audience?: string
  inputs?: BlueprintInput[]
  input_schema?: { type?: string; fields?: SchemaField[] }
  output_schema?: { type?: string; fields?: SchemaField[] }
  output_contract?: OutputContract
  ai_behavior?: { tone_preset?: string; refusal_rules?: string; fallback_behavior?: string }
  permissions?: Record<string, boolean>
  production_modules?: string[]
  deployment?: Partial<DeploymentPlan>
  copilot_suggestions?: Record<string, Json | undefined>
  contract?: ExecutionContract
  dev_phase?: string
  app?: Partial<App>
}
export interface ConversationMessage {
  role: string
  content: string
}

export interface BlueprintInput { key: string; label: string; type: string; required?: boolean; pii?: boolean; placeholder?: string; options?: string[] }
export interface ExecutionContract { data_class?: string; side_effects?: string; timeout_seconds?: number; privacy?: { model_route?: string; external_destinations?: string[] }; auth?: { secrets?: string[] } }
export interface DeploymentPlan {
  runtime_type: string; entrypoint: string; port: string | number; command: string; job_mode: string; timeout_seconds: number; cpu: string | number; memory_mb: number; gpu: boolean; scale_to_zero: boolean
  storage: { input_files?: boolean; output_files?: boolean; persistent?: boolean; retention_days?: number }
  outputs: { name?: string; type?: string; path?: string }[]
  secrets: { key?: string; label?: string; provider?: string; required?: boolean }[]
  cost: { estimated_model_usd?: number; estimated_runtime_usd?: number; estimated_storage_usd?: number }
}
