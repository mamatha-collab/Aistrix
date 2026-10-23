import { useEffect } from 'react'
import { confirmDiscard } from '../lib/confirmDiscard'

// Embedded builders share the workspace guard, without trapping focus like a dialog.
export function useBuilderNavigation({ enabled, navigationGuardRef, hasChanges, busy = false, onLeave }) {
  useEffect(() => {
    if (!enabled || !navigationGuardRef) return undefined
    const guard = () => {
      if (busy || !confirmDiscard(hasChanges)) return false
      onLeave?.()
      return true
    }
    navigationGuardRef.current = guard
    const unload = event => { if (hasChanges || busy) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => {
      if (navigationGuardRef.current === guard) navigationGuardRef.current = null
      window.removeEventListener('beforeunload', unload)
    }
  }, [enabled, navigationGuardRef, hasChanges, busy, onLeave])
}
