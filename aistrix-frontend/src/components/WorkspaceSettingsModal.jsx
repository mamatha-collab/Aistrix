import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, LogOut, Mail, Trash2, X } from 'lucide-react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { ROLE_LABELS, canManage } from '../hooks/useWorkspaces'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const INVITE_ROLES = ['admin', 'developer', 'member', 'billing']
const ROLE_HELP = {
  owner: 'Everything, including deleting the workspace',
  admin: 'Manage people, apps, keys and settings',
  developer: 'Build and edit apps, see prompts, create API keys',
  member: 'Use the workspace’s apps and shared knowledge',
  billing: 'Buy apps and manage billing',
}

export default function WorkspaceSettingsModal({ workspace, user, onClose, onChanged, onLeft }) {
  const modalRef = useRef(null)
  useFocusTrap(modalRef, { onEscape: onClose })
  const toast = useToast()
  const manage = canManage(workspace)
  const isOwner = workspace.role === 'owner'
  const [name, setName] = useState(workspace.name)
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState(false)
  const [lastLink, setLastLink] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('workspace_member_list', { p_workspace_id: workspace.id })
    if (error) toast(error.message, 'error'); else setMembers(data || [])
    if (manage) {
      const { data: inv } = await supabase.from('workspace_invites')
        .select('id, email, role, token, expires_at')
        .eq('workspace_id', workspace.id).is('accepted_at', null)
        .order('created_at', { ascending: false })
      setInvites(inv || [])
    }
  }, [workspace.id, manage, toast])

  useEffect(() => { load() }, [load])

  const inviteLink = token => `${window.location.origin}/invite/${token}`
  const copy = text => { navigator.clipboard.writeText(text); toast('Link copied', 'success', 2000) }

  async function rename(e) {
    e.preventDefault()
    if (!name.trim() || name.trim() === workspace.name) return
    const { error } = await supabase.from('workspaces').update({ name: name.trim() }).eq('id', workspace.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Workspace renamed', 'success')
    onChanged()
  }

  async function invite(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/v1/workspaces/${workspace.id}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.detail || 'Could not send invite')
      setLastLink({ email: body.email, url: body.invite_url, sent: body.email_sent })
      toast(body.email_sent ? `Invite emailed to ${body.email}` : 'Invite created — copy the link to share it', 'success', 5000)
      setEmail('')
      load()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id) {
    const { error } = await supabase.from('workspace_invites').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setInvites(list => list.filter(i => i.id !== id))
  }

  async function changeRole(memberId, next) {
    const { error } = await supabase.from('workspace_members').update({ role: next })
      .eq('workspace_id', workspace.id).eq('user_id', memberId)
    if (error) { toast(error.message, 'error'); return }
    toast('Role updated', 'success', 2000)
    load()
    if (memberId === user.id) onChanged()
  }

  async function remove(memberId, label) {
    if (!window.confirm(`Remove ${label} from ${workspace.name}? They lose access immediately.`)) return
    const { error } = await supabase.from('workspace_members').delete()
      .eq('workspace_id', workspace.id).eq('user_id', memberId)
    if (error) { toast(error.message, 'error'); return }
    load()
  }

  async function leave() {
    if (!window.confirm(`Leave ${workspace.name}? You'll lose access to its apps and data.`)) return
    const { error } = await supabase.from('workspace_members').delete()
      .eq('workspace_id', workspace.id).eq('user_id', user.id)
    if (error) { toast(error.message, 'error'); return }
    toast(`You left ${workspace.name}`, 'info')
    onLeft()
  }

  async function destroy() {
    const typed = window.prompt(`This deletes the ${workspace.name} workspace and removes everyone from it. Apps stay with the people who created them.\n\nType the workspace name to confirm:`)
    if (typed !== workspace.name) return
    const { error } = await supabase.from('workspaces').delete().eq('id', workspace.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Workspace deleted', 'info')
    onLeft()
  }

  const fieldCls = 'bg-[#0F1225] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]'

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={`${workspace.name} settings`}
        className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div>
            <p className="text-white font-semibold">{workspace.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">You're {ROLE_LABELS[workspace.role]?.toLowerCase() || workspace.role} · {members.length} member{members.length === 1 ? '' : 's'}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          {manage && (
            <form onSubmit={rename} className="space-y-1.5">
              <label className="text-xs text-slate-400 uppercase">Name</label>
              <div className="flex gap-2">
                <input value={name} onChange={e => setName(e.target.value)} maxLength={80} className={`${fieldCls} flex-1`} />
                <button type="submit" disabled={!name.trim() || name.trim() === workspace.name}
                  className="bg-[#1F2444] hover:bg-[#272C52] disabled:opacity-40 text-slate-200 text-sm px-4 rounded-lg">Save</button>
              </div>
            </form>
          )}

          {manage && (
            <section className="space-y-2">
              <p className="text-xs text-slate-400 uppercase">Invite people</p>
              <form onSubmit={invite} className="flex flex-wrap gap-2">
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="name@company.com" className={`${fieldCls} flex-1 min-w-[200px]`} />
                <select value={role} onChange={e => setRole(e.target.value)} className={fieldCls} aria-label="Role for the invite">
                  {INVITE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
                <button type="submit" disabled={busy || !email.trim()}
                  className="flex items-center gap-1.5 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-4 py-2 rounded-lg">
                  <Mail size={14} /> {busy ? 'Sending…' : 'Invite'}
                </button>
              </form>
              <p className="text-[11px] text-slate-500">{ROLE_HELP[role]}</p>
              {lastLink && (
                <div className="flex items-center gap-2 bg-[#0F1225] border border-emerald-500/25 rounded-lg px-3 py-2">
                  <span className="text-xs text-emerald-300 shrink-0">{lastLink.sent ? 'Emailed' : 'Share this link'} · {lastLink.email}</span>
                  <code className="text-[11px] text-slate-300 truncate flex-1">{lastLink.url}</code>
                  <button onClick={() => copy(lastLink.url)} aria-label="Copy invite link" className="text-slate-400 hover:text-white"><Copy size={14} /></button>
                </div>
              )}
              {invites.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] text-slate-500">Pending invites</p>
                  {invites.map(i => (
                    <div key={i.id} className="flex items-center gap-2 bg-[#1F2444] rounded-lg px-3 py-2">
                      <span className="text-sm text-slate-200 flex-1 truncate">{i.email}</span>
                      <span className="text-[11px] text-slate-400">{ROLE_LABELS[i.role]}</span>
                      <span className="text-[11px] text-slate-500 hidden sm:inline">expires {new Date(i.expires_at).toLocaleDateString()}</span>
                      <button onClick={() => copy(inviteLink(i.token))} aria-label={`Copy invite link for ${i.email}`} className="text-slate-400 hover:text-white"><Copy size={14} /></button>
                      <button onClick={() => revoke(i.id)} aria-label={`Revoke invite for ${i.email}`} className="text-slate-400 hover:text-red-400"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
            <p className="text-xs text-slate-400 uppercase">Members</p>
            <div className="divide-y divide-white/5 bg-[#1F2444] rounded-xl">
              {members.map(m => {
                const label = m.full_name || m.email
                const self = m.user_id === user.id
                const editable = manage && !self && (m.role !== 'owner' || isOwner)
                return (
                  <div key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{label}{self && <span className="text-slate-500"> (you)</span>}</p>
                      {m.full_name && <p className="text-[11px] text-slate-500 truncate">{m.email}</p>}
                    </div>
                    {editable ? (
                      <select value={m.role} onChange={e => changeRole(m.user_id, e.target.value)}
                        className={`${fieldCls} py-1 text-xs`} aria-label={`Role for ${label}`}>
                        {(isOwner ? ['owner', ...INVITE_ROLES] : INVITE_ROLES).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-400">{ROLE_LABELS[m.role] || m.role}</span>
                    )}
                    {editable && (
                      <button onClick={() => remove(m.user_id, label)} aria-label={`Remove ${label}`} className="text-slate-500 hover:text-red-400"><Trash2 size={14} /></button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
            <button onClick={leave}
              className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white bg-[#1F2444] hover:bg-[#272C52] px-3 py-2 rounded-lg">
              <LogOut size={14} /> Leave workspace
            </button>
            {isOwner && (
              <button onClick={destroy}
                className="flex items-center gap-1.5 text-sm text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 px-3 py-2 rounded-lg">
                <Trash2 size={14} /> Delete workspace
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
