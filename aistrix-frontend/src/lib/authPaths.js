export function safeReturnPath(value, fallback = '/dashboard') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback
  const url = new URL(value, 'https://aistrix.invalid')
  if (url.origin !== 'https://aistrix.invalid' || url.pathname.startsWith('/auth/') || url.pathname === '/login') return fallback
  return url.pathname + url.search + url.hash
}

export function sessionStorageKey(projectUrl) {
  return `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`
}

export function hasSessionCookies(cookies, projectUrl) {
  const key = sessionStorageKey(projectUrl)
  return cookies.some(({ name }) => name === key || (name.startsWith(`${key}.`) && /^\d+$/.test(name.slice(key.length + 1))))
}

// Transfer only this project's old localStorage session. setSession verifies
// with Auth; failed transfers keep the original storage available for recovery.
export async function migrateBrowserSession(client, storage, projectUrl) {
  try {
    const key = sessionStorageKey(projectUrl)
    const raw = storage?.getItem(key)
    if (!raw) return
    const { data: { session } } = await client.auth.getSession()
    if (session) { storage.removeItem(key); return }
    const old = JSON.parse(raw)
    if (typeof old?.access_token !== 'string' || typeof old?.refresh_token !== 'string') return
    const { data, error } = await client.auth.setSession({ access_token: old.access_token, refresh_token: old.refresh_token })
    if (!error && data?.session) storage.removeItem(key)
  } catch { /* Do not erase drafts or a legacy session when Auth/storage is unavailable. */ }
}
