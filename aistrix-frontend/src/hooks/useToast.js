import { createContext, useContext } from 'react'

// Split out of components/Toast.jsx: that file exported both the ToastProvider
// component and this hook, which breaks Vite Fast Refresh for the whole file
// (oxlint's react/only-export-components warning) — a file has to export only
// components for Fast Refresh to treat it as a component module. ToastProvider
// still owns the actual Provider element; this just holds the shared context
// and the hook that reads it.
export const ToastContext = createContext(null)

export function useToast() {
  return useContext(ToastContext)
}
