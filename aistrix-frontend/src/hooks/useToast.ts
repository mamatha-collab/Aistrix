import { createContext, useContext } from 'react'

// Split out of components/Toast.jsx: that file exported both the ToastProvider
// component and this hook, which breaks Vite Fast Refresh for the whole file
// (oxlint's react/only-export-components warning) — a file has to export only
// components for Fast Refresh to treat it as a component module. ToastProvider
// still owns the actual Provider element; this just holds the shared context
// and the hook that reads it.
export type ToastKind = 'success' | 'error' | 'info' | 'warn'
export type Toast = (message: string, type?: ToastKind, duration?: number, action?: { label: string; onClick: () => void } | null) => void
export const ToastContext = createContext<Toast | null>(null)

// Public pages (Marketplace app pages, embeds) render shared components such
// as AppRunSurface without a ToastProvider. Throwing here blanked those pages;
// without a provider, notices are simply not shown.
const noToast: Toast = () => {}

export function useToast(): Toast {
  return useContext(ToastContext) ?? noToast
}
