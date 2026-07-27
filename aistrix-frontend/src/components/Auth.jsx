import { useState } from 'react'
import { supabase } from '../supabase'

// RFC 5322-ish, practical email check — accepts plus-addressing (name+tag@domain.com),
// requires a real-looking domain with a TLD so bare strings like "example.com"
// (missing the local part) are correctly rejected as malformed, not silently sent to Supabase.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function isValidEmail(value) {
  return EMAIL_RE.test(value.trim())
}

const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD

export default function Auth() {
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
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) setError(error.message)
      else setMessage('Password reset link sent — check your email.')
      setLoading(false)
      return
    }

    const { error } = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email: trimmedEmail, password })
      : await supabase.auth.signUp({ email: trimmedEmail, password })

    if (error) setError(error.message)
    else if (mode === 'signup') setMessage('Check your email to confirm your account!')
    setLoading(false)
  }

  async function handleDemoLogin() {
    setError(''); setMessage(''); setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    if (error) setError(error.message)
    setLoading(false)
  }

  const isReset = mode === 'reset'
  const isLogin = mode === 'login'
  const isDev = import.meta.env.DEV
  const canUseDemo = isDev && DEMO_EMAIL && DEMO_PASSWORD

  return (
    <div className="min-h-screen w-full bg-[#0F1225] flex items-center justify-center p-4 sm:p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl p-5 sm:p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-[#6C5CE7] flex items-center justify-center text-white font-bold">A</div>
          <span className="text-white font-semibold text-lg">Aistrix</span>
        </div>

        <h1 className="text-white text-xl font-semibold mb-1">
          {isReset ? 'Reset your password' : isLogin ? 'Welcome back' : 'Create an account'}
        </h1>
        <p className="text-slate-400 text-sm mb-6">
          {isReset
            ? "Enter your email and we'll send a reset link"
            : isLogin
              ? 'Sign in to your Aistrix account'
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
  )
}
