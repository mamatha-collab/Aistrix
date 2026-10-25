import { useState, useEffect, useRef } from 'react'
import { filterMarketApps, loadMarketApp, loadMarketApps } from '../lib/marketplace'
import { useParams, useNavigate, Link } from '../navigation'
import { supabase } from '../supabase'
import { loadPublicProfiles } from '../lib/publicProfiles'
import { track, EVENTS } from '../lib/analytics'
import { ArrowUpRight, Bookmark, Check, RefreshCw, Search } from 'lucide-react'
import { DeveloperRowPortal } from '../components/DeveloperShell'
import AppRunSurface from '../components/AppRunSurface'
import { loadRunnableApp } from '../lib/runnableApp'
import '../marketplace.css'

const CATEGORY_ICONS = {
  'Productivity':        '⚡',
  'Writing & Content':   '✍️',
  'Data & Analysis':     '📊',
  'Customer Support':    '💬',
  'HR & Recruiting':     '👥',
  'Sales & Marketing':   '📈',
  'Legal & Compliance':  '⚖️',
  'Engineering':         '🔧',
  'Education':           '🎓',
  'Other':               '🔮',
}

// ─── Marketplace listing grid ─────────────────────────────────────────────────
export function MarketplacePage({ user, initialListings = null }) {
  const [savedIds, setSavedIds] = useState(new Set())
  const [savingId, setSavingId] = useState(null)
  const [saveError, setSaveError] = useState('')
  useEffect(() => {
    let live = true
    if (user?.id) supabase.from('favorites').select('app_id').eq('user_id', user.id).then(({data}) => { if (live) setSavedIds(new Set((data || []).map(row => String(row.app_id)))) })
    return () => { live = false }
  }, [user?.id])
  async function saveApp(appId) {
    setSavingId(appId); setSaveError('')
    try {
      const {error} = await supabase.from('favorites').upsert({user_id:user.id, app_id:appId}, {onConflict:'user_id,app_id', ignoreDuplicates:true})
      if (error) throw error
      setSavedIds(previous => new Set([...previous, String(appId)]))
      window.dispatchEvent(new Event('aistrix:library-changed'))
    } catch { setSaveError('Could not save the app. Please try again.') }
    finally { setSavingId(null) }
  }
  const [listings, setListings]     = useState(initialListings)
  const [category, setCategory]     = useState('All')
  const [search, setSearch] = useState('')
  const [priceFilter, setPriceFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [loadError, setLoadError] = useState('')
  const loadSequence = useRef(0)
  const navigate = useNavigate()

  useEffect(() => { track(EVENTS.MARKETPLACE_VIEWED) }, [])
  useEffect(() => {
    if (initialListings !== null) { setListings(initialListings); setPage(0) }
    else load()
    return () => { loadSequence.current += 1 }
  }, [user?.id, initialListings]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const sequence = ++loadSequence.current
    setLoadError(''); setListings(null)
    try {
      const rows = await loadMarketApps(supabase)
      const userIds = [...new Set((rows || []).map(row => row.user_id).filter(Boolean))]
      const { data: profiles } = userIds.length
        ? await supabase.from('developer_profiles').select('user_id, display_name').in('user_id', userIds)
        : { data: [] }
      if (sequence !== loadSequence.current) return
      const profileMap = Object.fromEntries((profiles || []).map(profile => [profile.user_id, profile]))
      setListings((rows || []).map(row => ({ ...row, developer_profiles: profileMap[row.user_id] ?? null })))
      setPage(0)
    } catch (error) { if (sequence === loadSequence.current) { setListings([]); setLoadError(error.message || 'Marketplace could not be loaded.') } }
  }
  const categories = ['All', ...new Set([...Object.keys(CATEGORY_ICONS), ...(listings || []).map(row => row.category).filter(Boolean)])]
  const matching = filterMarketApps(listings || [], category, search)
    .filter(row => priceFilter === 'all' || (priceFilter === 'paid' ? row.apps?.is_paid : !row.apps?.is_paid))
  const filtered = matching.slice(page * 24, (page + 1) * 24)
  const hasMore = (page + 1) * 24 < matching.length

  return (
    <div className="market-page flex flex-col flex-1 min-h-0 min-w-0 text-white">
      <DeveloperRowPortal side="content">
        <section className="market-discovery-toolbar" aria-label="Market discovery">
          <div className="market-search-field"><Search size={17} aria-hidden="true" /><label htmlFor="market-search" className="sr-only">Search apps by title</label><input id="market-search" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} placeholder="Search apps…" /></div>
          <label className="market-filter-field market-price-filter"><span className="sr-only">Price filter</span><select value={priceFilter} onChange={event=>{setPriceFilter(event.target.value);setPage(0)}}><option value="all">All prices</option><option value="free">Free apps</option><option value="paid">Paid apps</option></select></label>
          <button onClick={load} disabled={listings===null} aria-label="Refresh apps" title="Refresh apps" className="market-refresh"><RefreshCw size={16} className={listings===null?'animate-spin':''} /></button>
          <nav className="market-group-tiles" aria-label="App groups">{categories.map(c=><button key={c} onClick={()=>{setCategory(c);setPage(0)}} aria-pressed={category===c} aria-label={c==='All'?'All apps':c} title={c==='All'?'All apps':c}><span aria-hidden="true">{c==='All'?'✦':CATEGORY_ICONS[c] || '🔮'}</span><span>{c==='All'?'All apps':c}</span></button>)}</nav>
        </section>
      </DeveloperRowPortal>
      <div className="market-catalog-scroll flex-1 overflow-y-auto">
      <div className="w-full max-w-[1600px] mx-auto px-4 md:px-6 py-5 space-y-4">
        <div className="flex items-center gap-3"><h1 className="text-xl font-semibold tracking-tight">Market</h1>{listings!==null&&!loadError&&<p className="text-xs text-slate-400">{matching.length} {matching.length===1?'app':'apps'} available</p>}</div>
        {loadError && <div role="alert" className="text-sm text-red-400">{loadError} <button onClick={load} className="underline">Retry Marketplace</button></div>}

        {saveError && <p role="alert" className="text-center text-sm text-red-400">{saveError}</p>}
        {/* Grid */}
        {loadError ? null : listings === null ? (
          <div className="text-center text-slate-500 py-20 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-slate-500 py-20 text-sm">
            {search ? `No results for "${search}"` : category !== 'All' || priceFilter !== 'all' ? 'No apps match these filters.' : 'No public apps are available yet.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((l, index) => <ListingCard key={l.id} listing={l} index={page * 24 + index} saved={savedIds.has(String(l.app_id))} saving={savingId === l.app_id} onSave={user ? () => saveApp(l.app_id) : undefined} onClick={() => { track(EVENTS.MARKETPLACE_APP_CLICKED, { app_id: l.app_id, title: l.title, category: l.category }); navigate(`/marketplace/${l.app_id}`) }} />)}
          </div>
        )}
        {!loadError && listings !== null && <nav aria-label="Marketplace pages" className="flex items-center justify-center gap-4 text-sm"><button disabled={page === 0} onClick={() => setPage(value => value - 1)} className="disabled:opacity-40">Previous</button><span>Page {page + 1}</span><button disabled={!hasMore} onClick={() => setPage(value => value + 1)} className="disabled:opacity-40">Next</button></nav>}
      </div>
      </div>
    </div>
  )
}

function ListingCard({ listing: l, index = 0, onClick, saved, saving, onSave }) {
  const app = l.apps
  const isPaid = app?.is_paid
  const price = app?.price_per_run
  const [shine] = useState(() => {
    const seed = [...String(l.app_id || l.id)].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0)
    const duration = 10 + (seed % 900) / 100
    return { '--shine-duration': `${duration}s`, '--shine-delay': `${-(seed % 1000) / 1000 * duration}s` }
  })

  return (
    <article className="market-app-card group" style={{ ...shine, '--card-accent': app?.color || '#8b7cf8', '--card-border-accent': `hsl(${(250 + index * 137.508) % 360} 65% 65%)` }}>
      <div className="flex items-start gap-2.5">
        <div className="market-app-icon" aria-hidden="true">
          {app?.emoji || CATEGORY_ICONS[l.category] || '🔮'}
        </div>
        <div className="min-w-0 flex-1">
          <button onClick={onClick} className="market-app-title">{l.title}</button>
          {l.category && <p className="market-app-meta mt-0.5 truncate text-[10px] leading-4">{l.category}</p>}
        </div>
        {onSave && <button disabled={saved || saving} onClick={onSave} aria-label={`${saved ? 'Saved' : 'Save'} ${l.title}`} aria-pressed={saved} title={saved ? 'Saved to My apps' : 'Save to My apps'} className="market-app-save">
          {saved ? <Check size={14} /> : <Bookmark size={14} className={saving ? 'animate-pulse' : ''} />}
        </button>}
      </div>

      {l.tagline && <p className="market-app-description">{l.tagline}</p>}
      {l.tags?.length > 0 && (
        <div className="flex gap-1 overflow-hidden">
          {l.tags.slice(0, 2).map(t => (
            <span key={t} className="market-app-tag max-w-[48%] truncate rounded-md px-1.5 py-0.5 text-[9px] leading-3">{t}</span>
          ))}
        </div>
      )}

      <div className="market-app-footer">
        <span className={`market-app-price shrink-0 text-[10px] font-semibold ${isPaid ? 'is-paid' : 'is-free'}`}>
          {isPaid ? (price ? `$${price}/run` : 'Paid') : 'Free to use'}
        </span>
        {l.developer_profiles?.display_name && (
          <Link to={`/dev/${l.user_id}`} onClick={e => e.stopPropagation()}
            className="market-app-author ml-auto min-w-0 truncate text-[10px] transition-colors">
            by {l.developer_profiles.display_name}
          </Link>
        )}
        <button onClick={onClick} aria-label={`Open ${l.title}`} className="market-app-open"><ArrowUpRight size={15} /></button>
      </div>
    </article>
  )
}

