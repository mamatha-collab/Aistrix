import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'

const SCHEDULE_TYPES = [
  { id: 'daily',   label: 'Daily',   desc: 'Every day at a set time' },
  { id: 'weekly',  label: 'Weekly',  desc: 'Once a week on a set day' },
  { id: 'monthly', label: 'Monthly', desc: 'Once a month on a set date' },
]

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function computeNextRun(type, time, day) {
  const [h, m] = time.split(':').map(Number)
  const now = new Date()
  const next = new Date()
  next.setSeconds(0); next.setMilliseconds(0)
  next.setHours(h, m, 0, 0)

  if (type === 'daily') {
    if (next <= now) next.setDate(next.getDate() + 1)
    return next
  }
  if (type === 'weekly') {
    const targetDay = day ?? 1
    next.setDate(now.getDate() + ((7 + targetDay - now.getDay()) % 7))
    if (next <= now) next.setDate(next.getDate() + 7)
    return next
  }
  if (type === 'monthly') {
    const targetDate = day ?? 1
    next.setDate(targetDate)
    if (next <= now) { next.setMonth(next.getMonth() + 1); next.setDate(targetDate) }
    return next
  }
  return next
}

function EventCard({ event, onToggle, onDelete, onRunNow }) {
  const isDue = event.next_run_at && new Date(event.next_run_at) <= new Date()
  const scheduleLabel = event.schedule_type === 'daily' ? `Daily at ${event.schedule_time}`
    : event.schedule_type === 'weekly' ? `Weekly on ${DAYS[event.schedule_day ?? 1]} at ${event.schedule_time}`
    : `Monthly on day ${event.schedule_day ?? 1} at ${event.schedule_time}`

  return (
    <div className={`bg-[#171B33] border rounded-2xl p-5 transition-all ${isDue && event.is_active ? 'border-[#6C5CE7]/40' : 'border-white/5'} ${!event.is_active ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#1F2444] rounded-xl flex items-center justify-center text-xl shrink-0">
            {event.app_emoji || '⚡'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-white text-sm font-medium">{event.name}</p>
              {isDue && event.is_active && (
                <span className="text-[10px] text-[#6C5CE7] bg-[#6C5CE7]/10 px-1.5 py-0.5 rounded-full animate-pulse">Due now</span>
              )}
            </div>
            <p className="text-xs text-slate-400">{event.app_name} · {scheduleLabel}</p>
            {event.last_run_at && (
              <p className="text-[10px] text-slate-500 mt-0.5">Last run {timeAgo(event.last_run_at)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => onToggle(event)}
            className={`relative w-8 h-4 rounded-full transition-colors ${event.is_active ? 'bg-[#6C5CE7]' : 'bg-[#1F2444]'}`}>
            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${event.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <button onClick={() => onDelete(event.id)} className="text-slate-600 hover:text-red-400 text-sm transition-colors">🗑</button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 text-xs text-slate-500 bg-[#1F2444] rounded-lg px-3 py-2 font-mono truncate">
          {event.input_template}
        </div>
        <button onClick={() => onRunNow(event)}
          className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-xs px-3 py-2 rounded-lg transition-colors shrink-0 font-medium">
          ▶ Run now
        </button>
      </div>
    </div>
  )
}

function EventForm({ apps, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [appId, setAppId] = useState('')
  const [input, setInput] = useState('')
  const [type, setType] = useState('daily')
  const [time, setTime] = useState('09:00')
  const [day, setDay] = useState(1)

  function save() {
    if (!name.trim() || !appId || !input.trim()) return
    const chosen = apps.find(a => a.id === appId)
    const nextRun = computeNextRun(type, time, day)
    onSave({
      name: name.trim(), app_id: appId,
      app_name: chosen?.name, app_emoji: chosen?.emoji,
      input_template: input.trim(),
      schedule_type: type, schedule_time: time, schedule_day: day,
      next_run_at: nextRun.toISOString(),
    })
  }

  return (
    <div className="bg-[#1F2444] border border-[#6C5CE7]/30 rounded-2xl p-5 space-y-4">
      <p className="text-white font-medium text-sm">New scheduled event</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Event name</label>
          <input className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            placeholder="e.g. Morning Market Summary" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">App to run</label>
          <select className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7] transition-colors"
            value={appId} onChange={e => setAppId(e.target.value)}>
            <option value="">Select an app...</option>
            {apps.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1.5">Input template</label>
        <textarea className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors"
          rows={2} placeholder="What should this event send to the app each time it runs..."
          value={input} onChange={e => setInput(e.target.value)} />
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-2">Schedule</label>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {SCHEDULE_TYPES.map(s => (
            <button key={s.id} onClick={() => setType(s.id)}
              className={`p-2.5 rounded-xl border text-left transition-all ${type === s.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10' : 'border-white/5 bg-[#171B33] hover:border-white/20'}`}>
              <p className={`text-xs font-medium ${type === s.id ? 'text-white' : 'text-slate-300'}`}>{s.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{s.desc}</p>
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-slate-400 block mb-1.5">Time</label>
            <input type="time" className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7] transition-colors"
              value={time} onChange={e => setTime(e.target.value)} />
          </div>
          {type === 'weekly' && (
            <div className="flex-1">
              <label className="text-xs text-slate-400 block mb-1.5">Day</label>
              <select className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7] transition-colors"
                value={day} onChange={e => setDay(Number(e.target.value))}>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          )}
          {type === 'monthly' && (
            <div className="flex-1">
              <label className="text-xs text-slate-400 block mb-1.5">Day of month</label>
              <input type="number" min={1} max={28}
                className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7] transition-colors"
                value={day} onChange={e => setDay(Number(e.target.value))} />
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={save} className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-5 py-2 rounded-xl font-medium transition-colors">
          Schedule event
        </button>
        <button onClick={onCancel} className="bg-[#171B33] hover:bg-[#272C52] text-slate-300 text-sm px-4 py-2 rounded-xl transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function EventsPage({ user, onRunEvent }) {
  const [events, setEvents] = useState([])
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const toast = useToast()

  useEffect(() => {
    Promise.all([
      supabase.from('scheduled_events').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('apps').select('id, name, emoji').eq('is_published', true).order('name'),
    ]).then(([{ data: e }, { data: a }]) => {
      setEvents(e ?? [])
      setApps(a ?? [])
      setLoading(false)
    })
  }, [user.id])

  async function createEvent(data) {
    const { data: row, error } = await supabase.from('scheduled_events')
      .insert({ ...data, user_id: user.id }).select().single()
    if (error) { toast(error.message, 'error'); return }
    setEvents(prev => [row, ...prev])
    setShowForm(false)
    toast('Event scheduled', 'success')
  }

  async function toggleEvent(event) {
    const next = !event.is_active
    await supabase.from('scheduled_events').update({ is_active: next }).eq('id', event.id)
    setEvents(prev => prev.map(e => e.id === event.id ? { ...e, is_active: next } : e))
  }

  async function deleteEvent(id) {
    await supabase.from('scheduled_events').delete().eq('id', id)
    setEvents(prev => prev.filter(e => e.id !== id))
    toast('Event deleted', 'info', 2000)
  }

  async function runNow(event) {
    const nextRun = computeNextRun(event.schedule_type, event.schedule_time, event.schedule_day)
    await supabase.from('scheduled_events').update({ last_run_at: new Date().toISOString(), next_run_at: nextRun.toISOString() }).eq('id', event.id)
    setEvents(prev => prev.map(e => e.id === event.id ? { ...e, last_run_at: new Date().toISOString(), next_run_at: nextRun.toISOString() } : e))
    onRunEvent?.(event)
    toast(`Running "${event.name}"...`, 'info')
  }

  const dueEvents = events.filter(e => e.is_active && e.next_run_at && new Date(e.next_run_at) <= new Date())
  const upcoming  = events.filter(e => !dueEvents.find(d => d.id === e.id))

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Events</h1>
          <p className="text-slate-400 text-sm mt-0.5">Schedule apps to run automatically on a recurring basis.</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-4 py-2 rounded-xl font-medium transition-colors shrink-0">
            + Schedule event
          </button>
        )}
      </div>

      {showForm && <EventForm apps={apps} onSave={createEvent} onCancel={() => setShowForm(false)} />}

      {loading ? <p className="text-slate-500 text-sm">Loading...</p> : (
        <>
          {dueEvents.length > 0 && (
            <div>
              <p className="text-xs text-[#6C5CE7] uppercase font-medium mb-3">● Due now</p>
              <div className="space-y-3">
                {dueEvents.map(e => <EventCard key={e.id} event={e} onToggle={toggleEvent} onDelete={deleteEvent} onRunNow={runNow} />)}
              </div>
            </div>
          )}

          {events.length === 0 && !showForm ? (
            <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
              <div className="text-4xl mb-3">📅</div>
              <p className="text-white font-medium mb-1">No scheduled events</p>
              <p className="text-slate-400 text-sm mb-5">Schedule apps to run daily, weekly, or monthly automatically — like a morning market summary or weekly report.</p>
              <button onClick={() => setShowForm(true)}
                className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-5 py-2.5 rounded-xl font-medium transition-colors">
                + Schedule your first event
              </button>
            </div>
          ) : (
            upcoming.length > 0 && (
              <div>
                {dueEvents.length > 0 && <p className="text-xs text-slate-500 uppercase font-medium mb-3 pt-2">Upcoming</p>}
                <div className="space-y-3">
                  {upcoming.map(e => <EventCard key={e.id} event={e} onToggle={toggleEvent} onDelete={deleteEvent} onRunNow={runNow} />)}
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}
