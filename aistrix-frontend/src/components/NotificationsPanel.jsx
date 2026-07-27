import { useState, useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { supabase } from '../supabase'
import { timeAgo } from '../utils'

const TYPE_CONFIG = {
  alert:      { icon: '🔔', color: 'text-orange-400', bg: 'bg-orange-400/10' },
  goal:       { icon: '🎯', color: 'text-green-400',  bg: 'bg-green-400/10' },
  event:      { icon: '📅', color: 'text-blue-400',   bg: 'bg-blue-400/10' },
  system:     { icon: '⚡', color: 'text-[#6C5CE7]',  bg: 'bg-[#6C5CE7]/10' },
  payment:    { icon: '💳', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  app_update: { icon: '🧩', color: 'text-slate-400',  bg: 'bg-slate-400/10' },
}

export default function NotificationsPanel({ user, onNavChange }) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(false)
  const panelRef = useRef(null)

  const unread = notifications.filter(n => !n.is_read).length

  useEffect(() => {
    if (!user) return
    loadNotifications()

    // Real-time subscription
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        payload => setNotifications(prev => [payload.new, ...prev])
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when user changes
  }, [user])

  useEffect(() => {
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function loadNotifications() {
    setLoading(true)
    const { data } = await supabase.from('notifications')
      .select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(30)
    if (data) setNotifications(data)
    setLoading(false)
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  async function markRead(id) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  async function deleteAll() {
    await supabase.from('notifications').delete().eq('user_id', user.id)
    setNotifications([])
  }

  function handleClick(n) {
    markRead(n.id)
    if (n.link_view && onNavChange) onNavChange(n.link_view)
    setOpen(false)
  }

  return (
    <div className="relative w-9 shrink-0" ref={panelRef}>
      <button onClick={() => setOpen(v => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className={`app-chrome-button relative w-9 h-9 flex items-center justify-center rounded-lg text-[0px] transition-colors ${open ? 'bg-[#1F2444] text-white' : 'text-slate-400 hover:text-white hover:bg-[#1F2444]'}`}>
        <Bell size={16} />
        🔔
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#6C5CE7] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 bg-[#171B33] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <p className="text-white font-semibold text-sm">Notifications</p>
            <div className="flex gap-2">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-[10px] text-slate-400 hover:text-white transition-colors">
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button onClick={deleteAll} className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-slate-500 text-sm">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="notification-empty p-8 text-center">
                <Bell size={28} className="mx-auto mb-2 text-slate-500" />
                <p className="text-3xl mb-2">🔔</p>
                <p className="text-slate-400 text-sm font-medium">All caught up</p>
                <p className="text-slate-600 text-xs mt-1">Alerts, goals, and events will appear here</p>
              </div>
            ) : (
              notifications.map(n => {
                const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.system
                return (
                  <button key={n.id} onClick={() => handleClick(n)}
                    className={`w-full flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/[0.03] transition-colors text-left ${!n.is_read ? 'bg-[#6C5CE7]/5' : ''}`}>
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 mt-0.5 ${cfg.bg}`}>
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs font-medium ${n.is_read ? 'text-slate-300' : 'text-white'}`}>
                          {n.title}
                        </p>
                        {!n.is_read && <div className="w-2 h-2 rounded-full bg-[#6C5CE7] shrink-0 mt-1" />}
                      </div>
                      {n.message && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>}
                      <p className="text-[10px] text-slate-600 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
