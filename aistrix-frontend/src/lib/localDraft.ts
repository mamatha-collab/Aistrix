import { isRecord } from '../types/domain'
// Unsaved edits kept in this browser, so a reload, a crash or an expired
// session doesn't lose them. The editor offers them back ("Restore your
// unsaved changes?"); saving or discarding clears them. Signing out on
// purpose clears all of them (the sign-out dialog says unsaved changes are
// lost), so nothing lingers on a shared computer.

const PREFIX = 'aistrix_draft:'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const key = (kind: string, appId: string) => `${PREFIX}${kind}:${appId}`

// base: the saved version the edits started from (e.g. its updated_at), so
// the editor can say when the saved copy changed since.
export function saveLocalDraft(kind: string, appId: string, value: unknown, base: unknown = null) {
  try { localStorage.setItem(key(kind, appId), JSON.stringify({ value, base, savedAt: Date.now() })) } catch { /* storage full or blocked */ }
}

export function readLocalDraft(kind: string, appId: string): { value: unknown; base: unknown; savedAt: number } | null {
  try {
    const draft: unknown = JSON.parse(localStorage.getItem(key(kind, appId)) || 'null')
    if (!isRecord(draft) || typeof draft.savedAt !== 'number' || Date.now() - draft.savedAt > MAX_AGE_MS) return null
    return { value: draft.value, base: draft.base, savedAt: draft.savedAt }
  } catch {
    return null
  }
}

export function clearLocalDraft(kind: string, appId: string) {
  try { localStorage.removeItem(key(kind, appId)) } catch { /* blocked */ }
}

export function clearAllLocalDrafts() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k)
  } catch { /* blocked */ }
}
