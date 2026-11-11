import { isRecord } from '../types/domain'
export type RunErrorKind = 'auth' | 'payment' | 'rate_limit' | 'validation' | 'contract' | 'network' | 'server'
export class RunError extends Error {
  status: number | null
  errors: string[]
  kind: RunErrorKind
  constructor(message: string, { status = null, errors = [], kind = 'server' }: { status?: number | null; errors?: string[]; kind?: RunErrorKind } = {}) {
    super(message)
    this.name = 'RunError'
    this.status = status
    this.errors = errors        // contract / validation problems, when any
    this.kind = kind            // auth | payment | rate_limit | validation | contract | network | server
  }
}

function kindForStatus(status: number): RunErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'payment'
  if (status === 429) return 'rate_limit'
  if (status === 422 || status === 413 || status === 400) return 'validation'
  return 'server'
}

// Turn any error body from our API into one readable sentence.
export async function errorFromResponse(res: Response, fallback = 'Request failed') {
  const raw: unknown = await res.json().catch(() => null)
  const body = isRecord(raw) ? raw : {}
  const detail = body.detail
  let message = typeof body.error === 'string' ? body.error : ''
  if (!message) {
    if (typeof detail === 'string') message = detail
    else if (Array.isArray(detail) && isRecord(detail[0]) && typeof detail[0].msg === 'string') message = detail[0].msg.replace(/^Value error, /, '')
    else if (isRecord(detail) && typeof detail.message === 'string') message = detail.message
  }
  const rawErrors = body.errors || (isRecord(detail) ? detail.errors : null)
  const errors = Array.isArray(rawErrors) ? rawErrors.filter((error): error is string => typeof error === 'string') : []
  if (message && errors.length) message = `${message}: ${errors.slice(0, 3).join('; ')}`
  if (res.status === 401 && !message) message = 'Your session has expired — sign in again.'
  return new RunError(message || `${fallback} (${res.status})`, { status: res.status, errors, kind: kindForStatus(res.status) })
}
