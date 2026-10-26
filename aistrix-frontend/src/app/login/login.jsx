'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Auth from '../../components/Auth'
import { supabase, browserSessionReady } from '../../supabase'

export default function Login({ nextPath, failed, recoveryRequired }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    const navigate = session => {
      if (!live) return
      if (session) {
        // Native next= is authoritative over a bookmark stored by the old app.
        try { sessionStorage.removeItem('aistrix:postLoginPath') } catch { /* Storage may be disabled. */ }
        router.replace(nextPath); router.refresh()
      }
      else setReady(true)
    }
    browserSessionReady.then(() => supabase.auth.getSession()).then(({ data }) => navigate(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => navigate(session))
    return () => { live = false; subscription.unsubscribe() }
  }, [nextPath, router])
  if (!ready) return <div role="status" className="min-h-screen grid place-items-center text-slate-400">Loading your session…</div>
  const callbackUrl = typeof window === 'undefined' ? undefined : `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
  return <>
    {failed && <p role="alert" className="p-4 text-center text-amber-400">The sign-in link could not be completed. Please sign in again.</p>}
    {recoveryRequired && <p role="alert" className="p-4 text-center text-amber-400">Open the password reset link from your email, or request a new one below.</p>}
    <Auth developer={nextPath.startsWith('/developer')} callbackUrl={callbackUrl} />
  </>
}
