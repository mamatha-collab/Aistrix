// One way to call the backend's streaming /run endpoint, with consistent
// errors. Components used to each re-implement this and several ignored HTTP
// errors, error events inside the stream, and streams that ended early —
// showing a generic "try again" or saving a half-finished reply.

import { supabase } from '../supabase'
import { parseSSELine } from './sse'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export class RunError extends Error {
  constructor(message, { status = null, errors = [], kind = 'server' } = {}) {
    super(message)
    this.name = 'RunError'
    this.status = status
    this.errors = errors        // contract / validation problems, when any
    this.kind = kind            // auth | payment | rate_limit | validation | contract | network | server
  }
}

function kindForStatus(status) {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'payment'
  if (status === 429) return 'rate_limit'
  if (status === 422 || status === 413 || status === 400) return 'validation'
  return 'server'
}

// Turn any error body from our API into one readable sentence.
export async function errorFromResponse(res, fallback = 'Request failed') {
  const body = await res.json().catch(() => ({}))
  let message = body.error
  if (!message) {
    const d = body.detail
    if (typeof d === 'string') message = d
    else if (Array.isArray(d) && d.length) message = String(d[0]?.msg || '').replace(/^Value error, /, '')
    else if (d && typeof d === 'object') message = d.message
  }
  const errors = body.errors || body.detail?.errors || []
  if (message && errors.length) message = `${message}: ${errors.slice(0, 3).join('; ')}`
  if (res.status === 401 && !message) message = 'Your session has expired — sign in again.'
  return new RunError(message || `${fallback} (${res.status})`, { status: res.status, errors, kind: kindForStatus(res.status) })
}

/**
 * POST /run and read the streamed reply.
 * @param body     request body for /run (input, system_prompt, app_id, …)
 * @param onToken  called with the full text so far, as tokens arrive
 * @returns { text, provider, model, usage }
 */
export async function streamRun(body, { signal, onToken, onEvent } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  let res
  try {
    res = await fetch(`${API_URL}/run`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new RunError('Could not reach the Aistrix server. Check your connection and try again.', { kind: 'network' })
  }
  if (!res.ok) throw await errorFromResponse(res, 'Run failed')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', text = '', final = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      const d = parseSSELine(line)
      if (!d) continue
      onEvent?.(d)
      if (d.token !== undefined) { text += d.token; onToken?.(text) }
      if (d.done) final = d
      if (d.contract_error) {
        throw new RunError('The answer did not match the app’s output format.', { kind: 'contract', errors: d.contract_error })
      }
      if (d.error) {
        throw new RunError(d.error, { kind: /rate limit/i.test(d.error) ? 'rate_limit' : 'server' })
      }
    }
  }
  if (!final) throw new RunError('The connection closed before the answer finished. Please try again.', { kind: 'network' })
  return { text, provider: final.provider, model: final.model, usage: final.usage || null }
}

// Parse JSON the model returned, tolerating code fences or a sentence around it.
export function parseModelJSON(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try { return JSON.parse(cleaned) } catch { /* fall through */ }
  const start = cleaned.search(/[[{]/)
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
  if (start !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)) } catch { /* fall through */ }
  }
  throw new RunError('The AI returned an unexpected format. Please try again.', { kind: 'server' })
}

// Ask the model for a JSON object (builder flows) and parse it.
export async function generateJSON(systemPrompt, input, { model = 'claude-sonnet-5-5', signal } = {}) {
  const { text } = await streamRun({
    input, system_prompt: systemPrompt, output_type: 'json', ai_provider: 'claude', ai_model: model,
  }, { signal })
  return parseModelJSON(text)
}

// Read a web page / document URL server-side (see backend /scrape).
export async function readUrl(url, { maxChars = 8000 } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  let res
  try {
    res = await fetch(`${API_URL}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ url, max_chars: maxChars }),
    })
  } catch {
    throw new RunError('Could not reach the Aistrix server. Check your connection and try again.', { kind: 'network' })
  }
  if (!res.ok) throw await errorFromResponse(res, 'Could not read that URL')
  return res.json()   // { text, url, kind, truncated, chars }
}

export function normaliseUrl(raw) {
  const t = String(raw || '').trim()
  if (!t) return ''
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}
