import { useState } from 'react'

const WORKSPACE_TEMPLATES = [
  { emoji: '💼', color: '#6C5CE7', name: 'Job Application Pipeline', keywords: ['resume', 'cover letter', 'interview', 'job', 'career', 'cv', 'hiring', 'recruiter'] },
  { emoji: '📝', color: '#E84393', name: 'Content Creation', keywords: ['content', 'article', 'blog', 'social', 'writing', 'caption', 'post', 'copy', 'seo'] },
  { emoji: '📊', color: '#0984E3', name: 'Market Research', keywords: ['market', 'research', 'competitor', 'analysis', 'brief', 'strategy', 'benchmark', 'industry'] },
  { emoji: '🏢', color: '#00B894', name: 'Business Proposal', keywords: ['business', 'proposal', 'plan', 'pitch', 'executive', 'summary', 'investor', 'startup'] },
]

export default function WorkspaceRecommendations({ app, onDismiss, onViewWorkspaces }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const text = `${app.name} ${app.description || ''} ${(app.tags || []).join(' ')}`.toLowerCase()
  const matches = WORKSPACE_TEMPLATES.filter(t => t.keywords.some(k => text.includes(k)))
  if (!matches.length) return null

  function dismiss() { setDismissed(true); onDismiss?.() }

  return (
    <div className="fixed bottom-6 right-6 z-[60] w-80 bg-[#171B33] border border-[#6C5CE7]/40 rounded-2xl shadow-xl shadow-[#6C5CE7]/20 animate-slide-in overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-0.5">
          <p className="text-white font-semibold text-sm">⚡ Add to a Workflow?</p>
          <button onClick={dismiss} className="text-slate-500 hover:text-white text-xs transition-colors">✕</button>
        </div>
        <p className="text-xs text-slate-400">Your new app fits into these workflow templates:</p>
      </div>
      <div className="p-3 space-y-2">
        {matches.map(t => (
          <div key={t.name} className="flex items-center gap-3 p-2.5 rounded-xl bg-[#1F2444] border border-white/5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
              style={{ background: t.color + '22' }}>{t.emoji}</div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium">{t.name}</p>
            </div>
          </div>
        ))}
        <button
          onClick={() => { onViewWorkspaces?.(); dismiss() }}
          className="w-full text-xs bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white px-3 py-2 rounded-xl font-medium transition-colors">
          Open Workflows →
        </button>
        <button onClick={dismiss} className="w-full text-[10px] text-slate-500 hover:text-slate-300 py-1 transition-colors">
          Not now
        </button>
      </div>
    </div>
  )
}
