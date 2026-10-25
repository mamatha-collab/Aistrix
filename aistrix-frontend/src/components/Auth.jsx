import AistrixWordmark from './AistrixWordmark'
import { sessionExpired } from '../lib/session'
import { useState } from 'react'
import { supabase } from '../supabase'

import { BRAND } from '../lib/brand'
import { safeReturnPath } from '../lib/authPaths'
// RFC 5322-ish, practical email check — accepts plus-addressing (name+tag@domain.com),
// requires a real-looking domain with a TLD so bare strings like "example.com"
// (missing the local part) are correctly rejected as malformed, not silently sent to Supabase.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function isValidEmail(value) {
  return EMAIL_RE.test(value.trim())
}

const DEMO_EMAIL = process.env.NODE_ENV !== 'production' ? process.env.NEXT_PUBLIC_DEMO_EMAIL : undefined
const DEMO_PASSWORD = process.env.NODE_ENV !== 'production' ? process.env.NEXT_PUBLIC_DEMO_PASSWORD : undefined
// "Continue with Google": shown once Google sign-in is set up in Supabase
// (Authentication → Providers → Google) for this environment.
const GOOGLE_SIGN_IN = process.env.NEXT_PUBLIC_AUTH_GOOGLE === 'true'

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="w-4 h-4 shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export default function Auth({ developer = false, callbackUrl }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'reset'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  function switchMode(next) {
    setMode(next)
    setError('')
    setMessage('')
    setPassword('')
  }

  function returnUrl(nextPath) {
    if (!nextPath && callbackUrl) return callbackUrl
    if (!process.env.NEXT_PUBLIC_AUTH_CALLBACK_PATH) return undefined
    const destination = nextPath || window.location.pathname + window.location.search
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeReturnPath(destination))}`
  }

  async function handleSubmit() {
    setError('')
    setMessage('')

    const trimmedEmail = email.trim()
    if (!isValidEmail(trimmedEmail)) {
      setError('Enter a valid email address.')
      return
    }
    if (!isReset && password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)

    if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: returnUrl('/reset-password') || `${window.location.origin}/reset-password`,
      })
      if (error) setError(error.message)
      else setMessage('Password reset link sent — check your email.')
      setLoading(false)
      return
    }

    const { error } = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email: trimmedEmail, password })
      : await supabase.auth.signUp({ email: trimmedEmail, password, ...(returnUrl() ? { options: { emailRedirectTo: returnUrl() } } : {}) })

    if (error) setError(error.message)
    else if (mode === 'signup') setMessage('Check your email to confirm your account!')
    setLoading(false)
  }

  // Google returns to this same page (e.g. /developer), signed in. New people
  // get an account on the way; Google has already confirmed their email.
  async function handleGoogle() {
    setError(''); setMessage(''); setLoading(true)
    // Sign-in leaves for Supabase straight away, so check first that Google is
    // turned on there; otherwise people would land on a raw error page.
    const notSetUp = "Google sign-in isn't set up yet. Use your email and password for now."
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,
        { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } })
      const settings = res.ok ? await res.json() : null
      if (settings && !settings.external?.google) { setError(notSetUp); setLoading(false); return }
    } catch { /* can't tell: try anyway */ }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl || returnUrl() || `${window.location.origin}${window.location.pathname}` },
    })
    if (error) {
      setError(/provider is not enabled|unsupported provider/i.test(error.message) ? notSetUp : error.message)
      setLoading(false)
    }
  }

  async function handleDemoLogin() {
    setError(''); setMessage(''); setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    if (error) setError(error.message)
    setLoading(false)
  }

  const isReset = mode === 'reset'
  const isLogin = mode === 'login'
  const isDev = (process.env.NODE_ENV !== 'production')
  const canUseDemo = isDev && DEMO_EMAIL && DEMO_PASSWORD

  return (
    <div className={`min-h-screen w-full bg-[#0F1225] ${developer ? 'flex flex-col' : 'flex items-center justify-center p-4 sm:p-6'}`}>
      {developer && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#111827] px-4 sm:px-6 py-4">
          <div className="flex items-center gap-1">
            <img src="/aistrix-logo.svg" alt="" className="w-7 h-7 shrink-0" />
            <span className="text-white font-bold text-lg"><AistrixWordmark /></span>
            <span className="ml-1 rounded-full border border-[#00D4AA]/20 bg-[#00D4AA]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#00D4AA]">Developer</span>
          </div>
          <nav aria-label="Developer account" className="flex items-center gap-2">
            <button type="button" aria-label="Sign in to Developer" aria-pressed={isLogin}
              onClick={() => switchMode('login')}
              className="min-h-11 rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5 transition-colors">
              Sign in
            </button>
            <button type="button" aria-label="Sign up for Developer" aria-pressed={mode === 'signup'}
              onClick={() => switchMode('signup')}
              className="min-h-11 rounded-xl bg-[#6C5CE7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#7D6FF0] transition-colors">
              Sign up
            </button>
          </nav>
        </header>
      )}
      <div className={developer ? 'flex flex-1 items-center justify-center p-4 sm:p-6' : 'contents'}>
      <div className="bg-[#171B33] border border-white/10 rounded-2xl p-5 sm:p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <img src="/aistrix-logo.svg" alt="" className="w-8 h-8 shrink-0" />
          <span className="text-white font-semibold text-lg"><AistrixWordmark /></span>
        </div>

        {isLogin && sessionExpired() && (
          <div role="status" className="mb-4 rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2.5 text-xs text-amber-200 leading-relaxed">
            Your session expired. Sign in again — any unsaved design or prompt changes on this browser will be offered back.
          </div>
        )}
        <h1 className="text-white text-xl font-semibold mb-1">
          {isReset ? 'Reset your password' : developer ? (isLogin ? 'Sign in to Developer' : 'Create your developer account') : isLogin ? 'Welcome back' : 'Create an account'}
        </h1>
        <p className="text-slate-400 text-sm mb-6">
          {isReset
            ? "Enter your email and we'll send a reset link"
            : developer
              ? `Build, test, and publish your AI apps with ${BRAND}.`
            : isLogin
              ? `Sign in to your ${BRAND} account`
              : 'Start using AI-powered apps today'}
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="auth-email" className="text-xs text-slate-400 mb-1 block">Email</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              onKeyDown={e => e.key === 'Enter' && !isReset && handleSubmit()}
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            />
          </div>

          {!isReset && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="auth-password" className="text-xs text-slate-400">Password</label>
                {isLogin && (
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="text-xs text-[#6C5CE7] hover:underline py-2 px-1 -my-2 -mr-1 min-h-[44px] flex items-center"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                aria-invalid={!!error}
                aria-describedby={error ? 'auth-error' : undefined}
                className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
              />
            </div>
          )}
        </div>

        {error && (
          <div id="auth-error" role="alert" className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-red-400 text-xs">
            {error}
          </div>
        )}
        {message && (
          <div className="mt-3 bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2 text-green-400 text-xs">
            {message}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full mt-4 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-xl font-medium transition-colors"
        >
          {loading
            ? 'Please wait...'
            : isReset
              ? 'Send reset link'
              : isLogin
                ? 'Sign in'
                : 'Create account'}
        </button>

        {GOOGLE_SIGN_IN && !isReset && (
          <>
            <div className="flex items-center gap-3 my-4" aria-hidden="true">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-[11px] text-slate-500">or</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-[#1F1F1F] text-sm py-2.5 rounded-xl font-medium transition-colors"
            >
              <GoogleMark /> Continue with Google
            </button>
          </>
        )}

        {canUseDemo && (
          <button
            onClick={handleDemoLogin}
            disabled={loading}
            className="w-full mt-2 bg-transparent border border-white/10 hover:border-white/20 disabled:opacity-40 text-slate-300 text-sm py-2.5 rounded-xl font-medium transition-colors"
          >
            🧪 Continue with demo account (dev only)
          </button>
        )}

        <p className="text-center text-xs text-slate-500 mt-4 flex items-center justify-center flex-wrap">
          {isReset ? (
            <>
              Remember it?{' '}
              <button onClick={() => switchMode('login')} className="text-[#6C5CE7] hover:underline py-2.5 px-1 min-h-[44px] flex items-center">
                Back to sign in
              </button>
            </>
          ) : isLogin ? (
            <>
              Don't have an account?{' '}
              <button onClick={() => switchMode('signup')} className="text-[#6C5CE7] hover:underline py-2.5 px-1 min-h-[44px] flex items-center">
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button onClick={() => switchMode('login')} className="text-[#6C5CE7] hover:underline py-2.5 px-1 min-h-[44px] flex items-center">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
      </div>
    </div>
  )
}
