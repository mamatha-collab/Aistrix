import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Settings, User, Users } from 'lucide-react'
import { ROLE_LABELS } from '../hooks/useWorkspaces'

export default function WorkspaceSwitcher({ workspaces, active, onSwitch, onCreate, onManage }) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  if (!active) return null
  const Icon = active.is_personal ? User : Users

  async function create(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await onCreate(name)
      setName(''); setCreating(false); setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Workspace: ${active.name}`}
        className="app-chrome-button flex items-center gap-1.5 bg-[#1A2038] hover:bg-[#222840] text-slate-200 text-sm h-9 px-2.5 rounded-lg border border-transparent transition-colors max-w-[180px]"
      >
        <Icon size={15} className="shrink-0 text-[#A29BFE]" />
        <span className="hidden md:inline truncate">{active.is_personal ? 'Personal' : active.name}</span>
        <ChevronDown size={14} className="shrink-0 text-slate-400" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-72 bg-[#1A2038] border border-white/20 rounded-xl shadow-xl overflow-hidden z-50">
          <p className="px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-wide text-slate-400">Workspaces</p>
          <div className="max-h-72 overflow-y-auto">
            {workspaces.map(w => (
              <button key={w.id} role="menuitemradio" aria-checked={w.id === active.id}
                onClick={() => { setOpen(false); if (w.id !== active.id) onSwitch(w.id) }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5 transition-colors">
                <span className="w-7 h-7 rounded-lg bg-[#6C5CE7]/15 flex items-center justify-center shrink-0">
                  {w.is_personal ? <User size={14} className="text-[#A29BFE]" /> : <Users size={14} className="text-[#A29BFE]" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-white truncate">{w.is_personal ? 'Personal' : w.name}</span>
                  <span className="block text-[10px] text-slate-400">{w.is_personal ? 'Just you' : ROLE_LABELS[w.role] || w.role}</span>
                </span>
                {w.id === active.id && <Check size={15} className="text-[#A29BFE] shrink-0" />}
              </button>
            ))}
          </div>

          <div className="border-t border-white/10">
            {!active.is_personal && (
              <button onClick={() => { setOpen(false); onManage() }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-white/5">
                <Settings size={14} className="text-slate-400" /> Members & settings
              </button>
            )}
            {creating ? (
              <form onSubmit={create} className="p-3 space-y-2">
                <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80}
                  placeholder="Team name, e.g. Acme Marketing"
                  className="w-full bg-[#0F1225] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]" />
                {error && <p className="text-xs text-red-400">{error}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={busy || !name.trim()}
                    className="flex-1 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-xs font-medium py-2 rounded-lg">
                    {busy ? 'Creating…' : 'Create workspace'}
                  </button>
                  <button type="button" onClick={() => { setCreating(false); setError('') }}
                    className="px-3 text-xs text-slate-400 hover:text-white">Cancel</button>
                </div>
              </form>
            ) : (
              <button onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-white/5">
                <Plus size={14} className="text-slate-400" /> Create team workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
