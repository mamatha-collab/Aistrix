import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'
import { parseSSELine } from '../lib/sse'
import { scopeToWorkspace } from '../lib/workspace'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const TYPES = [
  { id: 'doc',     icon: '📄', label: 'Document',    color: '#6C5CE7', desc: 'Manuals, guides, internal docs' },
  { id: 'faq',     icon: '❓', label: 'FAQ',          color: '#00B894', desc: 'Common questions & answers' },
  { id: 'policy',  icon: '📋', label: 'Policy',       color: '#FDCB6E', desc: 'Rules, compliance, standards' },
  { id: 'product', icon: '📦', label: 'Product Info',  color: '#E84393', desc: 'Features, pricing, specs' },
  { id: 'url',     icon: '🌐', label: 'URL / Page',   color: '#0984E3', desc: 'Fetched from a web page' },
]

function typeFor(id) { return TYPES.find(t => t.id === id) || TYPES[0] }

const CHAR_LIMIT = 50_000 // ~12k tokens

export default function KnowledgeVaultPage({ user }) {
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [type, setType]         = useState('doc')
  const [title, setTitle]       = useState('')
  const [content, setContent]   = useState('')
  const [url, setUrl]           = useState('')
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [search, setSearch]     = useState('')
  const [filterType, setFilterType] = useState('all')
  const fileRef = useRef(null)
  const toast = useToast()

  useEffect(() => { load() }, [user.id])

  async function load() {
    setLoading(true)
    const { data } = await scopeToWorkspace(supabase
      .from('knowledge_vault')
      .select('*'), user)
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  async function fetchFromUrl() {
    if (!url.trim()) return
    setFetching(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          input: url,
          system_prompt: 'Fetch and return the main text content of this URL. Return only the clean text content, no HTML, no navigation menus, no ads, no footers. Preserve meaningful structure with line breaks.',
          ai_provider: 'claude',
          ai_model: 'claude-haiku-5-5',
        }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = '', full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          const d = parseSSELine(line)
          if (d?.token) full += d.token
        }
      }
      setContent(full.slice(0, CHAR_LIMIT))
      if (!title) setTitle(url.replace(/^https?:\/\//, '').split('/')[0])
    } catch {
      toast('Could not fetch URL content', 'error')
    } finally {
      setFetching(false)
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast('File too large (max 2 MB)', 'error'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      setContent((ev.target.result || '').slice(0, CHAR_LIMIT))
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''))
    }
    reader.readAsText(file)
  }

  async function save() {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    const { error } = await supabase.from('knowledge_vault').insert({
      user_id: user.id,
      title: title.trim(),
      content: content.trim(),
      type,
      source_url: type === 'url' ? url.trim() : null,
      is_active: true,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Added to Knowledge Vault', 'success')
    setTitle(''); setContent(''); setUrl(''); setShowForm(false); setType('doc')
    load()
  }

  async function toggleActive(item) {
    const { error } = await supabase.from('knowledge_vault').update({ is_active: !item.is_active }).eq('id', item.id)
    if (error) { toast(error.message, 'error'); return }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_active: !i.is_active } : i))
  }

  async function deleteItem(id) {
    if (!confirm('Remove this knowledge item?')) return
    const { error } = await supabase.from('knowledge_vault').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setItems(prev => prev.filter(i => i.id !== id))
    toast('Removed', 'info', 2000)
  }

  const totalChars   = items.filter(i => i.is_active).reduce((s, i) => s + i.content.length, 0)
  const activeCount  = items.filter(i => i.is_active).length

  const visible = items.filter(i => {
    const matchType  = filterType === 'all' || i.type === filterType
    const matchSearch = !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.content.toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-white/8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-lg"
                style={{ background: 'linear-gradient(135deg, #6C5CE7 0%, #E84393 100%)' }}>
                🗃️
              </div>
              <div>
                <h1 className="text-base font-semibold text-white leading-tight">Knowledge Vault</h1>
                <p className="text-[11px] text-slate-400">Shared context injected into every AI App and Workflow run.</p>
              </div>
            </div>
            {activeCount > 0 && (
              <p className="text-[11px] text-slate-500 mt-2 pl-12">
                {activeCount} active source{activeCount !== 1 ? 's' : ''} · {(totalChars / 1000).toFixed(1)}k chars available to every app
              </p>
            )}
          </div>
          <button
            onClick={() => { setShowForm(true); setType('doc') }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#6C5CE7]/50 text-[#A29BFE] bg-[#6C5CE7]/10 hover:bg-[#6C5CE7]/20 transition-all shrink-0">
            + Add Knowledge
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

        {/* Add form */}
        {showForm && (
          <div className="bg-[#121829] border border-[#6C5CE7]/30 rounded-xl p-5 space-y-4">
            <p className="text-xs font-semibold text-white">New Knowledge Source</p>

            {/* Type selector */}
            <div className="grid grid-cols-5 gap-2">
              {TYPES.map(t => (
                <button key={t.id} onClick={() => setType(t.id)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-center transition-all ${type === t.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/15' : 'border-white/10 bg-white/3 hover:border-white/25'}`}>
                  <span className="text-base">{t.icon}</span>
                  <span className="text-[10px] font-medium text-white leading-tight">{t.label}</span>
                </button>
              ))}
            </div>

            {/* URL input (for url type) */}
            {type === 'url' && (
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-[#1A2038] border border-white/12 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors font-mono"
                  placeholder="https://your-site.com/docs/..."
                  value={url} onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fetchFromUrl()}
                />
                <button onClick={fetchFromUrl} disabled={fetching || !url.trim()}
                  className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-xs px-4 py-2 rounded-lg transition-colors shrink-0 font-medium">
                  {fetching ? '⟳ Fetching…' : 'Fetch'}
                </button>
              </div>
            )}

            {/* File upload (for doc type) */}
            {type === 'doc' && (
              <div>
                <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json" className="hidden" onChange={handleFile} />
                <button onClick={() => fileRef.current?.click()}
                  className="w-full border border-dashed border-white/15 rounded-lg py-2.5 text-xs text-slate-400 hover:text-white hover:border-white/30 transition-colors">
                  📎 Upload .txt / .md / .csv / .json (max 2 MB) — or paste below
                </button>
              </div>
            )}

            <input
              className="w-full bg-[#1A2038] border border-white/12 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
              placeholder={`Title — e.g. "${typeFor(type).desc}"`}
              value={title} onChange={e => setTitle(e.target.value)}
            />

            <div className="relative">
              <textarea
                className="w-full bg-[#1A2038] border border-white/12 rounded-lg px-3 py-2.5 text-xs text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors leading-relaxed"
                rows={8}
                placeholder="Paste content here — product docs, FAQs, company policies, pricing info, support scripts…"
                value={content} onChange={e => setContent(e.target.value.slice(0, CHAR_LIMIT))}
              />
              <span className="absolute bottom-2 right-3 text-[10px] text-slate-600">{content.length.toLocaleString()} / {CHAR_LIMIT.toLocaleString()} chars</span>
            </div>

            <div className="flex gap-2">
              <button onClick={save} disabled={saving || !title.trim() || !content.trim()}
                className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-xs px-5 py-2 rounded-lg transition-colors font-semibold">
                {saving ? 'Saving…' : 'Save to Vault'}
              </button>
              <button onClick={() => { setShowForm(false); setTitle(''); setContent(''); setUrl(''); setType('doc') }}
                className="bg-white/5 hover:bg-white/10 text-slate-400 text-xs px-4 py-2 rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filter bar */}
        {!loading && items.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-[#1A2038]/80 p-1 rounded-xl border border-white/10">
              {[{ id: 'all', label: 'All' }, ...TYPES].map(t => (
                <button key={t.id} onClick={() => setFilterType(t.id)}
                  className={`text-[11px] px-3 py-1 rounded-lg font-medium transition-all ${filterType === t.id ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
                  {t.icon ? `${t.icon} ${t.label}` : 'All'}
                </button>
              ))}
            </div>
            <div className="flex-1 flex items-center gap-2 bg-[#1A2038] border border-white/10 rounded-lg px-3 py-1.5 max-w-xs">
              <span className="text-slate-500 text-xs">🔍</span>
              <input
                className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
                placeholder="Search vault…"
                value={search} onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && !showForm && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-5xl mb-4">🗃️</div>
            <h2 className="text-white font-semibold mb-2">Start your Knowledge Vault</h2>
            <p className="text-slate-400 text-sm max-w-md leading-relaxed mb-6">
              Upload company docs, FAQs, product info, and policies. Every AI App and Workflow will automatically reference them — making your AI context-aware instead of generic.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-md mb-8">
              {[
                { icon: '📄', title: 'Company Docs', ex: 'Onboarding guides, SOPs, handbooks' },
                { icon: '❓', title: 'FAQs', ex: 'Support answers, common questions' },
                { icon: '📦', title: 'Product Info', ex: 'Features, pricing, roadmap' },
                { icon: '📋', title: 'Policies', ex: 'HR policies, compliance rules' },
              ].map(({ icon, title: t, ex }) => (
                <div key={t} className="text-left bg-[#121829] border border-white/8 rounded-xl p-3">
                  <p className="text-sm mb-0.5">{icon} <span className="text-white font-medium text-xs">{t}</span></p>
                  <p className="text-[11px] text-slate-500">{ex}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setShowForm(true); setType('doc') }}
              className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl text-white transition-all shadow-lg shadow-[#6C5CE7]/30 hover:brightness-110"
              style={{ background: 'linear-gradient(135deg, #6C5CE7 0%, #8B7CF8 100%)' }}>
              + Add First Knowledge Source
            </button>
          </div>
        )}

        {/* Items list */}
        {!loading && visible.length > 0 && (
          <div className="space-y-2">
            {visible.map(item => {
              const t = typeFor(item.type)
              const isExpanded = expanded === item.id
              return (
                <div key={item.id}
                  className={`border rounded-xl overflow-hidden transition-all ${item.is_active ? 'bg-[#121829] border-white/12' : 'bg-[#0D1120] border-white/6 opacity-60'}`}>
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/3 transition-colors"
                    onClick={() => setExpanded(isExpanded ? null : item.id)}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                      style={{ background: t.color + '22' }}>
                      {t.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{item.title}</p>
                      <p className="text-[11px] text-slate-500">
                        {t.label} · {(item.content.length / 1000).toFixed(1)}k chars · {timeAgo(item.created_at)}
                        {item.source_url && <span className="ml-1">· <a href={item.source_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[#6C5CE7] hover:underline truncate">{item.source_url.replace(/^https?:\/\//, '').slice(0, 40)}</a></span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Active toggle */}
                      <button
                        onClick={e => { e.stopPropagation(); toggleActive(item) }}
                        title={item.is_active ? 'Active — click to disable' : 'Disabled — click to enable'}
                        className={`text-[10px] px-2 py-0.5 rounded-md border font-medium transition-colors ${item.is_active ? 'text-green-400 bg-green-400/10 border-green-400/25 hover:bg-green-400/20' : 'text-slate-500 bg-white/5 border-white/10 hover:text-white'}`}>
                        {item.is_active ? '● Active' : '○ Off'}
                      </button>
                      <button onClick={e => { e.stopPropagation(); deleteItem(item.id) }}
                        className="text-slate-600 hover:text-red-400 text-xs transition-colors p-1">🗑</button>
                      <span className="text-slate-600 text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-white/6 pt-3">
                      <p className="text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap line-clamp-12">{item.content}</p>
                      {item.content.length > 600 && (
                        <p className="text-[10px] text-slate-600 mt-2">{item.content.length.toLocaleString()} characters total</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && visible.length === 0 && items.length > 0 && (
          <p className="text-center text-slate-500 text-sm py-12">No items match your filter.</p>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <p className="text-slate-500 text-sm">Loading vault…</p>
          </div>
        )}

        {/* How it works */}
        {!loading && items.length > 0 && (
          <div className="mt-4 bg-[#6C5CE7]/8 border border-[#6C5CE7]/20 rounded-xl p-4">
            <p className="text-xs text-[#A29BFE] font-semibold mb-1">How it works</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              All <strong className="text-slate-300">active</strong> vault items are automatically appended to every AI App and Workflow run as company context.
              The AI reads them alongside your input — no need to paste the same info repeatedly.
              Disable individual items to exclude them without deleting.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
