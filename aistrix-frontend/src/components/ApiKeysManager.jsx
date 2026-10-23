import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'
import { scopeToWorkspace } from '../lib/workspace'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Developer API keys. The backend generates each key and stores only its
// SHA-256 hash, so the full key is shown exactly once, right after creation.
export default function ApiKeysManager({ user }) {
  const [keys, setKeys] = useState([])
  const [apps, setApps] = useState([])
  const [newKeyName, setNewKeyName] = useState('')
  const [scopeAppIds, setScopeAppIds] = useState([])
  const [creating, setCreating] = useState(false)
  const [freshKey, setFreshKey] = useState(null) // { id, key } — shown once
  const toast = useToast()

  useEffect(() => {
    loadKeys()
    scopeToWorkspace(supabase.from('apps').select('id, name, emoji'), user, 'created_by').order('name')
      .then(({ data }) => setApps(data || []))
  }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadKeys() {
    const { data } = await scopeToWorkspace(supabase.from('developer_api_keys')
      .select('id, name, key_prefix, app_ids, is_active, last_used_at, total_calls, created_at'), user)
      .order('created_at', { ascending: false })
    if (data) setKeys(data)
  }

  async function createKey() {
    if (!newKeyName.trim()) return
    setCreating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/v1/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ name: newKeyName.trim(), app_ids: scopeAppIds }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.detail || 'Could not create key')
      setFreshKey({ id: body.id, key: body.key })
      setNewKeyName(''); setScopeAppIds([])
      await loadKeys()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id) {
    const { error } = await supabase.from('developer_api_keys').update({ is_active: false }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setKeys(prev => prev.map(k => k.id === id ? { ...k, is_active: false } : k))
    toast('Key revoked', 'info')
  }

  async function deleteKey(id) {
    const { error } = await supabase.from('developer_api_keys').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setKeys(prev => prev.filter(k => k.id !== id))
    if (freshKey?.id === id) setFreshKey(null)
  }

  const appName = id => { const a = apps.find(x => x.id === id); return a ? `${a.emoji || ''} ${a.name}`.trim() : id.slice(0, 8) }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2">
          <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createKey()}
            placeholder="Key name (e.g. Production, Zapier)"
            className="flex-1 bg-[#1F2444] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]" />
          <button onClick={createKey} disabled={creating || !newKeyName.trim()}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] disabled:opacity-40 text-white transition-colors">
            {creating ? '…' : '+ Create key'}
          </button>
        </div>
        {apps.length > 0 && (
          <details className="text-[11px] text-slate-400">
            <summary className="cursor-pointer hover:text-white">
              Restrict to specific apps {scopeAppIds.length > 0 && `(${scopeAppIds.length} selected)`} — optional
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {apps.map(a => {
                const on = scopeAppIds.includes(a.id)
                return (
                  <button key={a.id} type="button"
                    onClick={() => setScopeAppIds(ids => on ? ids.filter(x => x !== a.id) : [...ids, a.id])}
                    className={`px-2 py-1 rounded-lg border transition-colors ${on ? 'border-[#6C5CE7] bg-[#6C5CE7]/15 text-white' : 'border-white/10 bg-[#1F2444] text-slate-400 hover:text-white'}`}>
                    {a.emoji} {a.name}
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-slate-600 mt-1.5">No selection = the key works for every app you can run.</p>
          </details>
        )}
      </div>

      {freshKey && (
        <div className="bg-[#0F1225] border border-emerald-500/30 rounded-xl p-3 space-y-2">
          <p className="text-xs text-emerald-300 font-medium">Copy your new key now — it won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-white flex-1 break-all font-mono">{freshKey.key}</code>
            <button onClick={() => { navigator.clipboard.writeText(freshKey.key); toast('Copied!', 'success', 2000) }}
              className="text-xs text-white bg-[#6C5CE7] hover:bg-[#7C6CFF] px-2.5 py-1 rounded-lg shrink-0">Copy</button>
          </div>
          <button onClick={() => setFreshKey(null)} className="text-[10px] text-slate-500 hover:text-white">I've saved it</button>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-4">No API keys yet. Create one to call your apps from code.</p>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k.id} className={`bg-[#1F2444] border border-white/5 rounded-xl p-3 ${k.is_active ? '' : 'opacity-50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-xs font-medium">{k.name}</span>
                    {!k.is_active && <span className="text-[9px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">Revoked</span>}
                  </div>
                  <code className="text-[11px] text-slate-500 font-mono">{k.key_prefix || 'ak_live_'}{'•'.repeat(12)}</code>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Created {timeAgo(k.created_at)} · {k.total_calls || 0} calls{k.last_used_at ? ` · last used ${timeAgo(k.last_used_at)}` : ''}
                  </p>
                  {k.app_ids?.length > 0 && (
                    <p className="text-[10px] text-slate-400 mt-0.5">Only: {k.app_ids.map(appName).join(', ')}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {k.is_active && <button onClick={() => revokeKey(k.id)} className="text-[10px] text-slate-500 hover:text-orange-400 transition-colors">Revoke</button>}
                  <button onClick={() => deleteKey(k.id)} className="text-[10px] text-slate-500 hover:text-red-400 transition-colors">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
