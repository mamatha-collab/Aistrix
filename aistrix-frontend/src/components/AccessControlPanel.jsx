import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

const VISIBILITY_OPTIONS = [
  { id: 'public',  icon: '🌐', label: 'Public',  desc: 'Anyone on Aistrix can discover and use this app' },
  { id: 'private', icon: '🔒', label: 'Private', desc: 'Only you can see and run this app' },
  { id: 'invite',  icon: '✉️', label: 'Invite only', desc: 'Only people you invite can use this app' },
]

export default function AccessControlPanel({ app, onVisibilityChange }) {
  const [visibility, setVisibility] = useState(app.visibility || 'public')
  const [members, setMembers] = useState([])
  const [emailInput, setEmailInput] = useState('')
  const [role, setRole] = useState('viewer')
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (visibility === 'invite') loadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMembers is stable per app.id; re-declaring it as a dep would re-run this on every render
  }, [visibility, app.id])

  async function loadMembers() {
    const { data } = await supabase.from('app_members').select('id, invited_email, role, created_at').eq('app_id', app.id).order('created_at')
    setMembers(data || [])
  }

  async function saveVisibility(v) {
    setSaving(true)
    const { error } = await supabase.from('apps').update({ visibility: v }).eq('id', app.id)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setVisibility(v)
    onVisibilityChange?.(v)
    toast(`Access set to ${v}`, 'success', 2000)
    if (v === 'invite') loadMembers()
  }

  async function inviteUser() {
    if (!emailInput.trim()) return
    setInviting(true)
    const { data, error } = await supabase.from('app_members')
      .insert({ app_id: app.id, invited_email: emailInput.trim().toLowerCase(), role }).select().single()
    setInviting(false)
    if (error) { toast(error.message, 'error'); return }
    setMembers(prev => [...prev, data])
    setEmailInput('')
    toast(`Invited ${data.invited_email}`, 'success')
  }

  async function revokeAccess(id) {
    const { error } = await supabase.from('app_members').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setMembers(prev => prev.filter(m => m.id !== id))
    toast('Access revoked', 'info', 2000)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {VISIBILITY_OPTIONS.map(opt => (
          <button key={opt.id} onClick={() => saveVisibility(opt.id)} disabled={saving}
            className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${visibility === opt.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10' : 'border-white/5 bg-[#0F1225] hover:border-white/20'}`}>
            <span className="text-lg mt-0.5">{opt.icon}</span>
            <div>
              <p className={`text-sm font-medium ${visibility === opt.id ? 'text-white' : 'text-slate-300'}`}>{opt.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
            </div>
            {visibility === opt.id && <span className="ml-auto text-[#6C5CE7] text-xs shrink-0 mt-0.5">✓ Active</span>}
          </button>
        ))}
      </div>

      {visibility === 'invite' && (
        <div className="space-y-2 pt-1">
          <p className="text-[10px] text-slate-500 uppercase">Invited users ({members.length})</p>
          <div className="flex gap-2">
            <input className="flex-1 bg-[#0F1225] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
              placeholder="user@email.com"
              value={emailInput} onChange={e => setEmailInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && inviteUser()} />
            <select value={role} onChange={e => setRole(e.target.value)}
              className="bg-[#0F1225] border border-white/10 rounded-xl px-2 text-xs text-white focus:outline-none focus:border-[#6C5CE7] shrink-0">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button onClick={inviteUser} disabled={inviting || !emailInput.trim()}
              className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-3 py-2 rounded-xl transition-colors shrink-0">
              {inviting ? '...' : 'Invite'}
            </button>
          </div>
          {members.length === 0 ? (
            <p className="text-slate-500 text-xs">No teammates added yet. Viewers can run this app; editors can also edit its config.</p>
          ) : members.map(m => (
            <div key={m.id} className="flex items-center justify-between bg-[#0F1225] border border-white/5 rounded-xl px-3 py-2">
              <p className="text-xs text-slate-300 truncate">{m.invited_email} <span className="text-slate-500">· {m.role}</span></p>
              <button onClick={() => revokeAccess(m.id)} className="text-[10px] text-red-400 hover:text-red-300 ml-2 shrink-0">Revoke</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
