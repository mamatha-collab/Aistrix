import { isRecord } from '../types/domain'
export interface RunUsage { input_tokens?: number; output_tokens?: number }
export interface StreamEvent {
  token?: string
  done?: boolean
  provider?: string
  model?: string
  usage?: RunUsage | null
  error?: string
  contract_error?: string[]
  tool_call?: { name: string; input: Record<string, unknown> }
  tool_result?: { name: string; result: string }
}
function isStreamEvent(value: unknown): value is StreamEvent {
  if (!isRecord(value)) return false
  for (const key of ['token', 'provider', 'model', 'error']) if (value[key] !== undefined && typeof value[key] !== 'string') return false
  if (value.done !== undefined && typeof value.done !== 'boolean') return false
  if (value.contract_error !== undefined && (!Array.isArray(value.contract_error) || !value.contract_error.every(item => typeof item === 'string'))) return false
  if (value.usage != null) {
    if (!isRecord(value.usage)) return false
    for (const key of ['input_tokens', 'output_tokens']) if (value.usage[key] !== undefined && typeof value.usage[key] !== 'number') return false
  }
  if (value.tool_call !== undefined && (!isRecord(value.tool_call) || typeof value.tool_call.name !== 'string' || !isRecord(value.tool_call.input))) return false
  if (value.tool_result !== undefined && (!isRecord(value.tool_result) || typeof value.tool_result.name !== 'string' || typeof value.tool_result.result !== 'string')) return false
  return true
}
// Shared helper for parsing Server-Sent-Event lines coming back from the
// backend's streaming /run endpoint.
//
// Previously this exact "skip non-data lines, try/catch JSON.parse" block was
// copy-pasted in ~13 different components (AppRunner, AgentRunner, ApiAppRunner,
// DataAppRunner, ReportsPage, FlowsPage, MultiPageRunner, ConversationThread,
// CreateAppModal, CreateFromWebsiteModal, KnowledgeBaseEditor, DataSourcesPage,
// AIAppBuilder). A few of those call sites also relied on a fragile trick —
// checking whether a caught error's message was literally the V8 string
// "Unexpected end of JSON input" — to tell a genuine backend error (thrown via
// `if (data.error) throw ...`) apart from an incomplete JSON parse. Centralizing
// the parse here means callers no longer need that trick: a parse failure just
// returns null, and any `data.error` handling downstream is a normal condition
// check instead of being entangled with try/catch control flow.
export function parseSSELine(line: string): StreamEvent | null {
  if (!line.startsWith('data: ')) return null
  try {
    const value: unknown = JSON.parse(line.slice(6))
    return isStreamEvent(value) ? value : null
  } catch {
    return null
  }
}
