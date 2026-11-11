import type { Json } from './domain'
import type { SchemaField } from './application'
export interface WorkflowCondition { from: string; op?: string; value?: Json; label?: string }
export interface WorkflowWire { from?: string; value?: Json; transform?: string }
export interface WorkflowStep {
  id?: string
  step_type?: string
  app_id?: string | null
  app_name?: string
  app_emoji?: string | null
  version?: string
  pinned_version?: number | null
  approval_type?: string
  input_map?: Record<string, WorkflowWire>
  run_if?: WorkflowCondition
  ai_fill?: boolean
}
export interface WorkflowTrigger { type: string; fields?: SchemaField[] }
export interface WorkflowDefinition { steps: WorkflowStep[]; trigger?: WorkflowTrigger }
export interface StepSchema { structured?: boolean; input?: SchemaField[]; output?: SchemaField[]; error?: string }
export type WorkflowSchemas = Record<string, StepSchema | undefined>
export interface WorkflowIssue { level: 'error' | 'warn'; text: string; field?: string; draft?: boolean; step?: number | null }
export interface WiringOption { value: string; group: string; label: string; type: string }
export interface WiringField { field: string; type: string; required?: boolean; label?: string }
