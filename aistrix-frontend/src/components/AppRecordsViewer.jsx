import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { timeAgo } from '../utils'
import OutputRenderer from './OutputRenderer'

export default function AppRecordsViewer({ app, user }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.from('app_records')
      .select('*').eq('app_id', app.id).eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { setRecords(data || []); setLoading(false) })
  }, [app.id, user.id])

  async function deleteRecord(id) {
    await supabase.from('app_records').delete().eq('id', id)
    setRecords(prev => prev.filter(r => r.id !== id))
  }

  const filtered = records.filter(r =>
    !search || JSON.stringify(r.data).toLowerCase().includes(search.toLowerCase())
      || r.label?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <p className="text-slate-500 text-xs py-2">Loading records...</p>

  if (records.length === 0) return (
    <div className="bg-[#0F1225] border border-white/5 rounded-xl p-4 text-center">
      <p className="text-slate-500 text-xs">No records yet.</p>
      <p className="text-[10px] text-slate-600 mt-1">Structured outputs (table, cards, JSON) are automatically saved here after each run.</p>
    </div>
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 bg-[#0F1225] border border-white/10 rounded-lg px-3 py-1.5">
        <span className="text-slate-500 text-xs">🔍</span>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search records..." className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none" />
        {search && <button aria-label="Clear search" onClick={() => setSearch('')} className="text-slate-500 hover:text-white text-xs">✕</button>}
      </div>

      <p className="text-[10px] text-slate-500">{filtered.length} records</p>

      {filtered.map(record => (
        <div key={record.id} className="bg-[#0F1225] border border-white/5 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-white/3 transition-colors"
            onClick={() => setExpanded(expanded === record.id ? null : record.id)}>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-300 truncate">{record.label || 'Record'}</p>
              <p className="text-[10px] text-slate-500">{timeAgo(record.created_at)}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={e => { e.stopPropagation(); deleteRecord(record.id) }}
                className="text-slate-600 hover:text-red-400 text-[10px] transition-colors">🗑</button>
              <span className="text-slate-500 text-[10px]">{expanded === record.id ? '▲' : '▼'}</span>
            </div>
          </div>
          {expanded === record.id && (
            <div className="px-3 pb-3 border-t border-white/5 pt-2">
              <OutputRenderer
                result={JSON.stringify(record.data)}
                outputType={app.output_type || 'json'}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
