import { useCallback, useSyncExternalStore } from 'react'

export function useMediaQuery(query) {
  const subscribe = useCallback(notify => {
    const mql = window.matchMedia(query)
    mql.addEventListener('change', notify)
    return () => mql.removeEventListener('change', notify)
  }, [query])
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query])
  // Hydration starts with the same responsive tree that the server rendered.
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
