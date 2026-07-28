import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'
import { parseSSELine } from '../lib/sse'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function KnowledgeBaseEditor({ appId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState('text')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const toast = useToast()

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when appId changes
  useEffect(() => { load() }, [appId])

  async function load() {
    const { data } = await supabase.from('app_knowledge').select('*').eq('app_id', appId).order('created_at')
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
          system_prompt: 'Fetch and return the main text content of this URL. Return only the clean text content, no HTML, no navigation, no ads. If you cannot fetch it, return an error message.',
          ai_provider: 'claude',
          ai_model: 'claude-haiku-4-5-20251001',
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
      setContent(full)
      if (!title) setTitle(url.replace(/^https?:\/\//, '').split('/')[0])
    } catch {
      toast('Could not fetch URL content', 'error')
    } finally {
      setFetching(false)
    }
  }

  async function save() {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    const { error } = await supabase.from('app_knowledge').insert({
      app_id: appId, title: title.trim(), content: content.trim(),
      source_url: type === 'url' ? url.trim() : null, type,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Knowledge added', 'success')
    setTitle(''); setContent(''); setUrl(''); setShowForm(false)
    load()
  }

  async function deleteItem(id) {
    const { error } = await supabase.from('app_knowledge').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setItems(prev => prev.filter(i => i.id !== id))
    toast('Removed', 'info', 2000)
  }

  const totalChars = items.reduce((sum, i) => sum + i.content.length, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500">{items.length} sources · {(totalChars / 1000).toFixed(1)}k chars</p>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="text-[10px] text-[#6C5CE7] hover:text-white bg-[#6C5CE7]/10 hover:bg-[#6C5CE7] px-2 py-1 rounded-lg transition-colors">
            + Add knowledge
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-[#0F1225] border border-[#6C5CE7]/30 rounded-xl p-4 space-y-3">
          <div className="flex gap-2">
            {['text', 'url'].map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${type === t ? 'bg-[#6C5CE7] text-white' : 'bg-[#1F2444] text-slate-400 hover:text-white'}`}>
                {t === 'url' ? '🌐 URL' : '📝 Text'}
              </button>
            ))}
          </div>

          {type === 'url' && (
            <div className="flex gap-2">
              <input className="flex-1 bg-[#171B33] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors font-mono"
                placeholder="https://example.com/docs" value={url} onChange={e => setUrl(e.target.value)} />
              <button onClick={fetchFromUrl} disabled={fetching || !url.trim()}
                className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-xs px-3 py-2 rounded-xl transition-colors shrink-0">
                {fetching ? '⟳' : 'Fetch'}
              </button>
            </div>
          )}

          <input className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            placeholder="Title (e.g. Product Documentation)" value={title} onChange={e => setTitle(e.target.value)} />

          <textarea className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors leading-relaxed"
            rows={6} placeholder="Paste your content here — product docs, FAQs, company info, research papers..."
            value={content} onChange={e => setContent(e.target.value)} />

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !title.trim() || !content.trim()}
              className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-xs px-4 py-1.5 rounded-lg transition-colors font-medium">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => { setShowForm(false); setTitle(''); setContent(''); setUrl('') }}
              className="bg-[#171B33] hover:bg-[#272C52] text-slate-400 text-xs px-3 py-1.5 rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? <p className="text-slate-500 text-xs">Loading...</p> :
        items.length === 0 && !showForm ? (
          <div className="bg-[#0F1225] border border-dashed border-white/10 rounded-xl p-4 text-center">
            <p className="text-slate-500 text-xs">No knowledge sources yet</p>
            <p className="text-[10px] text-slate-600 mt-1">Add docs, FAQs, or URLs — the AI will reference them on every run</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {items.map(item => (
              <div key={item.id} className="bg-[#0F1225] border border-white/5 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-white/3 transition-colors"
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
                  <span className="text-sm">{item.type === 'url' ? '🌐' : '📝'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-medium truncate">{item.title}</p>
                    <p className="text-[10px] text-slate-500">{(item.content.length / 1000).toFixed(1)}k chars · {timeAgo(item.created_at)}</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); deleteItem(item.id) }}
                    className="text-slate-600 hover:text-red-400 text-xs transition-colors shrink-0">🗑</button>
                  <span className="text-slate-500 text-[10px]">{expanded === item.id ? '▲' : '▼'}</span>
                </div>
                {expanded === item.id && (
                  <div className="px-3 pb-3 border-t border-white/5 pt-2">
                    <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-6">{item.content}</p>
                    {item.source_url && (
                      <a href={item.source_url} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-[#6C5CE7] hover:underline mt-1 block">{item.source_url}</a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      }

      {items.length > 0 && (
        <p className="text-[10px] text-slate-600 text-center">All knowledge is automatically injected into every run</p>
      )}
    </div>
  )
}
