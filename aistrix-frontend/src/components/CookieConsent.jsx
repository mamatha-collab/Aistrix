'use client'

import { useEffect, useState } from 'react'
import { analyticsConfigured, consentChoice, setConsent } from '../lib/analytics'

// Asks before analytics cookies are set. Only shown when analytics are
// configured; sign-in and preferences are essential and need no consent.
export default function CookieConsent() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const sync = () => setOpen(analyticsConfigured && !consentChoice())
    sync()
    window.addEventListener('aistrix:consent', sync)
    return () => window.removeEventListener('aistrix:consent', sync)
  }, [])
  return <CookieConsentDialog open={open} onChoice={setConsent} />
}

export function CookieConsentDialog({ open, onChoice }) {
  if (!open) return null
  return (
    <div role="dialog" aria-label="Cookie choice"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:max-w-sm z-[60] bg-[#141828] border border-white/10 rounded-2xl shadow-2xl p-4 space-y-3">
      <p className="text-sm text-white font-medium">Cookies</p>
      <p className="text-xs text-slate-300 leading-relaxed">
        We use cookies to see how the product is used and make it better. Sign-in and your settings don&apos;t
        need them. <a href="/privacy" className="text-[#A29BFE] underline">Privacy Policy</a>
      </p>
      <div className="flex gap-2 justify-end">
        <button onClick={() => onChoice('declined')}
          className="text-xs px-3 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5">Decline</button>
        <button onClick={() => onChoice('accepted')}
          className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white">Accept</button>
      </div>
    </div>
  )
}
