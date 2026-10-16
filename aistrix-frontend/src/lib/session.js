// Telling an expired session apart from signing out on purpose.
import { clearAllLocalDrafts } from './localDraft'

const SIGNING_OUT = 'aistrix_signing_out'
const EXPIRED = 'aistrix_session_expired'

function flag(key, value) {
  try { value ? sessionStorage.setItem(key, '1') : sessionStorage.removeItem(key) } catch { /* blocked */ }
}
function hasFlag(key) {
  try { return sessionStorage.getItem(key) === '1' } catch { return false }
}

// Signing out on purpose: the confirmation says unsaved changes are lost, so
// browser copies of unsaved edits are cleared too.
export async function signOutOnPurpose(client) {
  flag(SIGNING_OUT, true)
  clearAllLocalDrafts()
  await client.auth.signOut()
}

// Call from onAuthStateChange. A sign-out nobody asked for (expired or
// revoked session) is remembered so the sign-in screen can explain it.
export function noteAuthEvent(event) {
  if (event === 'SIGNED_OUT') {
    if (!hasFlag(SIGNING_OUT)) flag(EXPIRED, true)
    flag(SIGNING_OUT, false)
  } else if (event === 'SIGNED_IN') {
    flag(EXPIRED, false)
  }
}

export function sessionExpired() {
  return hasFlag(EXPIRED)
}
