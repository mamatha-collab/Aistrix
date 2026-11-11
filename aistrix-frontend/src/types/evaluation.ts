import type { Json, JsonObject } from './domain'
export interface EvaluationCheck { type: string; path?: string; value?: Json; tolerance?: number; schema?: JsonObject }
export interface EvaluationCase { name: string; input: JsonObject; expect?: EvaluationCheck[] }
export interface EvaluationSuite {
  apiVersion: string
  kind: string
  metadata: { namespace: string; name: string; version: string }
  spec: { target: { ref: string; workload: string }; requiredPassRate?: number; approvals?: string; mocks?: JsonObject; checks?: EvaluationCheck[]; dataset?: string; cases?: EvaluationCase[] }
}
export interface CheckDraft { type: string; path: string; value: string; tolerance: string; schema: string }
export interface CaseDraft { name: string; input: string; checks: CheckDraft[] }
export interface SuiteDraft { namespace: string; name: string; version: string; requiredPassRate: string; approvals: string; dataset: string; mocks: string; sharedChecks: string; cases: CaseDraft[]; source?: EvaluationSuite }
