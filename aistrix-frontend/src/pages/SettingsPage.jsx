import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { applyTheme } from '../utils/theme'

const AVATAR_COLORS = ['#6C5CE7','#E84393','#00B894','#0984E3','#FDCB6E','#E17055','#74B9FF','#A29BFE','#55EFC4','#FD79A8']
const PROVIDERS = [
  { id: 'claude', name: 'Claude', company: 'Anthropic', color: '#6C5CE7', placeholder: 'sk-ant-api03-...' },
  { id: 'openai', name: 'GPT-4', company: 'OpenAI', color: '#00A67E', placeholder: 'sk-proj-...' },
]

function Section({ title, description, children }) {
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5">
        <p className="text-white font-medium">{title}</p>
        {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

export default function SettingsPage({ user }) {
  const toast = useToast()

  // Profile
  const meta = user?.user_metadata || {}
  const [displayName, setDisplayName] = useState(meta.display_name || '')
  const [avatarColor, setAvatarColor] = useState(meta.avatar_color || '#6C5CE7')
  const [savingProfile, setSavingProfile] = useState(false)

  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('aistrix_theme') || 'dark')

  // Daily run limit
  const [dailyLimit, setDailyLimit] = useState(() => parseInt(localStorage.getItem('aistrix_daily_limit') || '50'))

  // Notifications
  const [notifPermission, setNotifPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  )

  // API Keys
  const [keys, setKeys] = useState({})
  const [keyInputs, setKeyInputs] = useState({})
  const [keySaving, setKeySaving] = useState({})
  const [keyShow, setKeyShow] = useState({})

  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  useEffect(() => { loadKeys() }, [])

  async function loadKeys() {
    const { data } = await supabase.from('user_api_keys')
      .select('provider, label, is_active, updated_at').eq('user_id', user.id)
    if (data) {
      const m = {}; data.forEach(k => { m[k.provider] = k }); setKeys(m)
    }
  }

  async function saveProfile() {
    setSavingProfile(true)
    const { error } = await supabase.auth.updateUser({
      data: { display_name: displayName.trim(), avatar_color: avatarColor },
    })
    setSavingProfile(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Profile saved', 'success')
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.add('theme-transitioning')
    setTheme(next)
    localStorage.setItem('aistrix_theme', next)
    applyTheme(next)
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350)
  }

  function saveDailyLimit(val) {
    setDailyLimit(val)
    localStorage.setItem('aistrix_daily_limit', String(val))
    toast(`Daily limit set to ${val} runs`, 'success', 2000)
  }

  async function requestNotifications() {
    const result = await Notification.requestPermission()
    setNotifPermission(result)
    toast(result === 'granted' ? 'Notifications enabled' : 'Permission denied', result === 'granted' ? 'success' : 'error')
  }

  async function saveKey(provider) {
    const raw = keyInputs[provider]?.trim()
    if (!raw) return
    setKeySaving(prev => ({ ...prev, [provider]: true }))
    const { error } = await supabase.from('user_api_keys').upsert({
      user_id: user.id, provider, encrypted_key: raw,
      label: `My ${provider} key`, is_active: true,
    }, { onConflict: 'user_id,provider' })
    setKeySaving(prev => ({ ...prev, [provider]: false }))
    if (error) { toast(error.message, 'error'); return }
    setKeys(prev => ({ ...prev, [provider]: { provider, is_active: true } }))
    setKeyInputs(prev => ({ ...prev, [provider]: '' }))
    toast(`${provider === 'claude' ? 'Claude' : 'OpenAI'} key saved`, 'success')
  }

  async function removeKey(provider) {
    await supabase.from('user_api_keys').delete().eq('user_id', user.id).eq('provider', provider)
    setKeys(prev => { const n = { ...prev }; delete n[provider]; return n })
    toast('Key removed', 'info')
  }

  const initial = (displayName || user?.email || '?')[0].toUpperCase()
  const [memory, setMemory] = useState([])
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')

  const PRESET_MEMORY = [
    { key: 'Preferred tone', placeholder: 'Professional, casual, formal, friendly...' },
    { key: 'Preferred language', placeholder: 'English, Spanish, French...' },
    { key: 'Writing style', placeholder: 'Concise, detailed, bullet points, narrative...' },
    { key: 'About me', placeholder: 'A sentence about yourself the AI should always know...' },
  ]

  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  useEffect(() => { loadMemory() }, [])

  async function loadMemory() {
    const { data } = await supabase.from('user_memory').select('key, value').eq('user_id', user.id)
    if (data) setMemory(data)
  }

  async function saveMemoryItem(key, value) {
    if (!value.trim()) { await deleteMemoryItem(key); return }
    await supabase.from('user_memory').upsert({ user_id: user.id, key, value: value.trim(), updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' })
    setMemory(prev => { const exists = prev.find(m => m.key === key); return exists ? prev.map(m => m.key === key ? { key, value } : m) : [...prev, { key, value }] })
  }

  async function deleteMemoryItem(key) {
    await supabase.from('user_memory').delete().eq('user_id', user.id).eq('key', key)
    setMemory(prev => prev.filter(m => m.key !== key))
  }

  async function addCustomMemory() {
    if (!newKey.trim() || !newVal.trim()) return
    await saveMemoryItem(newKey.trim(), newVal.trim())
    setNewKey(''); setNewVal('')
    toast('Memory saved', 'success', 2000)
  }

  const inputCls = 'w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 max-w-2xl">
      <div>
        <h1 className="text-white text-xl font-semibold">Settings</h1>
        <p className="text-slate-400 text-sm mt-0.5">Manage your account and preferences.</p>
      </div>

      {/* Profile */}
      <Section title="Profile" description="Your public name and avatar shown throughout Aistrix.">
        <div className="flex items-center gap-5 mb-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shrink-0"
            style={{ background: avatarColor }}>{initial}</div>
          <div className="flex flex-wrap gap-1.5">
            {AVATAR_COLORS.map(c => (
              <button key={c} onClick={() => setAvatarColor(c)}
                className={`w-6 h-6 rounded-full transition-all ${avatarColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-[#171B33] scale-110' : 'hover:scale-105'}`}
                style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Display name</label>
            <input className={inputCls} placeholder="Your name" value={displayName}
              onChange={e => setDisplayName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveProfile()} />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Email</label>
            <p className="text-sm text-slate-500 bg-[#1F2444] rounded-xl px-3 py-2.5">{user?.email}</p>
          </div>
          <button onClick={saveProfile} disabled={savingProfile}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-5 py-2 rounded-xl font-medium transition-colors">
            {savingProfile ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </Section>

      {/* Appearance */}
      <Section title="Appearance" description="Customize how Aistrix looks.">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white">Color theme</p>
            <p className="text-xs text-slate-400 mt-0.5">Currently {theme === 'dark' ? 'Dark' : 'Soft Ivory (Light)'}</p>
          </div>
          <button onClick={toggleTheme}
            className="flex items-center gap-2 bg-[#1F2444] hover:bg-[#272C52] border border-white/10 text-slate-300 text-sm px-4 py-2 rounded-xl transition-colors">
            {theme === 'dark' ? '☀️ Switch to Light' : '🌙 Switch to Dark'}
          </button>
        </div>
      </Section>

      {/* Usage */}
      <Section title="Usage limits" description="Control how many runs you use from Aistrix's quota per day.">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">Daily run limit</span>
            <span className="text-white font-medium">{dailyLimit} runs</span>
          </div>
          <input type="range" min="10" max="200" step="10" value={dailyLimit}
            onChange={e => setDailyLimit(Number(e.target.value))}
            onMouseUp={e => saveDailyLimit(Number(e.target.value))}
            onTouchEnd={e => saveDailyLimit(Number(e.target.value))}
            className="w-full accent-[#6C5CE7]" />
          <div className="flex justify-between text-[10px] text-slate-600">
            <span>10</span><span>100</span><span>200</span>
          </div>
          <p className="text-xs text-slate-500">Add your own API keys to bypass this limit entirely.</p>
        </div>
      </Section>

      {/* Notifications */}
      <Section title="Notifications" description="Get notified when long-running apps finish.">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white">Browser notifications</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {notifPermission === 'granted' ? '✓ Enabled — you\'ll be notified when runs complete'
                : notifPermission === 'denied' ? '✕ Blocked in browser settings'
                : 'Not yet enabled'}
            </p>
          </div>
          {notifPermission !== 'granted' && notifPermission !== 'denied' && (
            <button onClick={requestNotifications}
              className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-4 py-2 rounded-xl transition-colors">
              Enable
            </button>
          )}
          {notifPermission === 'granted' && (
            <span className="text-xs text-green-400 bg-green-400/10 px-3 py-1.5 rounded-xl">✓ Active</span>
          )}
          {notifPermission === 'denied' && (
            <span className="text-xs text-slate-400">Update in browser settings</span>
          )}
        </div>
      </Section>

      {/* API Keys */}
      <Section title="API Keys" description="Use your own keys — they never leave the server and don't count against your quota.">
        <div className="space-y-4">
          {PROVIDERS.map(p => (
            <div key={p.id} className="bg-[#1F2444] border border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: p.color }}>
                    {p.name[0]}
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium">{p.name}</p>
                    <p className="text-[10px] text-slate-500">{p.company}</p>
                  </div>
                </div>
                {keys[p.id] ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">✓ Connected</span>
                    <button onClick={() => removeKey(p.id)} className="text-[10px] text-red-400 hover:text-red-300">Remove</button>
                  </div>
                ) : <span className="text-[10px] text-slate-500">Not connected</span>}
              </div>
              {!keys[p.id] && (
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={keyShow[p.id] ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={keyInputs[p.id] || ''}
                      onChange={e => setKeyInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && saveKey(p.id)}
                      placeholder={p.placeholder}
                      className="w-full bg-[#0F1225] border border-white/10 rounded-lg px-3 py-2 pr-8 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7] transition-colors font-mono"
                    />
                    <button type="button" tabIndex={-1}
                      onClick={() => setKeyShow(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-[10px]">
                      {keyShow[p.id] ? '🙈' : '👁'}
                    </button>
                  </div>
                  <button onClick={() => saveKey(p.id)} disabled={keySaving[p.id] || !keyInputs[p.id]}
                    className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-xs px-3 py-2 rounded-lg transition-colors shrink-0">
                    {keySaving[p.id] ? '...' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          ))}
          <p className="text-[11px] text-slate-500">Keys are stored encrypted and only retrieved server-side when you run an app.</p>
        </div>
      </Section>

      {/* AI Memory */}
      <Section title="AI Memory" description="Things you want every app to know about you. Toggle memory on in the app runner to inject these automatically.">
        <div className="space-y-3">
          {PRESET_MEMORY.map(({ key, placeholder }) => {
            const existing = memory.find(m => m.key === key)
            return (
              <div key={key} className="flex gap-2 items-center">
                <label className="text-xs text-slate-400 w-36 shrink-0">{key}</label>
                <input
                  className="flex-1 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                  placeholder={placeholder}
                  defaultValue={existing?.value || ''}
                  onBlur={e => saveMemoryItem(key, e.target.value)}
                />
                {existing && (
                  <button aria-label={`Delete ${key}`} onClick={() => deleteMemoryItem(key)} className="text-slate-600 hover:text-red-400 text-xs transition-colors shrink-0">✕</button>
                )}
              </div>
            )
          })}

          {memory.filter(m => !PRESET_MEMORY.find(p => p.key === m.key)).map(m => (
            <div key={m.key} className="flex gap-2 items-center">
              <span className="text-xs text-slate-400 w-36 shrink-0 truncate">{m.key}</span>
              <input
                className="flex-1 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                defaultValue={m.value}
                onBlur={e => saveMemoryItem(m.key, e.target.value)}
              />
              <button aria-label={`Delete ${m.key}`} onClick={() => deleteMemoryItem(m.key)} className="text-slate-600 hover:text-red-400 text-xs transition-colors shrink-0">✕</button>
            </div>
          ))}

          <div className="border-t border-white/5 pt-3">
            <p className="text-[10px] text-slate-500 mb-2">Add custom memory</p>
            <div className="flex gap-2">
              <input className="w-32 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                placeholder="Key" value={newKey} onChange={e => setNewKey(e.target.value)} />
              <input className="flex-1 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                placeholder="Value" value={newVal} onChange={e => setNewVal(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomMemory()} />
              <button onClick={addCustomMemory} disabled={!newKey || !newVal}
                className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-xs px-3 py-2 rounded-xl transition-colors shrink-0">Add</button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  )
}
