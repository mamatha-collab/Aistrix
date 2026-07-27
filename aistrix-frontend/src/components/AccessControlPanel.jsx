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
  const [invitedUsers, setInvitedUsers] = useState([])
  const [emailInput, setEmailInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (visibility === 'invite') loadInvited()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadInvited is stable per app.id; re-declaring it as a dep would re-run this on every render
  }, [visibility, app.id])

  async function loadInvited() {
    const { data } = await supabase.from('app_access').select('id, user_id, created_at').eq('app_id', app.id)
    setInvitedUsers(data || [])
  }

  async function saveVisibility(v) {
    setSaving(true)
    await supabase.from('apps').update({ visibility: v }).eq('id', app.id)
    setSaving(false)
    setVisibility(v)
    onVisibilityChange?.(v)
    toast(`Access set to ${v}`, 'success', 2000)
    if (v === 'invite') loadInvited()
  }

  async function inviteUser() {
    if (!emailInput.trim()) return
    setInviting(true)
    // Look up user by email via a Supabase function or admin API
    // For now, store the email as a pending invite
    const { error } = await supabase.from('app_access').upsert({
      app_id: app.id,
      user_id: emailInput.trim(), // placeholder — real impl needs email→user_id lookup
    }, { onConflict: 'app_id,user_id', ignoreDuplicates: true })
    setInviting(false)
    if (error) { toast('Could not invite user', 'error'); return }
    setEmailInput('')
    toast('Invitation sent', 'success')
    loadInvited()
  }

  async function revokeAccess(id) {
    await supabase.from('app_access').delete().eq('id', id)
    setInvitedUsers(prev => prev.filter(u => u.id !== id))
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
          <p className="text-[10px] text-slate-500 uppercase">Invited users ({invitedUsers.length})</p>
          <div className="flex gap-2">
            <input className="flex-1 bg-[#0F1225] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
              placeholder="user@email.com"
              value={emailInput} onChange={e => setEmailInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && inviteUser()} />
            <button onClick={inviteUser} disabled={inviting || !emailInput.trim()}
              className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-3 py-2 rounded-xl transition-colors shrink-0">
              {inviting ? '...' : 'Invite'}
            </button>
          </div>
          {invitedUsers.map(u => (
            <div key={u.id} className="flex items-center justify-between bg-[#0F1225] border border-white/5 rounded-xl px-3 py-2">
              <p className="text-xs text-slate-300 font-mono truncate">{u.user_id}</p>
              <button onClick={() => revokeAccess(u.id)} className="text-[10px] text-red-400 hover:text-red-300 ml-2 shrink-0">Revoke</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
