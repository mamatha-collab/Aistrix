import { useEffect } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// Traps keyboard focus inside `ref` and calls `onEscape` when Escape is pressed.
// Moves focus to the first focusable element on mount.
export function useFocusTrap(ref, { onEscape } = {}) {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const prevFocus = document.activeElement

    // Focus first interactive element in the modal
    const focusable = () => [...el.querySelectorAll(FOCUSABLE)]
    requestAnimationFrame(() => focusable()[0]?.focus())

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onEscape?.()
        return
      }
      if (e.key !== 'Tab') return
      const els = focusable()
      if (!els.length) { e.preventDefault(); return }
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }

    el.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('keydown', onKeyDown)
      // Give focus back only if it's still ours (or was dropped when this
      // closed) — not when the next popup in a flow has already taken it.
      const active = document.activeElement
      if (!active || active === document.body || el.contains(active)) prevFocus?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; ref is stable and onEscape is read via closure
  }, [])
}
