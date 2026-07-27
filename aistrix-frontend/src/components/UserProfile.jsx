import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

const AVATAR_COLORS = ['#6C5CE7','#E84393','#00B894','#0984E3','#FDCB6E','#E17055','#74B9FF','#A29BFE','#55EFC4','#FD79A8']

export default function UserProfile({ user, onClose }) {
  const meta = user.user_metadata || {}
  const [displayName, setDisplayName] = useState(meta.display_name || '')
  const [avatarColor, setAvatarColor] = useState(meta.avatar_color || '#6C5CE7')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const initial = (displayName || user.email || '?')[0].toUpperCase()

  async function save() {
    setSaving(true)
    const { error } = await supabase.auth.updateUser({
      data: { display_name: displayName.trim(), avatar_color: avatarColor },
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Profile updated', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <p className="text-white font-medium">Your Profile</p>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Avatar preview */}
          <div className="flex justify-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg"
              style={{ background: avatarColor }}
            >
              {initial}
            </div>
          </div>

          {/* Avatar color */}
          <div>
            <label className="text-xs text-slate-400 block mb-2">Avatar color</label>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setAvatarColor(c)}
                  className={`w-7 h-7 rounded-full transition-all ${avatarColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#171B33] scale-110' : 'hover:scale-105'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* Display name */}
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Display name</label>
            <input
              className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
              placeholder="Your name"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Email</label>
            <p className="text-sm text-slate-500 bg-[#1F2444] rounded-xl px-3 py-2.5">{user.email}</p>
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="w-full bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm py-2.5 rounded-xl font-medium transition-colors"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
