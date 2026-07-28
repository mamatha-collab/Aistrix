import { useState, useCallback } from 'react'
import { ToastContext } from '../hooks/useToast'

const ICONS = { success: '✓', error: '✕', info: 'ℹ', warn: '⚠' }
const COLORS = {
  success: 'bg-green-500/15 border-green-500/30 text-green-400',
  error:   'bg-red-500/15 border-red-500/30 text-red-400',
  info:    'bg-[#6C5CE7]/15 border-[#6C5CE7]/30 text-[#a89af7]',
  warn:    'bg-amber-500/15 border-amber-500/30 text-amber-400',
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  // `action` is optional: { label, onClick } — renders a button in the toast
  // itself (e.g. "Retry") instead of making the user redo the whole flow.
  const toast = useCallback((message, type = 'info', duration = 3500, action = null) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type, action }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-[100] pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium shadow-xl animate-fade-in pointer-events-auto ${COLORS[t.type]}`}
          >
            <span className="shrink-0 font-bold">{ICONS[t.type]}</span>
            <span>{t.message}</span>
            {t.action && (
              <button onClick={() => { t.action.onClick(); dismiss(t.id) }}
                className="ml-1 underline underline-offset-2 text-xs font-semibold shrink-0 hover:opacity-80">
                {t.action.label}
              </button>
            )}
            <button aria-label="Close" onClick={() => dismiss(t.id)} className="ml-1 opacity-60 hover:opacity-100 text-xs">✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
