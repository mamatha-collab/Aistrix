import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabase'
import { getActiveWorkspaceId } from '../lib/workspace'
import { timeAgo } from '../utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CompareModal from './CompareModal'
import { useToast } from '../hooks/useToast'

export default function RunHistory({ user, onClose, inline = false }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [search, setSearch] = useState('')
  const [filterApp, setFilterApp] = useState('all')
  const [exportFormat, setExportFormat] = useState(null)
  const [compareIds, setCompareIds] = useState([])
  const [showCompare, setShowCompare] = useState(false)
  const toast = useToast()

  function doExport(fmt) {
    const data = filtered.map(e => ({
      app: e.app_name,
      date: new Date(e.created_at).toISOString(),
      input: e.input,
      result: e.output,
    }))
    let blob, filename
    if (fmt === 'json') {
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      filename = 'aistrix-history.json'
    } else {
      const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
      const rows = data.map(r => [escape(r.app), escape(r.date), escape(r.input), escape(r.result)].join(','))
      blob = new Blob([['App,Date,Input,Result', ...rows].join('\n')], { type: 'text/csv' })
      filename = 'aistrix-history.csv'
    }
    const url = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: filename }).click()
    URL.revokeObjectURL(url)
    setExportFormat(null)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  useEffect(() => { fetchHistory() }, [])

  async function fetchHistory() {
    // Your own runs, in the active workspace.
    let query = supabase.from('run_history').select('*').eq('user_id', user.id)
    const workspaceId = getActiveWorkspaceId()
    if (workspaceId) query = query.eq('workspace_id', workspaceId)
    const { data } = await query
      .order('created_at', { ascending: false })
      .limit(200)
    if (data) setHistory(data)
    setLoading(false)
  }

  async function deleteEntry(id) {
    const { error } = await supabase.from('run_history').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setHistory(prev => prev.filter(h => h.id !== id))
    setCompareIds(prev => prev.filter(i => i !== id))
  }

  function toggleCompare(id) {
    setCompareIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id)
        : prev.length < 2 ? [...prev, id]
        : [prev[1], id]
    )
  }

  const compareRuns = history.filter(h => compareIds.includes(h.id))

  const appNames = useMemo(() => {
    const names = [...new Set(history.map(h => h.app_name).filter(Boolean))]
    return names.sort()
  }, [history])

  const filtered = useMemo(() => history.filter(entry => {
    const matchesApp = filterApp === 'all' || entry.app_name === filterApp
    const q = search.toLowerCase()
    const matchesSearch = !q
      || entry.input?.toLowerCase().includes(q)
      || entry.output?.toLowerCase().includes(q)
      || entry.app_name?.toLowerCase().includes(q)
    return matchesApp && matchesSearch
  }), [history, search, filterApp])

  return (
    <>
    {showCompare && compareRuns.length === 2 && createPortal(
      <CompareModal runs={compareRuns} onClose={() => setShowCompare(false)} />,
      document.body
    )}
    <div className={inline ? "flex flex-1 overflow-hidden px-6 py-6" : "fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3 md:p-6"}>
      <div className={`bg-[#121829] border border-white/18 rounded-2xl flex flex-col ${inline ? "flex-1 max-w-3xl mx-auto overflow-hidden" : "w-full max-w-2xl max-h-[90vh]"}`}>
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div>
            <p className="text-white font-medium">Run History</p>
            <p className="text-xs text-slate-400">{history.length} total runs</p>
          </div>
          <div className="flex items-center gap-2">
            {compareIds.length === 2 && (
              <button onClick={() => setShowCompare(true)}
                className="text-xs bg-[#6C5CE7]/20 text-[#6C5CE7] border border-[#6C5CE7]/30 px-3 py-1.5 rounded-lg hover:bg-[#6C5CE7]/30 transition-colors">
                Compare 2 runs
              </button>
            )}
            {history.length > 0 && (
              exportFormat === 'pick' ? (
                <div className="flex gap-1 items-center">
                  <span className="text-[10px] text-slate-500">Export as:</span>
                  <button onClick={() => doExport('csv')}
                    className="text-xs bg-[#1F2444] hover:bg-[#272C52] text-slate-300 px-2.5 py-1 rounded-lg transition-colors">CSV</button>
                  <button onClick={() => doExport('json')}
                    className="text-xs bg-[#1F2444] hover:bg-[#272C52] text-slate-300 px-2.5 py-1 rounded-lg transition-colors">JSON</button>
                  <button aria-label="Cancel export" onClick={() => setExportFormat(null)} className="text-slate-500 hover:text-white text-xs px-1">✕</button>
                </div>
              ) : (
                <button onClick={() => setExportFormat('pick')}
                  className="text-xs bg-[#1F2444] hover:bg-[#272C52] text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                  ↓ Export
                </button>
              )
            )}
            <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white text-lg">✕</button>
          </div>
        </div>

        <div className="px-4 pt-3 pb-2 flex flex-col sm:flex-row gap-2 border-b border-white/5">
          <div className="flex items-center gap-2 bg-[#1F2444] border border-white/10 rounded-lg px-3 py-1.5 flex-1">
            <span className="text-slate-500 text-sm">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search inputs or results..."
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
            />
            {search && <button aria-label="Clear search" onClick={() => setSearch('')} className="text-slate-500 hover:text-white text-xs">✕</button>}
          </div>
          <select
            value={filterApp}
            onChange={e => setFilterApp(e.target.value)}
            className="bg-[#1F2444] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-[#6C5CE7] shrink-0"
          >
            <option value="all">All apps</option>
            {appNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {loading && <p className="text-center text-slate-500 text-sm py-8">Loading...</p>}

          {!loading && filtered.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-400 text-sm">{search || filterApp !== 'all' ? 'No matching runs.' : 'No runs yet.'}</p>
              <p className="text-slate-500 text-xs mt-1">{!search && filterApp === 'all' && 'Run an app to see your history here.'}</p>
            </div>
          )}

          {filtered.map(entry => (
            <div key={entry.id} className="bg-[#1F2444] border border-white/5 rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-colors"
                onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-xs font-medium text-[#6C5CE7] shrink-0">{entry.app_name}</span>
                    {entry.flow_name && (
                      <span className="text-[10px] bg-[#6C5CE7]/15 text-[#a29af5] px-1.5 py-0.5 rounded-md shrink-0">
                        ⚡ {entry.flow_name}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500 shrink-0">{timeAgo(entry.created_at)}</span>
                  </div>
                  <p className="text-xs text-slate-300 truncate">{entry.input}</p>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  {entry.rating_value === 1 && <span className="text-xs opacity-60">👍</span>}
                  {entry.rating_value === -1 && <span className="text-xs opacity-60">👎</span>}
                  <button
                    onClick={e => { e.stopPropagation(); toggleCompare(entry.id) }}
                    title="Select for comparison"
                    className={`text-xs transition-colors ${compareIds.includes(entry.id) ? 'text-[#6C5CE7]' : 'text-slate-600 hover:text-slate-400'}`}
                  >⊡</button>
                  <button
                    onClick={e => { e.stopPropagation(); deleteEntry(entry.id) }}
                    className="text-slate-600 hover:text-red-400 text-xs transition-colors"
                  >🗑</button>
                  <span className="text-slate-500 text-xs">{expanded === entry.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expanded === entry.id && (
                <div className="px-3 pb-3 border-t border-white/5 pt-3 space-y-3">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase mb-1">Input</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{entry.input}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-slate-500 uppercase">Result</p>
                      <div className="flex items-center gap-2">
                        {(entry.input_tokens != null || entry.output_tokens != null) && (
                          <span className="text-[10px] text-slate-500" title="Tokens used for this run">
                            ↑{(entry.input_tokens ?? 0).toLocaleString()} ↓{(entry.output_tokens ?? 0).toLocaleString()} tok
                          </span>
                        )}
                        <button
                          onClick={() => navigator.clipboard.writeText(entry.output || '')}
                          className="text-[10px] text-slate-500 hover:text-slate-300"
                        >📋 Copy</button>
                      </div>
                    </div>
                    <div className="text-xs text-slate-200 leading-relaxed prose-result">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.output || ''}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
  )
}
