import { useState, useEffect, lazy, Suspense } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { applyTheme } from '../utils/theme'

// Lazy-loaded — see AppPage.jsx for why: AppRunner is also dynamically
// imported from DetailPanel.jsx, so a static import here would make that
// dynamic import ineffective.
const AppRunner = lazy(() => import('../components/AppRunner'))
const DataAppRunner = lazy(() => import('../components/DataAppRunner'))
const ApiAppRunner = lazy(() => import('../components/ApiAppRunner'))
const AgentRunner = lazy(() => import('../components/AgentRunner'))
const ConversationThread = lazy(() => import('../components/ConversationThread'))
const EmbedVisitorRunner = lazy(() => import('../components/EmbedVisitorRunner'))

// Host page the widget is framed into ('' when opened directly).
function embeddingHost() {
  if (window.self === window.top) return ''
  const origin = window.location.ancestorOrigins?.[0] || document.referrer || ''
  try { return new URL(origin).hostname.toLowerCase() } catch { return 'unknown' }
}

// "example.com" also allows its subdomains (www.example.com, app.example.com).
function hostAllowed(host, allowlist) {
  if (!host || !Array.isArray(allowlist) || allowlist.length === 0) return true
  return allowlist.some(raw => {
    const d = String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')
    return d && (host === d || host.endsWith(`.${d}`))
  })
}

export default function AppEmbedPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const [app, setApp] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // URL param options
  const theme      = searchParams.get('theme') || 'dark'
  const hideBrand  = searchParams.get('hide_branding') === '1'
  const accent     = searchParams.get('accent') || '#6C5CE7'
  const hideHeader = searchParams.get('hide_header') === '1'
  const bgColor    = theme === 'light' ? '#FDFCF8' : '#0F1225'
  const surfColor  = theme === 'light' ? '#FFFFFF' : '#171B33'
  const textColor  = theme === 'light' ? '#1C1813' : '#E2E8F0'

  useEffect(() => {
    // Apply theme for consistent styling
    applyTheme(theme)

    Promise.all([
      supabase.from('apps').select('*').eq('id', id).eq('is_published', true).single(),
      supabase.auth.getSession(),
    ]).then(([{ data: appData }, { data: { session } }]) => {
      setApp(appData)
      setUser(session?.user ?? null)
      setLoading(false)
    })
  }, [id, theme])

  // Auto-resize: send height to parent window
  useEffect(() => {
    if (typeof window === 'undefined') return
    const resize = () => {
      window.parent.postMessage({ type: 'aistrix:resize', appId: id, height: document.body.scrollHeight }, '*')
    }
    const obs = new ResizeObserver(resize)
    obs.observe(document.body)
    return () => obs.disconnect()
  }, [])

  const css = {
    root: { minHeight: '100vh', background: bgColor, color: textColor, fontFamily: 'Inter, system-ui, sans-serif', padding: 0, margin: 0 },
    header: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'}`, background: surfColor },
    emoji: { fontSize: 22 },
    name: { margin: 0, fontSize: 14, fontWeight: 600, color: textColor },
    desc: { margin: 0, fontSize: 11, color: theme === 'light' ? '#6B6560' : '#94a3b8', marginTop: 1 },
    brand: { marginLeft: 'auto', fontSize: 10, color: accent, textDecoration: 'none', opacity: 0.7 },
    body: { padding: 16 },
    gate: { textAlign: 'center', padding: '40px 20px' },
    gateText: { color: theme === 'light' ? '#6B6560' : '#94a3b8', fontSize: 14, marginBottom: 14 },
    gateBtn: { background: accent, color: 'white', padding: '9px 22px', borderRadius: 10, fontSize: 13, textDecoration: 'none', display: 'inline-block', fontWeight: 500 },
    loader: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: bgColor },
    loaderText: { color: '#94a3b8', fontSize: 13 },
  }

  if (loading) return <div style={css.loader}><span style={css.loaderText}>Loading...</span></div>

  const host = embeddingHost()
  const blockedHost = app && !hostAllowed(host, app.embed_allowed_domains)
  const visitorAccess = app && !user && app.embed_public && !app.is_paid && app.visibility !== 'private'

  if (!app || blockedHost) return (
    <div style={css.loader}>
      <div style={{ textAlign: 'center' }}>
        <p style={css.loaderText}>{blockedHost ? 'This widget is not enabled for this website' : 'App not found'}</p>
        <a href="https://aistrix.com" style={{ ...css.brand, opacity: 1, fontSize: 12, marginLeft: 0 }}>← Aistrix</a>
      </div>
    </div>
  )

  return (
    <div style={css.root}>
      {!hideHeader && (
        <div style={css.header}>
          <span style={css.emoji}>{app.emoji}</span>
          <div>
            <p style={css.name}>{app.name}</p>
            {app.description && <p style={css.desc}>{app.description}</p>}
          </div>
          {!hideBrand && (
            <a href={`${window.location.origin}/app/${id}`} target="_blank" rel="noopener noreferrer" style={css.brand}>
              Powered by Aistrix ↗
            </a>
          )}
        </div>
      )}

      <div style={css.body}>
        {app.visibility === 'private' ? (
          <div style={css.gate}>
            <p style={css.gateText}>This app is private</p>
          </div>
        ) : visitorAccess ? (
          <Suspense fallback={null}>
            <EmbedVisitorRunner app={app} />
          </Suspense>
        ) : !user ? (
          <div style={css.gate}>
            <p style={css.gateText}>Sign in to use this app</p>
            <a href={`${window.location.origin}?redirect=/embed/${id}`} target="_top" style={css.gateBtn}>
              Sign in to Aistrix →
            </a>
          </div>
        ) : (
          <Suspense fallback={null}>
            {app.app_type === 'data'
              ? <DataAppRunner app={app} user={user} inline />
              : app.app_type === 'api'
              ? <ApiAppRunner app={app} user={user} inline />
              : app.app_type === 'agent'
              ? <AgentRunner app={app} user={user} inline />
              : app.has_memory
              ? <ConversationThread app={app} user={user} inline />
              : <AppRunner app={app} user={user} inline />}
          </Suspense>
        )}
      </div>
    </div>
  )
}