// ─── Single app detail + launch ───────────────────────────────────────────────
export function MarketplaceAppPage({ appId, initialListing = null }) {
  const params = useParams()
  const id = appId || params.id
  const navigate = useNavigate()
  const [listing, setListing]       = useState(initialListing)
  const [app, setApp]               = useState(initialListing?.apps || null)
  const [notFound, setNotFound]     = useState(false)
  const [detailError, setDetailError] = useState('')
  const detailSequence = useRef(0)
  const [error, setError]           = useState(null)
  const [entitlement, setEntitlement] = useState(null)   // null=loading, false=none, object=active
  const [checkingOut, setCheckingOut] = useState(false)
  const [reviews, setReviews]       = useState([])
  const [myRating, setMyRating]     = useState(0)
  const [myReviewText, setMyReviewText] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)
  const [user, setUser]             = useState(null)
  const [runApp, setRunApp]         = useState(null)    // the app as its runner needs it (signed in only)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => { load(); return () => { detailSequence.current += 1 } }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const sequence = ++detailSequence.current
    setDetailError(''); setNotFound(false); setListing(initialListing); setApp(initialListing?.apps || null); setEntitlement(null); setReviews([]); setMyRating(0); setMyReviewText(''); setError(null); setRunApp(null)
    try {
      const data = await loadMarketApp(supabase, id)
      if (sequence !== detailSequence.current) return
      if (!data?.apps) { setNotFound(true); return }
      const profile = data.user_id ? (await loadPublicProfiles(supabase, [data.user_id]))[0] : null
      const { data: { session } } = await supabase.auth.getSession()
      let entitlementValue = false
      if (session && data.apps.is_paid) {
        const { data: ent, error: entitlementError } = await supabase.from('app_entitlements')
          .select('*').eq('app_id', id).eq('user_id', session.user.id).eq('status', 'active').maybeSingle()
        if (entitlementError) throw new Error(entitlementError.message)
        entitlementValue = ent && (ent.plan !== 'pay_per_run' || Number(ent.run_quota || 0) > Number(ent.runs_used || 0)) ? ent : false
      }
      const { data: reviewRows, error: reviewError } = await supabase.from('app_reviews')
        .select('rating, review_text, created_at, user_id').eq('app_id', id).order('created_at', { ascending: false }).limit(10)
      if (reviewError) throw new Error(reviewError.message)
      // The runner loading separately must not hide the app's details.
      let runnable = null
      if (session) { try { runnable = await loadRunnableApp(supabase, id) } catch { runnable = false } }
      if (sequence !== detailSequence.current) return
      setUser(session?.user ?? null); setRunApp(runnable)
      setListing({ ...data, developer_profiles: profile ?? null }); setApp(data.apps)
      setEntitlement(entitlementValue); setReviews(reviewRows || [])
      track(EVENTS.MARKETPLACE_APP_VIEWED, { app_id: id })
    } catch (error) { if (sequence === detailSequence.current) setDetailError(error.message || 'App details could not be loaded.') }
  }

  async function startCheckout(plan = 'pay_per_run') {
    setCheckingOut(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Sign in to purchase access'); setCheckingOut(false); return }
      const r = await fetch(`${API_URL}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          app_id: id, plan,
          success_url: `${window.location.origin}/app/${id}?checkout=success`,
          cancel_url: window.location.href,
        }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.detail || 'Checkout failed')
      window.location.href = body.checkout_url
    } catch (e) {
      setError(e.message)
      setCheckingOut(false)
    }
  }

  async function submitReview() {
    if (!myRating) return
    setSubmittingReview(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Sign in to leave a review'); setSubmittingReview(false); return }
      const { error: upsertErr } = await supabase.from('app_reviews').upsert({
        app_id: id,
        user_id: session.user.id,
        rating: myRating,
        review_text: myReviewText.trim() || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'app_id,user_id' })
      if (upsertErr) throw new Error(upsertErr.message)
      // Refresh reviews
      const { data: revData } = await supabase.from('app_reviews')
        .select('rating, review_text, created_at, user_id').eq('app_id', id)
        .order('created_at', { ascending: false }).limit(10)
      setReviews(revData || [])
      setMyReviewText('')
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmittingReview(false)
    }
  }

  if (detailError) return <div role="alert" className="p-8 text-sm text-red-400">{detailError} <button onClick={load} className="underline">Retry app details</button></div>

  if (notFound) return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
      <p className="text-slate-400 text-sm">This app isn't available in the marketplace.</p>
      <button onClick={() => navigate('/marketplace')} className="text-xs text-[#A29BFE] hover:underline">← Back to Marketplace</button>
    </div>
  )

  if (!listing) return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-slate-500 text-sm">Loading…</p>
    </div>
  )

  const isPaid = app?.is_paid
  const price  = app?.price_per_run

  return (
    <div className="flex-1 overflow-y-auto text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        {/* App header */}
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-[#6C5CE7]/20 flex items-center justify-center text-3xl shrink-0">
            {app?.emoji || CATEGORY_ICONS[listing.category] || '🔮'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white">{listing.title}</h1>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isPaid ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                {isPaid ? (price ? `$${price}/run` : 'Paid') : 'Free'}
              </span>
            </div>
            {listing.tagline && <p className="text-slate-400 text-sm mt-1">{listing.tagline}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {listing.category && (
                <span className="text-xs bg-[#6C5CE7]/10 text-[#A29BFE] px-2 py-0.5 rounded-full">
                  {CATEGORY_ICONS[listing.category]} {listing.category}
                </span>
              )}
              {listing.tags?.map(t => (
                <span key={t} className="text-xs bg-white/5 text-slate-500 px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
            {listing.developer_profiles?.display_name && (
              <Link to={`/dev/${listing.user_id}`} className="text-xs text-slate-500 hover:text-[#A29BFE] transition-colors mt-1 inline-block">
                by {listing.developer_profiles.display_name}
              </Link>
            )}
          </div>
        </div>

        {/* Description */}
        {listing.description && listing.description.trim() !== (listing.tagline || '').trim() && (
          <div className="bg-[#0E1424] border border-white/5 rounded-2xl p-5">
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{listing.description}</p>
          </div>
        )}

        {/* Run it right here: no second page to open. */}
        {!user ? (
          <section className="bg-[#0E1424] border border-white/10 rounded-2xl p-6 space-y-3">
            <h2 className="text-sm font-semibold text-white">Run this app</h2>
            <p className="text-sm text-slate-400">Sign in to run it{isPaid ? ' and get access' : ' for free'}. Your results are saved to your run history.</p>
            <Link to={`/login?next=${encodeURIComponent(`/marketplace/${id}`)}`} className="inline-block rounded-xl bg-[#6C5CE7] px-5 py-2 text-sm font-semibold text-white">Sign in to run</Link>
          </section>
        ) : isPaid && !entitlement ? (
          <section className="bg-[#0E1424] border border-white/10 rounded-2xl p-6 space-y-3">
            <h2 className="text-sm font-semibold text-white">Get access</h2>
            <p className="text-sm text-slate-400">{`Purchase one run${price ? ` for ${price}` : ''} to use this app.`}</p>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <button onClick={() => startCheckout('pay_per_run')} disabled={checkingOut} className="rounded-xl bg-[#6C5CE7] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{checkingOut ? 'Redirecting…' : 'Buy one run'}</button>
            <button onClick={load} className="block text-xs text-slate-400 underline">Already bought it? Refresh access</button>
          </section>
        ) : runApp ? (
          <AppRunSurface app={runApp} user={user} onRun={() => setRunApp(prev => ({ ...prev, total_runs: (prev.total_runs || 0) + 1 }))} />
        ) : runApp === false ? (
          <section role="alert" className="bg-[#0E1424] border border-white/10 rounded-2xl p-6 space-y-2">
            <p className="text-sm text-slate-300">The app couldn't be loaded for running.</p>
            <button onClick={load} className="text-sm text-[#A29BFE] hover:underline">Try again</button>
          </section>
        ) : null}

        {/* Reviews */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-white">Reviews</h2>

          {/* Write a review */}
          <div className="bg-[#0E1424] border border-white/5 rounded-2xl p-5 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Rate this app</p>
            <div className="flex gap-1">
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => setMyRating(n)}
                  className={`text-xl transition-transform hover:scale-110 ${n <= myRating ? 'text-amber-400' : 'text-slate-600'}`}>
                  ★
                </button>
              ))}
            </div>
            <textarea
              value={myReviewText}
              onChange={e => setMyReviewText(e.target.value)}
              placeholder="Share your experience (optional)…"
              rows={3}
              className="w-full bg-[#171B33] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 resize-none"
            />
            <div className="flex justify-end">
              <button
                onClick={submitReview}
                disabled={!myRating || submittingReview}
                className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
                {submittingReview ? 'Saving…' : 'Submit review'}
              </button>
            </div>
          </div>

          {/* Existing reviews */}
          {reviews.length > 0 ? (
            <div className="space-y-3">
              {reviews.map((r, i) => (
                <div key={i} className="bg-[#0E1424] border border-white/5 rounded-2xl p-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 text-sm">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                    <span className="text-[10px] text-slate-600">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  {r.review_text && <p className="text-sm text-slate-300 leading-relaxed">{r.review_text}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-600 text-center py-4">No reviews yet — be the first!</p>
          )}
        </div>
      </div>
    </div>
  )
}
