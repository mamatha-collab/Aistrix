import { useState, useEffect, useRef } from 'react'
import { APP_PUBLIC_SELECT } from '../lib/appColumns'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { track, EVENTS } from '../lib/analytics'

import { BRAND } from '../lib/brand'
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
export function MarketplacePage() {
  const [listings, setListings]     = useState(null)
  const [category, setCategory]     = useState('All')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadError, setLoadError] = useState('')
  const loadSequence = useRef(0)
  const navigate = useNavigate()

  useEffect(() => { track(EVENTS.MARKETPLACE_VIEWED) }, [])
  useEffect(() => { const timer = setTimeout(load, 200); return () => { clearTimeout(timer); loadSequence.current += 1 } }, [page, category, search]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const sequence = ++loadSequence.current
    setLoadError(''); setListings(null)
    try {
      let query = supabase.from('marketplace_listings')
        .select('*, apps!inner(name, description, is_published, price_per_run, is_paid)', { count: 'exact' })
        .eq('status', 'live').eq('apps.is_published', true)
        .order('updated_at', { ascending: false }).order('id', { ascending: true })
      if (category !== 'All') query = query.eq('category', category)
      if (search.trim()) query = query.ilike('title', '%' + search.trim().replace(/[\\%_]/g, '\\$&') + '%')
      const { data: rows, error, count } = await query.range(page * 24, page * 24 + 23)
      if (error) throw new Error(error.message)
      const userIds = [...new Set((rows || []).map(row => row.user_id).filter(Boolean))]
      const { data: profiles, error: profileError } = userIds.length
        ? await supabase.from('developer_profiles').select('user_id, display_name').in('user_id', userIds)
        : { data: [] }
      if (profileError) throw new Error(profileError.message)
      if (sequence !== loadSequence.current) return
      const profileMap = Object.fromEntries((profiles || []).map(profile => [profile.user_id, profile]))
      setListings((rows || []).map(row => ({ ...row, developer_profiles: profileMap[row.user_id] ?? null })))
      setHasMore(count != null ? (page + 1) * 24 < count : rows?.length === 24)
    } catch (error) { if (sequence === loadSequence.current) { setListings([]); setLoadError(error.message || 'Marketplace could not be loaded.') } }
  }
  const categories = ['All', ...Object.keys(CATEGORY_ICONS)]
  const filtered = listings || []

  return (
    <div className="flex-1 overflow-y-auto text-white">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Hero */}
        <div className="text-center space-y-2 py-4">
          <h2 className="text-3xl font-bold text-white">AI Apps for every workflow</h2>
          <p className="text-slate-400 text-sm">Discover and launch AI apps built on {BRAND}</p>
        </div>

        <div className="max-w-lg mx-auto"><label htmlFor="market-search" className="sr-only">Search apps by title</label><input id="market-search" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} placeholder="Search apps by title…" className="w-full rounded-xl border border-white/10 bg-[#0E1424] p-3 text-sm text-white" /></div>
        {loadError && <div role="alert" className="text-sm text-red-400 text-center">{loadError} <button onClick={load} className="underline">Retry Marketplace</button></div>}
        {/* Category filter */}
        <div className="flex flex-wrap gap-2 justify-center">
          {categories.map(c => (
            <button key={c} onClick={() => { setCategory(c); setPage(0) }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                category === c
                  ? 'bg-[#6C5CE7] border-[#6C5CE7] text-white'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/20'
              }`}>
              {c !== 'All' && (CATEGORY_ICONS[c] ?? '🔮')} {c}
            </button>
          ))}
        </div>

        {/* Grid */}
        {loadError ? null : listings === null ? (
          <div className="text-center text-slate-500 py-20 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-slate-500 py-20 text-sm">
            {search ? `No results for "${search}"` : 'No apps listed yet.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(l => <ListingCard key={l.id} listing={l} onClick={() => { track(EVENTS.MARKETPLACE_APP_CLICKED, { app_id: l.app_id, title: l.title, category: l.category }); navigate(`/marketplace/${l.app_id}`) }} />)}
          </div>
        )}
        {!loadError && listings !== null && <nav aria-label="Marketplace pages" className="flex items-center justify-center gap-4 text-sm"><button disabled={page === 0} onClick={() => setPage(value => value - 1)} className="disabled:opacity-40">Previous</button><span>Page {page + 1}</span><button disabled={!hasMore} onClick={() => setPage(value => value + 1)} className="disabled:opacity-40">Next</button></nav>}
      </div>
    </div>
  )
}

function ListingCard({ listing: l, onClick }) {
  const app = l.apps
  const isPaid = app?.is_paid
  const price = app?.price_per_run

  return (
    <article
      className="text-left bg-[#0E1424] border border-white/5 hover:border-[#6C5CE7]/30 rounded-2xl p-5 space-y-3 transition-all hover:shadow-lg hover:shadow-[#6C5CE7]/5 group">
      <div className="flex items-start justify-between gap-2">
        <div className="w-10 h-10 rounded-xl bg-[#6C5CE7]/20 flex items-center justify-center text-lg shrink-0">
          {CATEGORY_ICONS[l.category] ?? '🔮'}
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isPaid ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
          {isPaid ? (price ? `$${price}/run` : 'Paid') : 'Free'}
        </span>
      </div>

      <div>
        <button onClick={onClick} className="text-left text-sm font-bold text-white group-hover:text-[#A29BFE] transition-colors">{l.title}</button>
        {l.tagline && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{l.tagline}</p>}
      </div>

      {l.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {l.tags.slice(0, 3).map(t => (
            <span key={t} className="text-[10px] bg-white/5 text-slate-500 px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        {l.category && <p className="text-[10px] text-slate-600">{l.category}</p>}
        {l.developer_profiles?.display_name && (
          <Link to={`/dev/${l.user_id}`} onClick={e => e.stopPropagation()}
            className="text-[10px] text-slate-600 hover:text-[#A29BFE] transition-colors">
            by {l.developer_profiles.display_name}
          </Link>
        )}
      </div>
    </article>
  )
}

// ─── Single app detail + launch ───────────────────────────────────────────────
export function MarketplaceAppPage({ appId }) {
  const params = useParams()
  const id = appId || params.id
  const navigate = useNavigate()
  const [listing, setListing]       = useState(null)
  const [app, setApp]               = useState(null)
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

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

  useEffect(() => { load(); return () => { detailSequence.current += 1 } }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const sequence = ++detailSequence.current
    setDetailError(''); setNotFound(false); setListing(null); setApp(null); setEntitlement(null); setReviews([]); setMyRating(0); setMyReviewText(''); setError(null)
    try {
      const { data, error: listingError } = await supabase.from('marketplace_listings')
        .select(`*, apps!inner(${APP_PUBLIC_SELECT})`).eq('app_id', id).eq('status', 'live').eq('apps.is_published', true).maybeSingle()
      if (listingError) throw new Error(listingError.message)
      if (sequence !== detailSequence.current) return
      if (!data?.apps) { setNotFound(true); return }
      const { data: profile, error: profileError } = data.user_id
        ? await supabase.from('developer_profiles').select('display_name, bio, avatar_url').eq('user_id', data.user_id).maybeSingle()
        : { data: null }
      if (profileError) throw new Error(profileError.message)
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
      if (sequence !== detailSequence.current) return
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
      {/* Breadcrumb */}
      <div className="border-b border-white/5 bg-[#0E1424]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-2 text-sm">
          <button onClick={() => navigate('/marketplace')} className="text-[#A29BFE] font-semibold hover:text-white transition-colors">
            ← Marketplace
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* App header */}
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-[#6C5CE7]/20 flex items-center justify-center text-3xl shrink-0">
            {CATEGORY_ICONS[listing.category] ?? '🔮'}
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
        {listing.description && (
          <div className="bg-[#0E1424] border border-white/5 rounded-2xl p-5">
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{listing.description}</p>
          </div>
        )}

        <section className="bg-[#0E1424] border border-white/10 rounded-2xl p-6 space-y-3">
          <h2 className="text-sm font-semibold text-white">{isPaid && !entitlement ? 'Get access' : 'Open app'}</h2>
          <p className="text-sm text-slate-400">{isPaid && !entitlement ? `Purchase one run${price ? ` for $${price}` : ''}, or open the app to check your access.` : 'Use the full app with its forms, files, tools and saved conversation features.'}</p>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          {isPaid && !entitlement && <button onClick={() => startCheckout('pay_per_run')} disabled={checkingOut} className="rounded-xl bg-[#6C5CE7] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{checkingOut ? 'Redirecting…' : 'Buy one run'}</button>}
          <Link to={`/app/${id}`} className="inline-block rounded-xl border border-[#6C5CE7]/40 px-5 py-2 text-sm text-[#A29BFE] ml-2">Open app →</Link>
          <button onClick={load} className="block text-xs text-slate-400 underline">Refresh access</button>
        </section>

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
