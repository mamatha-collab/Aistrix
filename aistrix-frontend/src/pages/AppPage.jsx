import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import { supabase } from '../supabase'
import { track, EVENTS } from '../lib/analytics'

// Lazy-loaded — AppRunner is also dynamically imported from DetailPanel.jsx;
// importing it statically here pins it to this page's chunk and makes that
// dynamic import ineffective (Vite has to pull in this whole page's chunk
// just to run an app from the dashboard). Lazy here too so it splits into
// its own shared chunk both places can fetch on demand.
const AppRunner = lazy(() => import('../components/AppRunner'))

export default function AppPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [user, setUser] = useState(null)
  const [app, setApp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [checkoutBanner, setCheckoutBanner] = useState(null) // 'success' | 'cancelled' | null

  useEffect(() => {
    const checkout = searchParams.get('checkout')
    if (checkout === 'success') {
      setCheckoutBanner('success')
      setSearchParams({}, { replace: true })
      track(EVENTS.CHECKOUT_COMPLETED, { app_id: id, method: 'checkout_session' })
    } else if (checkout === 'cancelled') {
      setCheckoutBanner('cancelled')
      setSearchParams({}, { replace: true })
      track(EVENTS.CHECKOUT_CANCELLED, { app_id: id })
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    fetchApp()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when id changes
  }, [id])

  async function fetchApp() {
    const { data } = await supabase
      .from('apps')
      .select('*, domains(name, emoji, color)')
      .eq('id', id)
      .eq('is_published', true)
      .single()
    setApp(data)
    setLoading(false)
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0F1225] flex items-center justify-center">
      <div className="text-slate-400 text-sm">Loading...</div>
    </div>
  )

  if (!app) return (
    <div className="min-h-screen bg-[#0F1225] flex items-center justify-center">
      <div className="text-center">
        <p className="text-white text-lg font-medium mb-2">App not found</p>
        <button onClick={() => navigate('/')} className="text-[#6C5CE7] text-sm hover:underline">← Back to marketplace</button>
      </div>
    </div>
  )

  if (!user) return (
    <div className="min-h-screen bg-[#0F1225] flex items-center justify-center p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl p-8 w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4"
          style={{ background: (app?.color || '#6C5CE7') + '33' }}>
          {app?.emoji || '🤖'}
        </div>
        <h1 className="text-white text-lg font-semibold mb-1">{app?.name}</h1>
        <p className="text-slate-400 text-sm mb-6 leading-relaxed">{app?.description}</p>
        <div className="flex gap-2 flex-wrap justify-center mb-3">
          {(app?.tags || []).map(t => (
            <span key={t} className="text-[10px] bg-[#1F2444] text-slate-400 px-2 py-0.5 rounded">{t}</span>
          ))}
        </div>
        <p className="text-slate-500 text-xs mb-5">Sign in to run this app for free</p>
        <button
          onClick={() => navigate('/')}
          className="w-full bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm py-2.5 rounded-xl font-medium transition-colors"
        >
          Sign in to Aistrix
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0F1225] flex flex-col">
      <header className="h-14 bg-[#171B33] border-b border-white/5 flex items-center px-6 gap-4">
        <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white text-sm transition-colors">
          ← Back to marketplace
        </button>
        <div className="flex items-center gap-2 ml-4">
          <div className="w-7 h-7 rounded-lg bg-[#6C5CE7] flex items-center justify-center text-white font-bold text-sm">A</div>
          <span className="text-white font-semibold">Aistrix</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          {checkoutBanner === 'success' && (
            <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
              <p className="text-emerald-400 text-sm font-semibold">✓ Payment successful — your access is now active</p>
              <button onClick={() => setCheckoutBanner(null)} className="text-slate-500 hover:text-white text-sm">✕</button>
            </div>
          )}
          {checkoutBanner === 'cancelled' && (
            <div className="mb-4 bg-slate-500/10 border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between">
              <p className="text-slate-400 text-sm">Payment cancelled — you can try again when ready.</p>
              <button onClick={() => setCheckoutBanner(null)} className="text-slate-500 hover:text-white text-sm">✕</button>
            </div>
          )}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{ background: (app.color || '#6C5CE7') + '33' }}>
              {app.emoji}
            </div>
            <div>
              <h1 className="text-white text-xl font-semibold">{app.name}</h1>
              <p className="text-slate-400 text-sm mt-0.5">{app.description}</p>
              <div className="flex gap-1 mt-2">
                {(app.tags || []).map(t => (
                  <span key={t} className="text-[10px] bg-[#1F2444] text-slate-400 px-2 py-0.5 rounded">{t}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-[#171B33] border border-white/10 rounded-2xl p-6">
            <Suspense fallback={null}>
              <AppRunner app={app} user={user} inline onRun={() => setApp(prev => ({ ...prev, total_runs: (prev.total_runs || 0) + 1 }))} />
            </Suspense>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>▶ {app.total_runs || 0} total runs</span>
            <button
              onClick={() => { navigator.clipboard.writeText(window.location.href) }}
              className="text-[#6C5CE7] hover:underline"
            >
              🔗 Copy share link
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

