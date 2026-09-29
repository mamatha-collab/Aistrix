/**
 * VersionManager — snapshot, browse and roll back prompt versions.
 *
 * Required table (run once in Supabase SQL editor):
 *
 *   create table app_versions (
 *     id            uuid primary key default gen_random_uuid(),
 *     app_id        uuid references apps(id) on delete cascade,
 *     user_id       uuid references auth.users(id) on delete cascade,
 *     version_num   int  not null default 1,
 *     system_prompt text,
 *     ai_model      text,
 *     ai_provider   text,
 *     label         text,
 *     created_at    timestamptz default now()
 *   );
 *   alter table app_versions enable row level security;
 *   create policy "owner" on app_versions
 *     using  (auth.uid() = user_id)
 *     with check (auth.uid() = user_id);
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'

export const VERSION_SETUP_SQL = `create table app_versions (
  id            uuid primary key default gen_random_uuid(),
  app_id        uuid references apps(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  version_num   int  not null default 1,
  system_prompt text,
  ai_model      text,
  ai_provider   text,
  label         text,
  created_at    timestamptz default now()
);
alter table app_versions enable row level security;
create policy "owner" on app_versions
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);`

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useVersions(appId, userId) {
  const [versions, setVersions]     = useState([])
  const [loading, setLoading]       = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)

  const load = useCallback(async () => {
    if (!appId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .eq('app_id', appId)
      .eq('user_id', userId)
      .order('version_num', { ascending: false })
    setLoading(false)
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) setNeedsSetup(true)
      return
    }
    setNeedsSetup(false)
    setVersions(data || [])
  }, [appId, userId])

  useEffect(() => { load() }, [load])

  return { versions, loading, needsSetup, reload: load, setVersions }
}

// Save a new version snapshot (called by PromptStudio on save)
export async function saveVersionSnapshot(app, userId, prompt) {
  try {
    const { count } = await supabase
      .from('app_versions')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', app.id)
      .eq('user_id', userId)
    await supabase.from('app_versions').insert({
      app_id: app.id,
      user_id: userId,
      version_num: (count ?? 0) + 1,
      system_prompt: prompt,
      ai_model: app.ai_model,
      ai_provider: app.ai_provider,
    })
  } catch { /* silently fail if table doesn't exist yet */ }
}

// ─── Setup card ──────────────────────────────────────────────────────────────

export function VersionSetupCard({ onRetry }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(VERSION_SETUP_SQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="bg-[#171B33] border border-amber-500/20 rounded-2xl p-6 space-y-4">
      <div>
        <p className="text-amber-400 font-semibold text-sm">⚙️ One-time setup required</p>
        <p className="text-slate-400 text-sm mt-1">Run this SQL in your Supabase dashboard to enable version history.</p>
      </div>
      <div className="relative">
        <pre className="text-[11px] text-slate-300 bg-[#0E1424] rounded-xl p-4 overflow-x-auto leading-relaxed">{VERSION_SETUP_SQL}</pre>
        <button onClick={copy}
          className="absolute top-2 right-2 text-[10px] text-slate-400 hover:text-white bg-white/5 px-2 py-1 rounded-md transition-colors">
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <button onClick={onRetry}
        className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
        ↺ I ran it — retry
      </button>
    </div>
  )
}

// ─── Version list component ──────────────────────────────────────────────────

