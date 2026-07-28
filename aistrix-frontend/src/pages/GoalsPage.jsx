import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

const PERIODS = [
  { id: 'day',   label: 'Daily',   desc: 'Resets every midnight' },
  { id: 'week',  label: 'Weekly',  desc: 'Resets every Monday' },
  { id: 'month', label: 'Monthly', desc: 'Resets 1st of each month' },
]

function getPeriodStart(period) {
  const now = new Date()
  if (period === 'day') {
    const d = new Date(now); d.setHours(0,0,0,0); return d
  }
  if (period === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    d.setHours(0,0,0,0); return d
  }
  const d = new Date(now.getFullYear(), now.getMonth(), 1)
  return d
}

function GoalCard({ goal, onDelete, onToggle }) {
  const [progress, setProgress] = useState(null)

  useEffect(() => {
    async function load() {
      const start = getPeriodStart(goal.period)
      let q = supabase.from('run_history')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', goal.user_id)
        .gte('created_at', start.toISOString())
      if (goal.app_id) q = q.eq('app_id', goal.app_id)
      const { count } = await q
      setProgress(count ?? 0)
    }
    load()
  }, [goal])

  const pct = progress !== null ? Math.min((progress / goal.target_runs) * 100, 100) : 0
  const done = progress >= goal.target_runs
  const periodLabel = PERIODS.find(p => p.id === goal.period)?.label

  return (
    <div className={`bg-[#171B33] border rounded-2xl p-5 transition-opacity ${goal.is_active ? 'border-white/5 opacity-100' : 'border-white/5 opacity-50'}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-white font-medium text-sm">{goal.name}</p>
            {done && <span className="text-[10px] text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-full">✓ Complete</span>}
          </div>
          <p className="text-xs text-slate-400">
            {goal.app_name ? `${goal.app_name} · ` : 'All apps · '}
            {periodLabel} · Target: {goal.target_runs} runs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onToggle(goal)}
            className={`relative w-8 h-4 rounded-full transition-colors ${goal.is_active ? 'bg-[#6C5CE7]' : 'bg-[#1F2444]'}`}>
            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${goal.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <button onClick={() => onDelete(goal.id)} className="text-slate-600 hover:text-red-400 text-sm transition-colors">🗑</button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 bg-[#1F2444] rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${done ? 'bg-green-500' : pct > 66 ? 'bg-[#6C5CE7]' : pct > 33 ? 'bg-blue-500' : 'bg-slate-600'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-slate-400 shrink-0 w-16 text-right">
          {progress ?? '…'} / {goal.target_runs}
        </span>
      </div>
    </div>
  )
}

function GoalForm({ apps, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState(10)
  const [period, setPeriod] = useState('week')
  const [appId, setAppId] = useState('')

  function save() {
    if (!name.trim() || !target) return
    const chosen = apps.find(a => a.id === appId)
    onSave({ name: name.trim(), target_runs: Number(target), period, app_id: chosen?.id || null, app_name: chosen?.name || null })
  }

  return (
    <div className="bg-[#1F2444] border border-[#6C5CE7]/30 rounded-2xl p-5 space-y-4">
      <p className="text-white font-medium text-sm">New goal</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Goal name</label>
          <input className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            placeholder="e.g. Practice interviews daily" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Target runs</label>
          <input type="number" min={1} max={200}
            className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            value={target} onChange={e => setTarget(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-2">Period</label>
        <div className="grid grid-cols-3 gap-2">
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`p-2.5 rounded-xl border text-left transition-all ${period === p.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10' : 'border-white/5 bg-[#171B33] hover:border-white/20'}`}>
              <p className={`text-xs font-medium ${period === p.id ? 'text-white' : 'text-slate-300'}`}>{p.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{p.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1.5">App (optional — leave blank to track all apps)</label>
        <select className="w-full bg-[#171B33] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7] transition-colors"
          value={appId} onChange={e => setAppId(e.target.value)}>
          <option value="">All apps</option>
          {apps.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
        </select>
      </div>

      <div className="flex gap-2">
        <button onClick={save} className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-5 py-2 rounded-xl font-medium transition-colors">
          Create goal
        </button>
        <button onClick={onCancel} className="bg-[#171B33] hover:bg-[#272C52] text-slate-300 text-sm px-4 py-2 rounded-xl transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function GoalsPage({ user }) {
  const [goals, setGoals] = useState([])
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const toast = useToast()

  useEffect(() => {
    Promise.all([
      supabase.from('user_goals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('apps').select('id, name, emoji').eq('is_published', true).order('name'),
    ]).then(([{ data: g }, { data: a }]) => {
      setGoals(g?.map(goal => ({ ...goal, user_id: user.id })) ?? [])
      setApps(a ?? [])
      setLoading(false)
    })
  }, [user.id])

  async function createGoal(data) {
    const { data: row, error } = await supabase.from('user_goals')
      .insert({ ...data, user_id: user.id }).select().single()
    if (error) { toast(error.message, 'error'); return }
    setGoals(prev => [{ ...row, user_id: user.id }, ...prev])
    setShowForm(false)
    toast('Goal created', 'success')
  }

  async function deleteGoal(id) {
    const { error } = await supabase.from('user_goals').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setGoals(prev => prev.filter(g => g.id !== id))
    toast('Goal deleted', 'info', 2000)
  }

  async function toggleGoal(goal) {
    const next = !goal.is_active
    const { error } = await supabase.from('user_goals').update({ is_active: next }).eq('id', goal.id)
    if (error) { toast(error.message, 'error'); return }
    setGoals(prev => prev.map(g => g.id === goal.id ? { ...g, is_active: next } : g))
  }

  const activeGoals   = goals.filter(g => g.is_active)
  const pausedGoals   = goals.filter(g => !g.is_active)

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Goals</h1>
          <p className="text-slate-400 text-sm mt-0.5">Set targets to build consistent habits with AI apps.</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-4 py-2 rounded-xl font-medium transition-colors shrink-0">
            + New goal
          </button>
        )}
      </div>

      {showForm && <GoalForm apps={apps} onSave={createGoal} onCancel={() => setShowForm(false)} />}

      {loading ? <p className="text-slate-500 text-sm">Loading...</p> : (
        <>
          {activeGoals.length === 0 && !showForm && (
            <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
              <div className="text-4xl mb-3">🎯</div>
              <p className="text-white font-medium mb-1">No active goals</p>
              <p className="text-slate-400 text-sm mb-5">Set a goal to track how consistently you use AI apps. Goals reset automatically each period.</p>
              <button onClick={() => setShowForm(true)}
                className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-5 py-2.5 rounded-xl font-medium transition-colors">
                + Create your first goal
              </button>
            </div>
          )}
          <div className="space-y-3">
            {activeGoals.map(g => <GoalCard key={g.id} goal={g} apps={apps} onDelete={deleteGoal} onToggle={toggleGoal} />)}
          </div>
          {pausedGoals.length > 0 && (
            <>
              <p className="text-xs text-slate-500 uppercase pt-2">Paused</p>
              <div className="space-y-3">
                {pausedGoals.map(g => <GoalCard key={g.id} goal={g} apps={apps} onDelete={deleteGoal} onToggle={toggleGoal} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
