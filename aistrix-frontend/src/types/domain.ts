import type { ReactNode } from 'react'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }
export type SourceFiles = Record<string, string>
export type ChildrenProps = { children: ReactNode }
export type CapabilityId = 'ai-apps' | 'agents' | 'workflows' | 'nodes' | 'models' | 'knowledge' | 'evaluations' | 'operations'
export type DeveloperAction = 'design' | 'test' | 'deploy' | 'workflows' | 'resources' | 'evaluations' | 'monitor' | 'evaluate' | 'secrets' | 'create-code' | `create:${string}` | `app:${string}`

export interface ProjectSummary {
  id: string
  name: string
  app_type: string
}

export interface ProviderModel { id: string; label?: string }
export interface Provider {
  id: string
  label?: string
  name?: string
  company?: string
  connected: boolean
  default_model?: string
  models?: ProviderModel[]
  last4?: string | null
  keys_url?: string
}

export interface PythonManifest {
  version: 1
  runtime: 'python'
  mode: 'job'
  entrypoint: string
  timeout_seconds: number
  memory_mb: number
  network: 'none'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function errorMessage(error: unknown, fallback = 'The request could not be completed.'): string {
  return error instanceof Error ? error.message : fallback
}