export default function VersionManager({ app, user, onRollback, selectedId, onSelect }) {
  const { versions, loading, needsSetup, reload, setVersions } = useVersions(app.id, user.id)
  const [saving, setSaving]     = useState(false)
  const [editLabelId, setEditLabelId] = useState(null)
  const [labelDraft, setLabelDraft]   = useState('')
  const [expandId, setExpandId] = useState(null)
  const toast = useToast()

  async function saveSnapshot() {
    if (!app.system_prompt?.trim()) {
      toast('App has no system prompt — write one in Prompt Studio first', 'error', 4000)
      return
    }
    setSaving(true)
    const { count } = await supabase
      .from('app_versions')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', app.id)
      .eq('user_id', user.id)

    const { data, error } = await supabase.from('app_versions').insert({
      app_id: app.id, user_id: user.id,
      version_num: (count ?? 0) + 1,
      system_prompt: app.system_prompt,
      ai_model: app.ai_model,
      ai_provider: app.ai_provider,
    }).select().single()
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setVersions(prev => [data, ...prev])
    toast(`v${data.version_num} saved`, 'success', 2000)
  }

  async function rollback(v) {
    const { error } = await supabase.from('apps')
      .update({ system_prompt: v.system_prompt, ai_model: v.ai_model, ai_provider: v.ai_provider })
      .eq('id', app.id)
    if (error) { toast(error.message, 'error'); return }
    onRollback?.({ ...app, system_prompt: v.system_prompt, ai_model: v.ai_model, ai_provider: v.ai_provider })
    toast(`Rolled back to v${v.version_num}`, 'success', 3000)
  }

  async function saveLabel(v) {
    const { error } = await supabase.from('app_versions').update({ label: labelDraft.trim() || null }).eq('id', v.id)
    if (error) { toast(error.message, 'error'); return }
    setVersions(prev => prev.map(x => x.id === v.id ? { ...x, label: labelDraft.trim() || null } : x))
    setEditLabelId(null)
  }

  async function deleteVersion(id) {
    const { error } = await supabase.from('app_versions').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setVersions(prev => prev.filter(v => v.id !== id))
  }

  if (needsSetup) return <VersionSetupCard onRetry={reload} />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">
          {versions.length} snapshot{versions.length !== 1 ? 's' : ''} saved
        </p>
        <button onClick={saveSnapshot} disabled={saving}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
          {saving ? '…' : '📸 Save snapshot'}
        </button>
      </div>

      {loading && <p className="text-slate-500 text-sm text-center py-4">Loading…</p>}

      {!loading && versions.length === 0 && (
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">No snapshots yet.</p>
          <p className="text-slate-600 text-xs mt-1">
            Click "Save snapshot" to capture the current prompt state, or snapshots are saved automatically each time you save in Prompt Studio.
          </p>
        </div>
      )}

      {versions.map(v => {
        const isSelected = selectedId === v.id
        const isExpanded = expandId === v.id
        return (
          <div
            key={v.id}
            onClick={() => onSelect?.(v)}
            className={`rounded-xl border transition-all cursor-pointer ${isSelected ? 'border-[#6C5CE7]/50 bg-[#6C5CE7]/8' : 'border-white/5 bg-[#0E1424] hover:border-white/10'}`}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${isSelected ? 'bg-[#6C5CE7] text-white' : 'bg-white/5 text-slate-400'}`}>
                v{v.version_num}
              </span>
              <div className="flex-1 min-w-0">
                {editLabelId === v.id ? (
                  <input
                    autoFocus
                    value={labelDraft}
                    onChange={e => setLabelDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveLabel(v); if (e.key === 'Escape') setEditLabelId(null) }}
                    onBlur={() => saveLabel(v)}
                    onClick={e => e.stopPropagation()}
                    placeholder="Add a label (e.g. 'Improved tone')"
                    className="bg-transparent text-white text-xs focus:outline-none border-b border-[#6C5CE7] w-full pb-0.5"
                  />
                ) : (
                  <p className="text-white text-xs font-medium truncate">
                    {v.label || `Snapshot v${v.version_num}`}
                    <button
                      onClick={e => { e.stopPropagation(); setLabelDraft(v.label || ''); setEditLabelId(v.id) }}
                      className="ml-1.5 text-slate-600 hover:text-slate-400 text-[9px]">✎</button>
                  </p>
                )}
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                  <span>{timeAgo(v.created_at)}</span>
                  {v.ai_model && <span>· {v.ai_provider === 'openai' ? '🟢' : '🟣'} {v.ai_model.split('-').slice(0, 3).join('-')}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                <button onClick={() => setExpandId(p => p === v.id ? null : v.id)}
                  className="text-[10px] text-slate-500 hover:text-white bg-white/5 px-2 py-1 rounded-md transition-colors">
                  {isExpanded ? 'Hide' : 'View'}
                </button>
                <button onClick={() => rollback(v)}
                  className="text-[10px] text-[#A29BFE] hover:text-white bg-[#6C5CE7]/10 hover:bg-[#6C5CE7]/20 px-2 py-1 rounded-md transition-colors border border-[#6C5CE7]/20">
                  ↺ Restore
                </button>
                <button onClick={() => deleteVersion(v.id)}
                  className="text-[10px] text-slate-600 hover:text-red-400 transition-colors px-1">×</button>
              </div>
            </div>
            {isExpanded && (
              <div className="px-4 pb-3 border-t border-white/5 pt-3">
                <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1.5">Prompt at this snapshot</p>
                <pre className="text-[11px] text-slate-400 bg-[#09101F] rounded-lg p-3 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto font-mono">
                  {v.system_prompt || '(empty prompt)'}
                </pre>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
