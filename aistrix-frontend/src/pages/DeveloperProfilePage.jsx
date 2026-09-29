import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../supabase'

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

// ─── Public developer profile ─────────────────────────────────────────────────
export default function DeveloperProfilePage() {
  const { userId } = useParams()
  const navigate   = useNavigate()
  const [profile, setProfile]   = useState(null)       // null = loading
  const [listings, setListings] = useState([])
  const [apps, setApps]         = useState([])
  const [notFound, setNotFound] = useState(false)

  useEffect(() => { load() }, [userId])   // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const [{ data: prof }, { data: listData }, { data: appData }] = await Promise.all([
      supabase.from('developer_profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('marketplace_listings')
        .select('*, apps(name, emoji, description, total_runs, is_paid, price_per_run)')
        .eq('user_id', userId)
        .eq('status', 'live')
        .order('updated_at', { ascending: false }),
      supabase
        .from('apps')
        .select('id, name, emoji, description, total_runs, is_published')
        .eq('created_by', userId)
        .eq('is_published', true)
        .order('total_runs', { ascending: false })
        .limit(12),
    ])

    if (!prof && (!listData?.length) && (!appData?.length)) {
      setNotFound(true)
      return
    }

    setProfile(prof ?? { user_id: userId })
    setListings(listData || [])
    setApps(appData || [])
  }

  if (notFound) return (
    <div className="min-h-screen bg-[#09101F] flex flex-col items-center justify-center gap-4 text-center px-6">
      <p className="text-slate-400 text-sm">Developer profile not found.</p>
      <button onClick={() => navigate('/marketplace')} className="text-xs text-[#A29BFE] hover:underline">← Marketplace</button>
    </div>
  )

  if (profile === null) return (
    <div className="min-h-screen bg-[#09101F] flex items-center justify-center">
      <p className="text-slate-500 text-sm">Loading…</p>
    </div>
  )

  const name = profile.display_name || 'Developer'
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen bg-[#09101F] text-white">
      {/* Nav */}
      <div className="border-b border-white/5 bg-[#0E1424]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link to="/marketplace" className="text-[#A29BFE] text-sm font-semibold hover:text-white transition-colors">
            ← Marketplace
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        {/* Profile header */}
        <div className="flex items-start gap-5">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={name}
              className="w-16 h-16 rounded-2xl object-cover shrink-0 border border-white/10" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-[#6C5CE7]/20 flex items-center justify-center text-xl font-bold text-[#A29BFE] shrink-0">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <h1 className="text-2xl font-bold text-white">{name}</h1>
            {profile.bio && <p className="text-slate-400 text-sm leading-relaxed">{profile.bio}</p>}
            <div className="flex flex-wrap gap-3 pt-1">
              {profile.website && (
                <a href={profile.website} target="_blank" rel="noreferrer"
                  className="text-xs text-[#A29BFE] hover:underline">🌐 {profile.website.replace(/^https?:\/\//, '')}</a>
              )}
              {profile.github && (
                <a href={`https://github.com/${profile.github}`} target="_blank" rel="noreferrer"
                  className="text-xs text-slate-400 hover:text-white">GitHub ↗</a>
              )}
              {profile.twitter && (
                <a href={`https://twitter.com/${profile.twitter}`} target="_blank" rel="noreferrer"
                  className="text-xs text-slate-400 hover:text-white">Twitter ↗</a>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-white">{listings.length + apps.length}</p>
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">apps</p>
          </div>
        </div>

        {/* Marketplace listings */}
        {listings.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wide">Marketplace Apps</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {listings.map(l => (
                <Link key={l.id} to={`/marketplace/${l.app_id}`}
                  className="bg-[#0E1424] border border-white/5 hover:border-[#6C5CE7]/30 rounded-2xl p-4 space-y-2 transition-all group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{l.apps?.emoji ?? (CATEGORY_ICONS[l.category] ?? '🔮')}</span>
                      <p className="text-sm font-bold text-white group-hover:text-[#A29BFE] transition-colors">{l.title}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${l.apps?.is_paid ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                      {l.apps?.is_paid ? (l.apps.price_per_run ? `$${l.apps.price_per_run}/run` : 'Paid') : 'Free'}
                    </span>
                  </div>
                  {l.tagline && <p className="text-xs text-slate-400 line-clamp-2">{l.tagline}</p>}
                  {l.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {l.tags.slice(0, 3).map(t => (
                        <span key={t} className="text-[10px] bg-white/5 text-slate-500 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  )}
                  {l.apps?.total_runs > 0 && (
                    <p className="text-[10px] text-slate-600">{l.apps.total_runs.toLocaleString()} runs</p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Published apps (not on marketplace) */}
        {apps.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wide">Published Apps</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {apps
                .filter(a => !listings.some(l => l.app_id === a.id))
                .map(a => (
                  <Link key={a.id} to={`/app/${a.id}`}
                    className="bg-[#0E1424] border border-white/5 hover:border-white/15 rounded-xl p-4 flex items-start gap-3 transition-all group">
                    <span className="text-xl shrink-0">{a.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white group-hover:text-[#A29BFE] transition-colors truncate">{a.name}</p>
                      {a.description && <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{a.description}</p>}
                      {a.total_runs > 0 && <p className="text-[10px] text-slate-600 mt-1">{a.total_runs.toLocaleString()} runs</p>}
                    </div>
                  </Link>
                ))}
            </div>
          </section>
        )}

        {listings.length === 0 && apps.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-10">No published apps yet.</p>
        )}
      </div>
    </div>
  )
}

// ─── Edit profile form (used inside DevStudio settings or Sell tab) ───────────
export function DeveloperProfileEditor({ user }) {
  const [form, setForm]     = useState({ display_name: '', bio: '', website: '', github: '', twitter: '', avatar_url: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)

  const SETUP_SQL = `create table developer_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bio          text,
  website      text,
  avatar_url   text,
  twitter      text,
  github       text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
alter table developer_profiles enable row level security;
create policy "owner" on developer_profiles
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "public_read" on developer_profiles
  for select using (true);`

  useEffect(() => { load() }, [user?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!user?.id) return
    const { data, error } = await supabase
      .from('developer_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error?.code === '42P01' || error?.message?.includes('does not exist')) {
      setNeedsSetup(true); setLoading(false); return
    }
    setLoading(false)
    if (data) setForm({
      display_name: data.display_name ?? '',
      bio:          data.bio          ?? '',
      website:      data.website      ?? '',
      github:       data.github       ?? '',
      twitter:      data.twitter      ?? '',
      avatar_url:   data.avatar_url   ?? '',
    })
  }

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('developer_profiles').upsert({
      user_id: user.id,
      display_name: form.display_name.trim() || null,
      bio:          form.bio.trim()          || null,
      website:      form.website.trim()      || null,
      github:       form.github.trim()       || null,
      twitter:      form.twitter.trim()      || null,
      avatar_url:   form.avatar_url.trim()   || null,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id' })
    setSaving(false)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  if (loading) return <p className="text-slate-500 text-sm py-4">Loading…</p>

  if (needsSetup) return (
    <SetupCard sql={SETUP_SQL} onRetry={load} label="developer profiles" />
  )

  const profileUrl = `${window.location.origin}/dev/${user?.id}`

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Developer profile</p>
        <a href={profileUrl} target="_blank" rel="noreferrer"
          className="text-[11px] text-[#A29BFE] hover:underline">View public page ↗</a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Field label="Display name" value={form.display_name}
          onChange={v => setForm(p => ({ ...p, display_name: v }))} placeholder="Your name" />
        <Field label="Avatar URL" value={form.avatar_url}
          onChange={v => setForm(p => ({ ...p, avatar_url: v }))} placeholder="https://…" />
      </div>

      <Field label="Bio" value={form.bio}
        onChange={v => setForm(p => ({ ...p, bio: v }))} placeholder="What do you build?" textarea />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Field label="Website" value={form.website}
          onChange={v => setForm(p => ({ ...p, website: v }))} placeholder="https://yoursite.com" />
        <Field label="GitHub username" value={form.github}
          onChange={v => setForm(p => ({ ...p, github: v }))} placeholder="octocat" />
        <Field label="Twitter / X handle" value={form.twitter}
          onChange={v => setForm(p => ({ ...p, twitter: v }))} placeholder="yourhandle" />
      </div>

      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-slate-600 truncate">{profileUrl}</p>
        <button onClick={save} disabled={saving}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40 shrink-0">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save profile'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, textarea }) {
  const cls = "w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40"
  return (
    <div>
      <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1">{label}</label>
      {textarea
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2} className={`${cls} resize-none`} />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      }
    </div>
  )
}

function SetupCard({ sql, onRetry, label }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="bg-[#171B33] border border-amber-500/20 rounded-2xl p-5 space-y-3">
      <p className="text-amber-400 text-sm font-semibold">⚙️ Run this SQL to enable {label}</p>
      <div className="relative">
        <pre className="text-[11px] text-slate-300 bg-[#0E1424] rounded-xl p-4 overflow-x-auto leading-relaxed">{sql}</pre>
        <button onClick={() => { navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          className="absolute top-2 right-2 text-[10px] text-slate-400 hover:text-white bg-white/5 px-2 py-1 rounded-md transition-colors">
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <button onClick={onRetry} className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
        ↺ I ran it — retry
      </button>
    </div>
  )
}
