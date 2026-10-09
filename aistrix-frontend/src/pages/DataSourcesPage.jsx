import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'
import { normaliseUrl, readUrl } from '../lib/runStream'
import { scopeToWorkspace } from '../lib/workspace'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function SourceCard({ source, onDelete, expanded, onToggle }) {
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={onToggle}>
        <div className="w-9 h-9 rounded-xl bg-[#1F2444] flex items-center justify-center text-lg shrink-0">
          {source.type === 'url' ? '🌐' : source.type === 'csv' ? '📊' : source.type === 'sheets' ? '🟢' : '📝'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm">{source.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] bg-[#1F2444] text-slate-500 px-1.5 py-0.5 rounded capitalize">{source.type}</span>
            <span className="text-[10px] text-slate-500">{(source.content.length / 1000).toFixed(1)}k chars · {timeAgo(source.created_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={e => { e.stopPropagation(); onDelete(source.id) }}
            className="text-slate-600 hover:text-red-400 text-sm transition-colors">🗑</button>
          <span className="text-slate-500 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-5 pb-4 border-t border-white/5 pt-3">
          {source.source_url && (
            <a href={source.source_url} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-[#6C5CE7] hover:underline block mb-2">{source.source_url}</a>
          )}
          <p className="text-xs text-slate-400 leading-relaxed line-clamp-6">{source.content}</p>
        </div>
      )}
    </div>
  )
}

export default function DataSourcesPage({ user }) {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [type, setType] = useState('text')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [sheetMeta, setSheetMeta] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when user.id changes
  useEffect(() => { load() }, [user.id])

  async function load() {
    const { data } = await scopeToWorkspace(supabase.from('user_data_sources').select('*'), user)
      .order('created_at', { ascending: false })
    setSources(data || [])
    setLoading(false)
  }

  async function fetchSheet() {
    if (!url.trim()) return
    setFetching(true)
    setSheetMeta(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/connectors/sheets/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ sheet_url: url }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Could not fetch sheet' }))
        throw new Error(err.detail || 'Could not fetch sheet')
      }
      const { csv, row_count, col_count, sheet_id } = await res.json()
      setContent(csv)
      setSheetMeta({ row_count, col_count, sheet_id })
      if (!name) setName(`Google Sheet (${row_count} rows)`)
    } catch (e) {
      toast(e.message, 'error', 6000)
    } finally {
      setFetching(false)
    }
  }

  // Read the page server-side (/scrape). The model has no web access, so
  // asking it to "fetch" a URL made it invent the content.
  async function fetchFromUrl() {
    const target = normaliseUrl(url)
    if (!target) return
    setFetching(true)
    try {
      const page = await readUrl(target, { maxChars: 50_000 })
      if (!page.text.trim()) throw new Error('That page has no readable text. Paste the content manually instead.')
      setContent(page.text)
      setUrl(page.url || target)
      if (!name) setName((page.url || target).replace(/^https?:\/\//, '').split('/')[0])
      if (page.truncated) toast(`Page is long — kept the first ${page.text.length.toLocaleString()} of ${page.chars.toLocaleString()} characters`, 'info')
    } catch (e) {
      toast(e.message || 'Could not fetch URL content', 'error', 6000)
    } finally {
      setFetching(false)
    }
  }

  async function save() {
    if (!name.trim() || !content.trim()) return
    setSaving(true)
    const { error } = await supabase.from('user_data_sources').insert({
      user_id: user.id, name: name.trim(), content: content.trim(),
      type, source_url: (type === 'url' || type === 'sheets') ? url.trim() : null,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Data source added', 'success')
    setName(''); setContent(''); setUrl(''); setSheetMeta(null); setShowForm(false)
    load()
  }

  async function deleteSource(id) {
    const { error } = await supabase.from('user_data_sources').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setSources(prev => prev.filter(s => s.id !== id))
    toast('Removed', 'info', 2000)
  }

  const totalChars = sources.reduce((s, x) => s + x.content.length, 0)
  const inCls = 'w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Data Sources</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            A personal knowledge library — inject any source into any app run.
          </p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-4 py-2 rounded-xl font-medium transition-colors shrink-0">
            + Add source
          </button>
        )}
      </div>

      {!loading && sources.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Sources', value: sources.length },
            { label: 'Total content', value: `${(totalChars / 1000).toFixed(0)}k chars` },
            { label: 'Est. tokens', value: `~${Math.round(totalChars / 4).toLocaleString()}` },
          ].map(s => (
            <div key={s.label} className="bg-[#171B33] border border-white/5 rounded-xl p-4 text-center">
              <p className="text-white font-bold text-lg">{s.value}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="bg-[#171B33] border border-[#6C5CE7]/30 rounded-2xl p-5 space-y-4">
          <p className="text-white font-medium text-sm">New data source</p>

          <div className="flex flex-wrap gap-2">
            {[
              { id: 'text', icon: '📝', label: 'Text / Paste' },
              { id: 'url', icon: '🌐', label: 'URL' },
              { id: 'csv', icon: '📊', label: 'CSV Data' },
              { id: 'sheets', icon: '🟢', label: 'Google Sheets' },
            ].map(t => (
              <button key={t.id} onClick={() => { setType(t.id); setSheetMeta(null) }}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-all ${type === t.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10 text-white' : 'border-white/10 bg-[#1F2444] text-slate-400 hover:text-white'}`}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {type === 'url' && (
            <div className="flex gap-2">
              <input className={`${inCls} flex-1 font-mono text-xs`}
                placeholder="https://docs.example.com/api" value={url} onChange={e => setUrl(e.target.value)} />
              <button onClick={fetchFromUrl} disabled={fetching || !url.trim()}
                className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-4 py-2.5 rounded-xl transition-colors shrink-0">
                {fetching ? <span className="animate-spin inline-block">⟳</span> : 'Fetch'}
              </button>
            </div>
          )}

          {type === 'sheets' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input className={`${inCls} flex-1 font-mono text-xs`}
                  placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                  value={url} onChange={e => { setUrl(e.target.value); setSheetMeta(null) }} />
                <button onClick={fetchSheet} disabled={fetching || !url.trim()}
                  className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-4 py-2.5 rounded-xl transition-colors shrink-0">
                  {fetching ? <span className="animate-spin inline-block">⟳</span> : 'Fetch'}
                </button>
              </div>
              {sheetMeta && (
                <div className="flex items-center gap-3 text-xs bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                  <span className="text-emerald-400 font-semibold">✓ Fetched</span>
                  <span className="text-slate-400">{sheetMeta.row_count} rows · {sheetMeta.col_count} columns</span>
                </div>
              )}
              <p className="text-[10px] text-slate-500">Sheet must be shared with "Anyone with the link can view". Data is snapshotted — re-fetch to update.</p>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Source name</label>
            <input className={inCls} placeholder="e.g. Product Documentation, Company FAQ, Research Paper"
              value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">
              Content {type === 'csv' ? '(paste CSV data)' : type === 'url' ? '(extracted or paste manually)' : ''}
            </label>
            <textarea className={`${inCls} resize-none leading-relaxed`} rows={8}
              placeholder={
                type === 'csv' ? 'Paste CSV data here...\nName,Email,Company\nJohn,john@co.com,Acme'
                : type === 'url' ? 'Content will be fetched automatically, or paste it here manually...'
                : 'Paste your content here — docs, FAQs, research, product specs, customer data...'
              }
              value={content} onChange={e => setContent(e.target.value)} />
            <p className="text-[10px] text-slate-600 mt-1 text-right">{content.length.toLocaleString()} chars</p>
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !name.trim() || !content.trim()}
              className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-5 py-2.5 rounded-xl font-medium transition-colors">
              {saving ? 'Saving...' : 'Add source'}
            </button>
            <button onClick={() => { setShowForm(false); setName(''); setContent(''); setUrl(''); setSheetMeta(null) }}
              className="bg-[#1F2444] hover:bg-[#272C52] text-slate-300 text-sm px-4 py-2.5 rounded-xl transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-[#171B33] border border-white/5 rounded-2xl animate-pulse" />)}
        </div>
      ) : sources.length === 0 && !showForm ? (
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">🗄️</div>
          <p className="text-white font-semibold text-lg mb-2">No data sources yet</p>
          <p className="text-slate-400 text-sm mb-2 max-w-md mx-auto leading-relaxed">
            Add documents, URLs, CSVs, Google Sheets, or any text content here. Then toggle them on when running any app — the AI will use them as context.
          </p>
          <p className="text-slate-500 text-xs mb-6">Great for: company docs, research papers, product specs, customer lists, market data</p>
          <button onClick={() => setShowForm(true)}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-6 py-2.5 rounded-xl font-medium transition-colors">
            + Add your first source
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map(s => (
            <SourceCard key={s.id} source={s} onDelete={deleteSource}
              expanded={expanded === s.id} onToggle={() => setExpanded(expanded === s.id ? null : s.id)} />
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div className="bg-[#171B33] border border-white/5 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-medium mb-1">How to use data sources</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            When running any app, click the <strong className="text-slate-400">🗄️ Data Sources</strong> chip above the input to inject any of your sources into that run. The AI will reference the selected content when generating its response.
          </p>
        </div>
      )}
    </div>
  )
}
