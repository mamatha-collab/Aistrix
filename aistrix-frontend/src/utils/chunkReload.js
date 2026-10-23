// After a deploy, a tab that was already open still references the old
// build's code files, which no longer exist. Opening a lazily-loaded page
// then fails with "Failed to fetch dynamically imported module". The fix is
// a reload — once, so a genuinely broken file can't cause a reload loop.

const KEY = 'aistrix_chunk_reload_at'
const WINDOW_MS = 30_000

export function isChunkLoadError(error) {
  const text = String(error?.message || error || '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i.test(text)
}

// Reloads the page unless it already did so in the last 30 seconds.
// Returns true when a reload was started.
export function reloadOnceForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false   // no storage (private mode): show the error instead of risking a loop
  }
  window.location.reload()
  return true
}
