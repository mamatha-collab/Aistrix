import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

export function ShareModal({ flow, onClose }) {
  const [members, setMembers] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  useEffect(() => {
    supabase.from('flow_members').select('*').eq('flow_id', flow.id).order('created_at')
      .then(({ data }) => { setMembers(data || []); setLoading(false) })
  }, [flow.id])

  async function invite() {
    if (!email.trim()) return
    const { data, error } = await supabase.from('flow_members')
      .insert({ flow_id: flow.id, invited_email: email.trim().toLowerCase(), role }).select().single()
    if (error) { toast(error.message, 'error'); return }
    setMembers(p => [...p, data]); setEmail('')
    toast(`Invited ${data.invited_email}`, 'success')
  }

  async function removeMember(id) {
    const { error } = await supabase.from('flow_members').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setMembers(p => p.filter(m => m.id !== id))
  }

  const inCls = 'flex-1 bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/18">
          <p className="text-white font-semibold">👥 Share "{flow.name}"</p>
          <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex gap-2">
            <input className={inCls} placeholder="teammate@email.com" value={email} onChange={e => setEmail(e.target.value)} />
            <select value={role} onChange={e => setRole(e.target.value)}
              className="bg-[#1A2038] border border-white/18 rounded-xl px-2 text-xs text-white focus:outline-none focus:border-[#6C5CE7]">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button onClick={invite} className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-4 rounded-xl font-medium transition-colors">Invite</button>
          </div>
          <div className="space-y-1.5">
            {loading ? (
              <p className="text-slate-400 text-xs">Loading members...</p>
            ) : members.length === 0 ? (
              <p className="text-slate-400 text-xs">No teammates added yet. Shared members can run this workflow and see its memory; editors can also edit steps.</p>
            ) : members.map(m => (
              <div key={m.id} className="flex items-center justify-between bg-[#1A2038] rounded-xl px-3 py-2">
                <div className="text-xs text-white">{m.invited_email} <span className="text-slate-400">· {m.role}</span></div>
                <button aria-label={`Remove ${m.invited_email}`} onClick={() => removeMember(m.id)} className="text-slate-400 hover:text-red-400 text-xs">✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function WebhookModal({ flow, onClose, onUpdated }) {
  const [token, setToken] = useState(flow.webhook_token || null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  const webhookUrl = token
    ? `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/webhooks/${token}`
    : null

  async function generate() {
    setLoading(true)
    const newToken = crypto.randomUUID()
    const { error } = await supabase.from('flows').update({ webhook_token: newToken }).eq('id', flow.id)
    setLoading(false)
    if (error) { toast(error.message, 'error'); return }
    setToken(newToken)
    onUpdated({ ...flow, webhook_token: newToken })
  }

  async function revoke() {
    setLoading(true)
    const { error } = await supabase.from('flows').update({ webhook_token: null }).eq('id', flow.id)
    setLoading(false)
    if (error) { toast(error.message, 'error'); return }
    setToken(null)
    onUpdated({ ...flow, webhook_token: null })
  }

  function copy() {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/18">
          <p className="text-white font-semibold">🔗 Webhook / API Trigger</p>
          <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed">
            Send a <code className="bg-white/8 px-1 py-0.5 rounded text-[#A29BFE]">POST</code> request to this URL to trigger the workflow automatically — from Zapier, Make, your own code, or any HTTP client. The request body becomes the first step's input.
          </p>

          {token ? (
            <>
              <div className="bg-[#09101F] border border-[#0984E3]/30 rounded-xl p-3 flex items-center gap-2">
                <code className="text-xs text-[#A29BFE] flex-1 break-all leading-relaxed">{webhookUrl}</code>
                <button onClick={copy} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-[#0984E3]/15 hover:bg-[#0984E3]/25 text-[#0984E3] transition-colors font-medium">
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              <div className="bg-[#1A2038] rounded-xl p-3 space-y-1.5">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Example request</p>
                <pre className="text-[11px] text-slate-300 leading-relaxed overflow-x-auto whitespace-pre">{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Your trigger input here"}'`}</pre>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={generate} disabled={loading}
                  className="text-xs px-4 py-2 rounded-lg bg-[#1A2038] hover:bg-[#222840] text-slate-300 transition-colors">
                  ↻ Regenerate URL
                </button>
                <button onClick={revoke} disabled={loading}
                  className="text-xs px-4 py-2 rounded-lg text-red-400 hover:text-red-300 transition-colors">
                  Revoke
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-4">No webhook URL generated yet.</p>
              <button onClick={generate} disabled={loading}
                className="bg-[#0984E3] hover:bg-[#0873C4] disabled:opacity-50 text-white text-sm px-6 py-2.5 rounded-xl font-medium transition-colors">
                {loading ? 'Generating...' : '🔗 Generate Webhook URL'}
              </button>
            </div>
          )}

          <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3 text-[11px] text-amber-300/80 leading-relaxed">
            ⚠ Anyone with this URL can trigger the workflow. Revoke and regenerate if it's ever exposed.
          </div>
        </div>
      </div>
    </div>
  )
}

export function ScheduleModal({ flow, userId, onClose, onSaved }) {
  const [schedule, setSchedule] = useState(null)
  const [frequency, setFrequency] = useState('daily')
  const [hourUtc, setHourUtc] = useState(9)
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [seedInput, setSeedInput] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => {
    supabase.from('flow_schedules').select('*').eq('flow_id', flow.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSchedule(data); setFrequency(data.frequency); setHourUtc(data.hour_utc)
          setDayOfWeek(data.day_of_week ?? 1); setSeedInput(data.seed_input || ''); setEnabled(data.enabled)
        }
        setLoading(false)
      })
  }, [flow.id])

  function nextRunAt() {
    const now = new Date()
    const next = new Date(now)
    next.setUTCHours(hourUtc, 0, 0, 0)
    if (frequency === 'weekly') {
      const daysAhead = (dayOfWeek - next.getUTCDay() + 7) % 7
      next.setUTCDate(next.getUTCDate() + daysAhead)
      if (next <= now) next.setUTCDate(next.getUTCDate() + 7)
    } else if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1)
    }
    return next.toISOString()
  }

  async function save() {
    if (!seedInput.trim()) { toast('Add the input for the first step', 'error'); return }
    setSaving(true)
    const payload = {
      flow_id: flow.id, user_id: userId, frequency, hour_utc: hourUtc,
      day_of_week: frequency === 'weekly' ? dayOfWeek : null,
      seed_input: seedInput.trim(), enabled, next_run_at: nextRunAt(),
    }
    const { data, error } = schedule
      ? await supabase.from('flow_schedules').update(payload).eq('id', schedule.id).select().single()
      : await supabase.from('flow_schedules').insert(payload).select().single()
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(enabled ? 'Schedule saved' : 'Schedule saved (paused)', 'success')
    onSaved(data)
    onClose()
  }

  async function remove() {
    if (!schedule) { onClose(); return }
    const { error } = await supabase.from('flow_schedules').delete().eq('id', schedule.id)
    if (error) { toast(error.message, 'error'); return }
    onSaved(null)
    onClose()
  }

  const inCls = 'w-full bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/18">
          <p className="text-white font-semibold">⏰ Schedule "{flow.name}"</p>
          <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>
        {loading ? (
          <p className="px-6 py-5 text-slate-400 text-xs">Loading...</p>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              Runs the whole workflow unattended on a recurring basis, chaining each step's output into the next, same as a manual run. Results land in Run History and fire the integration webhook if one is set.
            </p>
            <div>
              <label className="text-[11px] text-slate-300 mb-1 block">Input for the first step</label>
              <textarea className={inCls} rows={3} placeholder="e.g. Pull this week's open support tickets..."
                value={seedInput} onChange={e => setSeedInput(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <select value={frequency} onChange={e => setFrequency(e.target.value)} className={inCls}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
              {frequency === 'weekly' && (
                <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))} className={inCls}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              )}
              <select value={hourUtc} onChange={e => setHourUtc(Number(e.target.value))} className={inCls}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00 UTC</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
              Enabled
            </label>
            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={saving}
                className="flex-1 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-50 text-white text-sm py-2.5 rounded-xl font-medium transition-colors">
                {saving ? 'Saving...' : 'Save schedule'}
              </button>
              {schedule && (
                <button onClick={remove} className="px-4 text-sm text-red-400 hover:text-red-300 transition-colors">Remove</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
