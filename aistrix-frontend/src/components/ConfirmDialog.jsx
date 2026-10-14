import { useState } from 'react'

// Confirmation for actions that can't be undone from the same screen
// (replace a link, turn something off, change the live version). Same look
// as Dev Studio's other dialogs. onConfirm may be async; the dialog shows
// busyLabel until it settles, then the caller closes it.
export default function ConfirmDialog({ title, subtitle, children, confirmLabel, busyLabel, danger = false, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div role="dialog" aria-modal="true" className="bg-[#141828] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div>
            <p className="text-white font-semibold text-sm">{title}</p>
            {subtitle && <p className="text-slate-400 text-xs mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-slate-500 hover:text-white text-lg leading-none px-1">×</button>
        </div>
        <div className="px-5 py-4">
          <div className={`${danger ? 'bg-red-500/8 border-red-500/20' : 'bg-amber-500/8 border-amber-500/20'} border rounded-xl px-4 py-3 text-slate-300 text-xs leading-relaxed`}>
            {children}
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/8">
          <button onClick={onCancel} disabled={busy} className="text-xs text-slate-500 hover:text-white transition-colors">Cancel</button>
          <button onClick={confirm} disabled={busy}
            className={`text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-40 text-white transition-colors ${danger ? 'bg-red-500/80 hover:bg-red-500' : 'bg-[#6C5CE7] hover:bg-[#7C6CFF]'}`}>
            {busy ? (busyLabel || 'Working…') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
