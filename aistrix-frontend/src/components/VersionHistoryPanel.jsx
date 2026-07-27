import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { timeAgo } from '../utils'
import { useToast } from '../hooks/useToast'

export default function VersionHistoryPanel({ app, onRestored }) {
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [restoring, setRestoring] = useState(null)
  const toast = useToast()

  useEffect(() => {
    supabase.from('app_versions')
      .select('*').eq('app_id', app.id)
      .order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => { setVersions(data || []); setLoading(false) })
  }, [app.id])

  async function restore(version) {
    setRestoring(version.id)
    const vd = version.version_data
    const { error } = await supabase.from('apps').update({
      name: vd.name, emoji: vd.emoji, description: vd.description,
      system_prompt: vd.system_prompt, ai_provider: vd.ai_provider,
      ai_model: vd.ai_model, tags: vd.tags,
      input_placeholder: vd.input_placeholder, domain_id: vd.domain_id,
    }).eq('id', app.id)
    setRestoring(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Version restored', 'success')
    onRestored?.()
  }

  if (loading) return <p className="text-slate-500 text-xs py-2">Loading...</p>
  if (versions.length === 0) return (
    <p className="text-slate-500 text-xs py-2">No versions yet. Versions are saved each time you edit this app.</p>
  )

  return (
    <div className="space-y-2">
      {versions.map((v, i) => (
        <div key={v.id} className="bg-[#0F1225] border border-white/5 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-white/3 transition-colors"
            onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
            <div>
              <p className="text-xs text-white font-medium">{v.version_data?.name || 'Unnamed'}</p>
              <p className="text-[10px] text-slate-500">{timeAgo(v.created_at)}{i === 0 ? ' · Latest saved' : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={e => { e.stopPropagation(); restore(v) }}
                disabled={!!restoring}
                className="text-[10px] text-[#6C5CE7] hover:text-white bg-[#6C5CE7]/10 hover:bg-[#6C5CE7] px-2 py-1 rounded-lg transition-colors disabled:opacity-40">
                {restoring === v.id ? '...' : 'Restore'}
              </button>
              <span className="text-slate-500 text-[10px]">{expanded === v.id ? '▲' : '▼'}</span>
            </div>
          </div>
          {expanded === v.id && v.version_data?.system_prompt && (
            <div className="px-3 pb-3 border-t border-white/5 pt-2">
              <p className="text-[10px] text-slate-500 uppercase mb-1">System Prompt</p>
              <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-4">{v.version_data.system_prompt}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
