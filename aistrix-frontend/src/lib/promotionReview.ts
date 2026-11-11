import type { App, Blueprint, Tool } from '../types/application'
import { isRecord } from '../types/domain'
export const PROMOTE_FIELDS = ['system_prompt', 'ai_provider', 'ai_model', 'output_type', 'form_schema', 'tone', 'greeting', 'input_placeholder', 'pages', 'app_type', 'has_memory'] as const
export const TOOL_FIELDS = ['name', 'description', 'type', 'config', 'input_schema'] as const

export function reviewState(app: Partial<App> | null | undefined, blueprint: (Blueprint & { dev_phase?: string }) | null | undefined, tools: (Tool & { input_schema?: unknown })[] | null | undefined) {
  const { dev_phase: _phase, ...design } = blueprint || {}
  return {
    ...Object.fromEntries(PROMOTE_FIELDS.map(key => [key, app?.[key] ?? null])),
    blueprint: design,
    tools: (tools || []).map(tool => Object.fromEntries(TOOL_FIELDS.map(key => [key, tool[key] ?? null])))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value ?? null
}

export function sameReviewValue(a: unknown, b: unknown) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}
