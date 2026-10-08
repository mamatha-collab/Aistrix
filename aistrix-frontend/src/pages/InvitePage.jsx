import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { setActiveWorkspaceId } from '../lib/workspace'

// /invite/:token — accepts a workspace invite for the signed-in user, makes
// that workspace active and opens the app. (Signed-out visitors see the
// login screen first; App.jsx brings them back here afterwards.)
export default function InvitePage({ user }) {
  const { token } = useParams()
  const [state, setState] = useState({ status: 'working', message: '' })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return     // StrictMode runs effects twice in dev
    started.current = true
    supabase.rpc('accept_workspace_invite', { p_token: token }).then(({ data, error }) => {
      if (error) {
        setState({ status: 'error', message: error.message })
        return
      }
      setActiveWorkspaceId(data)
      setState({ status: 'done', message: '' })
      // Full reload so the workspace list (and everything scoped to it) refreshes.
      setTimeout(() => window.location.replace('/'), 900)
    })
  }, [token])

  return (
    <div className="min-h-screen bg-[#09101F] flex items-center justify-center p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl p-8 max-w-md w-full text-center space-y-3">
        {state.status === 'working' && <p className="text-slate-300 text-sm">Joining workspace…</p>}
        {state.status === 'done' && <p className="text-emerald-300 text-sm">You're in! Opening the workspace…</p>}
        {state.status === 'error' && (
          <>
            <p className="text-white font-semibold">This invite can't be used</p>
            <p className="text-slate-400 text-sm">{state.message}</p>
            {/different email/i.test(state.message) && (
              <p className="text-slate-500 text-xs">You're signed in as {user.email}. Sign in with the invited address, or ask for a new invite.</p>
            )}
            <a href="/" className="inline-block mt-2 text-sm text-[#A29BFE] hover:underline">Go to Aistrix</a>
          </>
        )}
      </div>
    </div>
  )
}
