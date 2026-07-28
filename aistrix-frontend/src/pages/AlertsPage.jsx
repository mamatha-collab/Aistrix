import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

const ALERT_TYPES = [
  {
    id: 'run_limit',
    label: 'Daily run limit',
    icon: '📊',
    description: 'Notify when daily runs reach a threshold',
    fields: [{ key: 'threshold', label: 'Alert at X runs', type: 'number', placeholder: '40', min: 1, max: 200 }],
  },
  {
    id: 'keyword',
    label: 'Keyword in result',
    icon: '🔍',
    description: 'Flag when any run result contains a word or phrase',
    fields: [{ key: 'keyword', label: 'Keyword or phrase', type: 'text', placeholder: 'e.g. error, failed, warning' }],
  },
  {
    id: 'rating_streak',
    label: 'Consecutive thumbs down',
    icon: '👎',
    description: 'Notify when you rate N results poorly in a row',
    fields: [{ key: 'streak', label: 'After N bad ratings', type: 'number', placeholder: '3', min: 2, max: 10 }],
  },
]

function AlertForm({ onSave, onCancel }) {
  const [type, setType] = useState(ALERT_TYPES[0].id)
  const [name, setName] = useState('')
  const [cond, setCond] = useState({})
  const selected = ALERT_TYPES.find(t => t.id === type)

  function handleSave() {
    if (!name.trim()) return
    const missing = selected.fields.some(f => !cond[f.key])
    if (missing) return
    onSave({ name: name.trim(), type, condition: cond })
  }

  return (
    <div className="bg-[#1F2444] border border-[#6C5CE7]/30 rounded-2xl p-5 space-y-4">
      <p className="text-white font-medium text-sm">New alert</p>

      <div>
        <label className="text-xs text-slate-400 block mb-2">Alert type</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {ALERT_TYPES.map(t => (
            <button key={t.id} onClick={() => { setType(t.id); setCond({}) }}
              className={`p-3 rounded-xl border text-left transition-all ${type === t.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10' : 'border-white/5 bg-[#171B33] hover:border-white/20'}`}>
              <div className="text-xl mb-1">{t.icon}</div>
              <p className="text-xs text-white font-medium">{t.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{t.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1.5">Alert name</label>
        <input
          className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
          placeholder={`e.g. ${selected.label} warning`}
          value={name} onChange={e => setName(e.target.value)}
        />
      </div>

      {selected.fields.map(field => (
        <div key={field.key}>
          <label className="text-xs text-slate-400 block mb-1.5">{field.label}</label>
          <input
            type={field.type}
            min={field.min} max={field.max}
            className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            placeholder={field.placeholder}
            value={cond[field.key] || ''}
            onChange={e => setCond(prev => ({ ...prev, [field.key]: e.target.value }))}
          />
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave}
          className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-5 py-2 rounded-xl font-medium transition-colors">
          Create alert
        </button>
        <button onClick={onCancel}
          className="bg-[#171B33] hover:bg-[#272C52] text-slate-300 text-sm px-4 py-2 rounded-xl transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

function AlertCard({ alert, onToggle, onDelete }) {
  const typeDef = ALERT_TYPES.find(t => t.id === alert.type)
  const condSummary = alert.type === 'run_limit'
    ? `Trigger at ${alert.condition.threshold} daily runs`
    : alert.type === 'keyword'
    ? `Keyword: "${alert.condition.keyword}"`
    : `After ${alert.condition.streak} bad ratings`

  return (
    <div className={`bg-[#171B33] border rounded-xl p-4 flex items-start gap-4 transition-opacity ${alert.is_active ? 'border-white/5 opacity-100' : 'border-white/5 opacity-50'}`}>
      <div className="w-9 h-9 rounded-xl bg-[#1F2444] flex items-center justify-center text-xl shrink-0">{typeDef?.icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-medium">{alert.name}</p>
        <p className="text-xs text-slate-400 mt-0.5">{condSummary}</p>
        <p className="text-[10px] text-slate-600 mt-1">{typeDef?.label}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => onToggle(alert)}
          className={`relative w-9 h-5 rounded-full transition-colors ${alert.is_active ? 'bg-[#6C5CE7]' : 'bg-[#1F2444]'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${alert.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
        <button onClick={() => onDelete(alert.id)} className="text-slate-600 hover:text-red-400 text-sm transition-colors">🗑</button>
      </div>
    </div>
  )
}

export default function AlertsPage({ user }) {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const toast = useToast()

  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  useEffect(() => { loadAlerts() }, [])

  async function loadAlerts() {
    const { data } = await supabase.from('user_alerts')
      .select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    if (data) setAlerts(data)
    setLoading(false)
  }

  async function createAlert({ name, type, condition }) {
    const { data, error } = await supabase.from('user_alerts')
      .insert({ user_id: user.id, name, type, condition, is_active: true })
      .select().single()
    if (error) { toast(error.message, 'error'); return }
    setAlerts(prev => [data, ...prev])
    setShowForm(false)
    toast('Alert created', 'success')
  }

  async function toggleAlert(alert) {
    const next = !alert.is_active
    const { error } = await supabase.from('user_alerts').update({ is_active: next }).eq('id', alert.id)
    if (error) { toast(error.message, 'error'); return }
    setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, is_active: next } : a))
    toast(next ? 'Alert enabled' : 'Alert paused', 'info', 2000)
  }

  async function deleteAlert(id) {
    const { error } = await supabase.from('user_alerts').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setAlerts(prev => prev.filter(a => a.id !== id))
    toast('Alert deleted', 'info', 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Alerts</h1>
          <p className="text-slate-400 text-sm mt-0.5">Get notified when important things happen.</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-4 py-2 rounded-xl font-medium transition-colors shrink-0">
            + New alert
          </button>
        )}
      </div>

      {showForm && <AlertForm onSave={createAlert} onCancel={() => setShowForm(false)} />}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading...</p>
      ) : alerts.length === 0 && !showForm ? (
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
          <div className="text-4xl mb-3">🔔</div>
          <p className="text-white font-medium mb-1">No alerts yet</p>
          <p className="text-slate-400 text-sm mb-5">Create an alert to get notified when things happen — like hitting your daily run limit or a keyword appearing in a result.</p>
          <button onClick={() => setShowForm(true)}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-5 py-2.5 rounded-xl font-medium transition-colors">
            + Create your first alert
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} onToggle={toggleAlert} onDelete={deleteAlert} />
          ))}
        </div>
      )}

      {alerts.length > 0 && (
        <div className="bg-[#171B33] border border-white/5 rounded-xl p-4">
          <p className="text-xs text-slate-500 font-medium mb-1">How alerts work</p>
          <ul className="text-xs text-slate-500 space-y-1 list-disc list-inside">
            <li>Alerts are checked each time you run an app</li>
            <li>Triggered alerts show a toast notification and a browser notification (if enabled)</li>
            <li>Pause an alert with the toggle — it won't trigger until re-enabled</li>
          </ul>
        </div>
      )}
    </div>
  )
}
