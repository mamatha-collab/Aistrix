import { StrictMode, useEffect, useState } from 'react'
import App from './App.jsx'
import { initializeBrowser } from './lib/browserRuntime.js'
import { ToastProvider } from './components/Toast.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import CookieConsent from './components/CookieConsent.jsx'
import SafeCard from './components/SafeCard.jsx'
import { browserSessionReady } from './supabase'

// Initialization is browser-guarded; the server renders the session placeholder.
initializeBrowser()

export default function BrowserApplication({ RouterComponent, children }) {
  const [sessionReady, setSessionReady] = useState(false)
  useEffect(() => {
    let live = true
    browserSessionReady.then(() => { if (live) setSessionReady(true) })
    return () => { live = false }
  }, [])
  if (!sessionReady) return <div role="status" className="min-h-screen grid place-items-center text-slate-400">Loading your session…</div>
  return (
    <StrictMode>
      <ErrorBoundary>
        <RouterComponent>
          <ToastProvider>
            <App routeContent={children} />
            <SafeCard name="Cookie notice" quiet><CookieConsent /></SafeCard>
          </ToastProvider>
        </RouterComponent>
      </ErrorBoundary>
    </StrictMode>
  )
}
