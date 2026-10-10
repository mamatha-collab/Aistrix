import { useEffect, useRef } from 'react'

// Handles Escape before anything else on the page sees it (window, capture
// phase). Used by builders shown inside another popup (the type picker), so
// their own "unsaved setup?" check runs instead of the outer popup closing.
export function useEscapeKey(handler, enabled = true) {
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler })

  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      handlerRef.current?.()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
