import { useEffect, useRef } from 'react'

export function useKeyboard(handlers) {
  // Keep a stable ref so the effect never needs to re-run
  const ref = useRef(handlers)
  useEffect(() => { ref.current = handlers })

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        ref.current.onSearch?.()
      }
      if (e.key === 'Escape') {
        ref.current.onEscape?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, []) // empty — registers exactly once, never re-registers
}
