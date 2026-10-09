const STATIC_BADGES = [
  { key: 'is_verified',  label: '✓ Verified',  cls: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  { key: 'is_top_rated', label: '⭐ Top Rated', cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  { key: 'is_trending',  label: '🔥 Trending',  cls: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  { key: 'is_new',       label: '✨ New',       cls: 'text-green-400 bg-green-400/10 border-green-400/20' },
  { key: 'is_featured',  label: '⚡ Featured',  cls: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
]

// Derived trust badges computed from app data at render time
function getDerivedBadges(app) {
  const badges = []
  if (app.total_runs >= 100) {
    badges.push({ label: '🔥 Popular', cls: 'text-orange-400 bg-orange-400/10 border-orange-400/20' })
  } else if (app.total_runs >= 20 && !app.is_trending) {
    badges.push({ label: '📈 Active', cls: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' })
  }
  if (app.is_paid && app.price_per_run > 0) {
    badges.push({ label: '💳 Credits', cls: 'text-amber-400 bg-amber-400/10 border-amber-400/20' })
  } else {
    badges.push({ label: '🔑 BYOK', cls: 'text-slate-400 bg-white/5 border-white/10' })
  }
  return badges
}

const TYPE_LABELS = {
  agent:   { icon: '◈',  label: 'Agent',   color: '#FDCB6E' },
  api:     { icon: '{}', label: 'API',      color: '#0984E3' },
  data:    { icon: '▦',  label: 'Data',     color: '#E17055' },
  batch:   { icon: '⊞',  label: 'Batch',    color: '#6C5CE7' },
  iframe:  { icon: '⬡',  label: 'Embed',   color: '#E84393' },
  native:  { icon: '⊞',  label: 'Form',    color: '#00B894' },
  prompt:  { icon: '✦',  label: 'Prompt',  color: '#A29BFE' },
  structured: { icon: '{}', label: 'JSON', color: '#0984E3' },
  chatbot: { icon: '💬', label: 'Chatbot', color: '#E84393' },
  website: { icon: '🌐', label: 'Website',  color: '#00B894' },
}

const STATUS_BADGE = {
  active:   { label: '● Active',   cls: 'text-green-400' },
  inactive: { label: '○ Inactive', cls: 'text-slate-500' },
  draft:    { label: '◌ Draft',    cls: 'text-slate-400' },
}

function appSourceLabel(app, isOwn, sharedRole) {
  if (isOwn) return 'Yours'
  if (sharedRole) return `Shared · ${sharedRole}`
  if (app.domains?.name) return app.domains.name
  if (app.visibility === 'private') return 'Private'
  return 'Marketplace'
}

export function AppTab({ app, selected, starred, isOwn, onClick, onToggleFavorite }) {
  const typeInfo = TYPE_LABELS[app.app_type]
  const sourceLabel = appSourceLabel(app, isOwn)
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick() }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${app.name} — ${sourceLabel}, ${app.total_runs || 0} runs`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className={`group relative bg-[#121829] border rounded-xl p-3 cursor-pointer transition-all duration-150 flex flex-col gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6C5CE7]
        ${selected
          ? 'border-[#6C5CE7] shadow-md shadow-[#6C5CE7]/10'
          : 'border-white/18 hover:border-white/30 hover:bg-[#1a2040] hover:shadow-xl hover:shadow-black/30'}`}
    >
      <button
        onClick={e => { e.stopPropagation(); onToggleFavorite() }}
        aria-label={starred ? `Remove ${app.name} from favorites` : `Add ${app.name} to favorites`}
        aria-pressed={starred}
        className={`absolute top-1.5 right-1.5 text-xs transition-colors ${starred ? 'text-[#6C5CE7]' : 'text-slate-600 opacity-0 group-hover:opacity-100 hover:text-slate-400'}`}
      >
        {starred ? '★' : '☆'}
      </button>

      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md flex items-center justify-center text-sm shrink-0"
          style={{ background: (app.color || '#6C5CE7') + '22' }}>
          {app.emoji || '🤖'}
        </div>
        <p className="text-white text-xs font-semibold leading-snug line-clamp-2 flex-1 min-w-0 pr-3">{app.name}</p>
      </div>

      {(app.tags || []).length > 0 ? (
        <div className="flex items-center gap-1 flex-wrap overflow-hidden" style={{ maxHeight: '1.25rem' }}>
          {(app.tags || []).slice(0, 2).map(t => (
            <span key={t} className="text-[9px] bg-white/8 text-slate-300 px-1.5 py-0.5 rounded-full truncate">{t}</span>
          ))}
        </div>
      ) : (
        <p className="text-[9px] text-slate-400 line-clamp-1">{app.description || ''}</p>
      )}

      <div className="flex items-center justify-between mt-auto">
        <span className="text-[9px] text-slate-400 shrink-0">⚡ {app.total_runs || 0}</span>
        <div className="flex items-center gap-1 shrink-0">
          {app.ai_model && (
            <span className="text-[9px] text-slate-400 bg-white/5 px-1.5 py-0.5 rounded-full border border-white/10">
              {app.ai_provider === 'openai' ? '🟢' : '🟣'}{' '}
              {app.ai_model.includes('gpt-4o-mini') ? 'GPT-4o Mini'
                : app.ai_model.includes('gpt-4o') ? 'GPT-4o'
                : app.ai_model.includes('haiku') ? 'Haiku'
                : app.ai_model.includes('opus') ? 'Opus'
                : app.ai_model.includes('sonnet') ? 'Sonnet'
                : app.ai_model}
            </span>
          )}
          {typeInfo && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border"
              style={{ color: typeInfo.color, background: typeInfo.color + '15', borderColor: typeInfo.color + '30' }}>
              {typeInfo.icon} {typeInfo.label}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AppCard({ app, selected, starred, isOwn, sharedRole, onClick, onRun, onToggleFavorite, showPublishToggle, onPublishToggle }) {
  const staticBadges = STATIC_BADGES.filter(b => app[b.key])
  const derivedBadges = getDerivedBadges(app)
  const allBadges = [...staticBadges, ...derivedBadges]
  const typeInfo = TYPE_LABELS[app.app_type]
  const sourceLabel = appSourceLabel(app, isOwn, sharedRole)
  const statusInfo = STATUS_BADGE[app.status]
  const readinessBadges = [
    app.status === 'active' && { label: 'Ready', color: '#00B894' },
    (app.total_runs || 0) > 0 && { label: 'Tested', color: '#0984E3' },
    app.has_memory && { label: 'Uses memory', color: '#A29BFE' },
    app.app_type === 'api' && { label: 'API-ready', color: '#FDCB6E' },
    app.app_type === 'native' && { label: 'Guided form', color: '#6C5CE7' },
    app.app_type === 'data' && { label: 'Data input', color: '#E17055' },
    app.app_type === 'structured' && { label: 'Schema-checked', color: '#0984E3' },
    app.app_type === 'chatbot' && { label: 'Chatbot', color: '#E84393' },
  ].filter(Boolean)
  const primaryActionLabel = (app.total_runs || 0) > 0 ? 'Run app' : 'Open app'

  function handleShare(e) {
    e.stopPropagation()
    const url = `${window.location.origin}/app/${app.id}`
    navigator.clipboard.writeText(url).then(() => {
      const toast = document.createElement('div')
      toast.textContent = 'Link copied!'
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#6C5CE7;color:white;padding:8px 16px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;'
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 2000)
    })
  }

  return (
    <div
      onClick={e => { e.stopPropagation(); onClick() }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${app.name} — ${sourceLabel}, ${typeInfo?.label || 'App'}, ${app.total_runs || 0} runs`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className={`group bg-[#121829] border rounded-lg p-4 cursor-pointer transition-all duration-200 flex flex-col gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6C5CE7]
        ${selected
          ? 'border-[#6C5CE7] shadow-lg shadow-[#6C5CE7]/10'
          : 'border-white/20 hover:border-white/30 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5'}`}
    >
      {/* Header: icon + name + star */}
      <div className="flex items-start gap-3">
        <div className="relative">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
            style={{ background: (app.color || '#6C5CE7') + '20' }}>
            {app.emoji || '🤖'}
          </div>
          {/* Status dot on icon */}
          {app.status === 'active' && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-[#121829]" title="Active" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm leading-snug truncate">{app.name}</p>
              <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${isOwn ? 'text-[#A29BFE] bg-[#6C5CE7]/15' : 'text-slate-400 bg-white/5'}`}>
                {isOwn ? '👤 Yours' : sharedRole ? `👥 ${sourceLabel}` : app.domains?.name ? `${app.domains.emoji} ${app.domains.name}` : sourceLabel}
              </span>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onToggleFavorite() }}
              aria-label={starred ? `Remove ${app.name} from favorites` : `Add ${app.name} to favorites`}
              aria-pressed={starred}
              className={`text-lg transition-colors p-1 -mt-0.5 shrink-0 ${starred ? 'text-[#6C5CE7]' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {starred ? '★' : '☆'}
            </button>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed" style={{ minHeight: '2.25rem' }}>
        {app.description || app.desc}
      </p>

      {/* Badges + tags */}
      <div className="flex gap-1.5 flex-wrap items-center flex-1">
        {allBadges.map((b, i) => (
          <span key={i} className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${b.cls}`}>
            {b.label}
          </span>
        ))}
        {(app.tags || []).slice(0, 2).map(t => (
          <span key={t} className="text-[11px] bg-white/8 text-slate-300 px-2 py-0.5 rounded-md">
            {t}
          </span>
        ))}
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <span>⚡ {app.total_runs || 0} runs</span>
          {statusInfo && <span className={statusInfo.cls}>{statusInfo.label}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {app.has_memory && <span title="Conversation memory">💬</span>}
          {app.ai_model && (
            <span className="bg-white/8 px-1.5 py-0.5 rounded-md border border-white/15">
              {app.ai_provider === 'openai' ? '🟢' : '🟣'}{' '}
              {app.ai_model.includes('gpt-4o-mini') ? 'GPT-4o Mini'
                : app.ai_model.includes('gpt-4o') ? 'GPT-4o'
                : app.ai_model.includes('haiku') ? 'Haiku'
                : app.ai_model.includes('opus') ? 'Opus'
                : app.ai_model.includes('sonnet') ? 'Sonnet'
                : app.ai_model}
            </span>
          )}
          {typeInfo && (
            <span className="font-medium px-1.5 py-0.5 rounded-md border"
              style={{ color: typeInfo.color, background: typeInfo.color + '15', borderColor: typeInfo.color + '30' }}>
              {typeInfo.icon} {typeInfo.label}
            </span>
          )}
          {showPublishToggle && (
            <button
              onClick={e => { e.stopPropagation(); onPublishToggle?.() }}
              title={app.is_published ? 'Published — click to unpublish' : 'Draft — click to publish'}
              className={`px-1.5 py-0.5 rounded-md border transition-colors ${app.is_published ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-slate-400 bg-white/5 border-white/10 hover:text-green-400'}`}
            >
              {app.is_published ? '🌐 Live' : '⚫ Draft'}
            </button>
          )}
          <button onClick={handleShare} title="Copy share link" className="text-slate-400 hover:text-white transition-colors">🔗</button>
        </div>
      </div>

      {/* Readiness row */}
      {readinessBadges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {readinessBadges.map(b => (
            <span key={b.label}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md border"
              style={{ color: b.color, background: b.color + '16', borderColor: b.color + '30' }}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div className="grid grid-cols-2 gap-2 mt-0.5">
        <button
          onClick={e => { e.stopPropagation(); onClick() }}
          className="w-full text-xs font-semibold py-1.5 rounded-lg transition-all text-slate-300 bg-white/5 hover:bg-white/10 border border-white/12"
        >
          View details
        </button>
        <button
          onClick={e => { e.stopPropagation(); (onRun ?? onClick)() }}
          className="w-full text-xs font-semibold py-1.5 rounded-lg transition-all text-[#A29BFE] bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 border border-[#6C5CE7]/25"
        >
          {primaryActionLabel}
        </button>
      </div>
    </div>
  )
}
