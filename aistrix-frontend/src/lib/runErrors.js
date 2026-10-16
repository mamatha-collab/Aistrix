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
