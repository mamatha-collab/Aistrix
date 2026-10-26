import AistrixWordmark from '../components/AistrixWordmark'
import AppRunSurface from '../components/AppRunSurface'
import { loadRunnableApp } from '../lib/runnableApp'
import { useParams, useNavigate, useSearchParams, Link } from '../navigation'
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { track, EVENTS } from '../lib/analytics'

// A published app on its own page (share links, checkout returns). The same
// run section as the Marketplace app page.
export default function AppPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [user, setUser] = useState(null)
  const [app, setApp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
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
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    fetchApp()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when id changes
  }, [id])

  async function fetchApp() {
    setLoading(true); setLoadError('')
    try { setApp(await loadRunnableApp(supabase, id)) }
    catch (e) { setLoadError(e.message || 'The app could not be loaded.') }
    finally { setLoading(false) }
  }

  const frame = children => (
    <div className="min-h-screen w-full flex-1 bg-[#0F1225] flex flex-col">
      <header className="h-14 shrink-0 bg-[#171B33] border-b border-white/5 flex items-center gap-4 px-4 sm:px-6">
        <Link to="/marketplace" className="flex items-center gap-2">
          <img src="/aistrix-logo.svg" alt="" className="w-7 h-7" />
          <span className="text-white font-semibold"><AistrixWordmark /></span>
        </Link>
        <button onClick={() => navigate('/marketplace')} className="ml-auto text-slate-400 hover:text-white text-sm transition-colors">
          ← Back to Market
        </button>
      </header>
      <main className="flex-1 w-full overflow-y-auto">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</div>
      </main>
    </div>
  )

  if (loading) return frame(<p role="status" className="text-center text-slate-400 text-sm py-16">Loading…</p>)

  if (loadError) return frame(<div role="alert" className="text-center py-16 space-y-3">
    <p className="text-red-400 text-sm">{loadError}</p>
    <button onClick={fetchApp} className="text-[#A29BFE] text-sm hover:underline">Try again</button>
  </div>)

  if (!app) return frame(<div className="text-center py-16 space-y-3">
    <p className="text-white text-lg font-medium">App not found</p>
    <p className="text-slate-400 text-sm">It may have been unpublished or the link is incomplete.</p>
    <Link to="/marketplace" className="text-[#A29BFE] text-sm hover:underline">Browse the Market</Link>
  </div>)

  const icon = <div className="w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center text-3xl" style={{ background: (app.color || '#6C5CE7') + '33' }}>
    {app.emoji || '🤖'}
  </div>

  if (!user) return frame(
    <div className="mx-auto bg-[#171B33] border border-white/10 rounded-2xl p-8 w-full max-w-sm text-center">
      <div className="flex justify-center mb-4">{icon}</div>
      <h1 className="text-white text-lg font-semibold mb-1">{app.name}</h1>
      <p className="text-slate-400 text-sm mb-6 leading-relaxed">{app.description}</p>
      <Link to={`/login?next=${encodeURIComponent(`/app/${app.id}`)}`}
        className="block w-full bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm py-2.5 rounded-xl font-medium transition-colors">
        Sign in to run this app
      </Link>
    </div>)

  return frame(<>
    {checkoutBanner && (
      <div className={`mb-5 rounded-xl px-4 py-3 flex items-center justify-between border ${checkoutBanner === 'success' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-slate-500/10 border-white/10'}`}>
        <p className={`text-sm ${checkoutBanner === 'success' ? 'text-emerald-400 font-semibold' : 'text-slate-400'}`}>
          {checkoutBanner === 'success' ? '✓ Payment successful — your access is now active' : 'Payment cancelled — you can try again when ready.'}
        </p>
        <button aria-label="Close" onClick={() => setCheckoutBanner(null)} className="text-slate-500 hover:text-white text-sm">✕</button>
      </div>
    )}
    <div className="flex items-start gap-4 mb-6">
      {icon}
      <div className="min-w-0">
        <h1 className="text-white text-xl sm:text-2xl font-semibold">{app.name}</h1>
        {app.description && <p className="text-slate-400 text-sm mt-1 leading-relaxed">{app.description}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${app.is_paid ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
            {app.is_paid ? (app.price_per_run ? `$${app.price_per_run} per run` : 'Paid') : 'Free'}
          </span>
          {(app.tags || []).map(t => <span key={t} className="text-[11px] bg-[#1F2444] text-slate-400 px-2 py-0.5 rounded-full">{t}</span>)}
          <Link to={`/marketplace/${app.id}`} className="text-xs text-[#A29BFE] hover:underline">Reviews and details</Link>
        </div>
      </div>
    </div>
    <AppRunSurface app={app} user={user} onRun={() => setApp(prev => ({ ...prev, total_runs: (prev.total_runs || 0) + 1 }))} />
  </>)
}
