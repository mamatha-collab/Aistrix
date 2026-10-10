// Prompt regression tests (Dev Studio Test Suite and the version test gate):
// rule checks on an output, and a single run of an app's prompt with cost.
import { supabase } from '../supabase'
import { parseSSELine } from './sse'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ─── Rule evaluation (pure) ──────────────────────────────────────────────────
export function evaluateRule(output, rule) {
  const out = output ?? ''
  const val = rule.value ?? ''
  try {
    switch (rule.type) {
      case 'must-contain':     return out.toLowerCase().includes(val.toLowerCase())
      case 'must-not-contain': return !out.toLowerCase().includes(val.toLowerCase())
      case 'starts-with':      return out.trimStart().toLowerCase().startsWith(val.toLowerCase())
      case 'ends-with':        return out.trimEnd().toLowerCase().endsWith(val.toLowerCase())
      case 'regex':            return new RegExp(val, 'i').test(out)
      case 'min-length':       return out.length >= parseInt(val, 10)
      case 'max-length':       return out.length <= parseInt(val, 10)
      default:                 return true
    }
  } catch { return false }
}

export function evaluateCase(output, rules) {
  const results = (rules || []).map(r => ({ ...r, passed: evaluateRule(output, r) }))
  const passed = results.every(r => r.passed)
  return { passed, results }
}

const MODEL_COSTS_TS = {
  'gpt-4o': { input: 2.50, output: 10.00 }, 'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 }, 'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'claude-sonnet-5': { input: 3.00, output: 15.00 }, 'claude-opus-4-5': { input: 15.00, output: 75.00 },
  'claude-opus-5': { input: 15.00, output: 75.00 },
}
function getModelRates(model) {
  if (!model) return MODEL_COSTS_TS['claude-sonnet-4-5']
  return MODEL_COSTS_TS[model] || Object.entries(MODEL_COSTS_TS).find(([k]) => model.includes(k) || k.includes(model))?.[1] || null
}

export async function runPrompt(app, input, signal) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${API_URL}/run`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({
      input: input || '(no input)',
      system_prompt: app.system_prompt,
      ai_provider: app.ai_provider || 'claude',
      ai_model: app.ai_model || null,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Backend error' }))
    throw new Error(err.error || (typeof err.detail === 'string' ? err.detail : err.detail?.message) || 'Backend error')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = '', out = '', inputTokens = 0, outputTokens = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const line of lines) {
      const d = parseSSELine(line)
      if (!d) continue
      if (d.token) out += d.token
      if (d.error) throw new Error(d.error)
      if (d.input_tokens)  inputTokens  = d.input_tokens
      if (d.output_tokens) outputTokens = d.output_tokens
    }
  }
  // Estimate tokens from character count if backend didn't return them
  if (!inputTokens)  inputTokens  = Math.round(((app.system_prompt || '').length + (input || '').length) / 4)
  if (!outputTokens) outputTokens = Math.round(out.length / 4)
  const rates = getModelRates(app.ai_model)
  const cost = rates ? ((inputTokens / 1e6) * rates.input) + ((outputTokens / 1e6) * rates.output) : null
  return { output: out, inputTokens, outputTokens, cost }
}

