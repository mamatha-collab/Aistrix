import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

const PROVIDERS = [
  {
    id: 'claude',
    name: 'Claude',
    company: 'Anthropic',
    color: '#6C5CE7',
    placeholder: 'sk-ant-api03-...',
    validate: k => k.startsWith('sk-ant-'),
    hint: 'Must start with sk-ant-',
  },
  {
    id: 'openai',
    name: 'GPT-4',
    company: 'OpenAI',
    color: '#00A67E',
    placeholder: 'sk-proj-...',
    validate: k => k.startsWith('sk-'),
    hint: 'Must start with sk-',
  },
]

export default function ApiKeySettings({ user, onClose }) {
  const [keys, setKeys] = useState({})
  const [inputs, setInputs] = useState({})
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const [errors, setErrors] = useState({})
  const [showKey, setShowKey] = useState({})
  const toast = useToast()

  useEffect(() => {
    fetchKeys()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  }, [])

  async function fetchKeys() {
    // Only select metadata — never fetch the key value itself to the client
    const { data } = await supabase
      .from('user_api_keys')
      .select('provider, label, is_active, updated_at')
      .eq('user_id', user.id)
    if (data) {
      const keyMap = {}
      data.forEach(k => { keyMap[k.provider] = k })
      setKeys(keyMap)
    }
  }

  async function saveKey(provider) {
    const raw = inputs[provider]?.trim()
    if (!raw) return

    const p = PROVIDERS.find(p => p.id === provider)
    if (!p.validate(raw)) {
      setErrors(prev => ({ ...prev, [provider]: p.hint }))
      return
    }

    setSaving(prev => ({ ...prev, [provider]: true }))
    setErrors(prev => ({ ...prev, [provider]: '' }))

    const { error } = await supabase
      .from('user_api_keys')
      .upsert({
        user_id: user.id,
        provider,
        encrypted_key: raw,
        label: `My ${provider} key`,
        is_active: true,
      }, { onConflict: 'user_id,provider' })

    setSaving(prev => ({ ...prev, [provider]: false }))

    if (error) {
      setErrors(prev => ({ ...prev, [provider]: error.message }))
    } else {
      setSaved(prev => ({ ...prev, [provider]: true }))
      setKeys(prev => ({ ...prev, [provider]: { provider, label: `My ${provider} key`, is_active: true } }))
      setInputs(prev => ({ ...prev, [provider]: '' }))
      toast(`${p.name} key saved`, 'success')
      setTimeout(() => setSaved(prev => ({ ...prev, [provider]: false })), 2000)
    }
  }

  async function removeKey(provider) {
    const p = PROVIDERS.find(p => p.id === provider)
    await supabase
      .from('user_api_keys')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', provider)
    setKeys(prev => { const next = { ...prev }; delete next[provider]; return next })
    toast(`${p.name} key removed`, 'info')
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div>
            <p className="text-white font-medium">API Key Settings</p>
            <p className="text-xs text-slate-400 mt-0.5">Use your own keys — sent securely and never returned to the browser after saving</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {PROVIDERS.map(p => (
            <div key={p.id} className="bg-[#1F2444] border border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: p.color }}>
                    {p.name[0]}
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{p.name}</p>
                    <p className="text-[10px] text-slate-500">{p.company}</p>
                  </div>
                </div>
                {keys[p.id] ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">✓ Connected</span>
                    <button
                      onClick={() => removeKey(p.id)}
                      className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] text-slate-500">Not connected</span>
                )}
              </div>

              {!keys[p.id] && (
                <form onSubmit={e => { e.preventDefault(); saveKey(p.id) }} autoComplete="off">
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type={showKey[p.id] ? 'text' : 'password'}
                        autoComplete="new-password"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck="false"
                        value={inputs[p.id] || ''}
                        onChange={e => {
                          setInputs(prev => ({ ...prev, [p.id]: e.target.value }))
                          if (errors[p.id]) setErrors(prev => ({ ...prev, [p.id]: '' }))
                        }}
                        placeholder={p.placeholder}
                        className="w-full bg-[#0F1225] border border-white/10 rounded-lg px-3 py-2 pr-8 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7] transition-colors font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-[10px]"
                        tabIndex={-1}
                      >
                        {showKey[p.id] ? '🙈' : '👁'}
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={saving[p.id] || !inputs[p.id]}
                      className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-xs px-3 py-2 rounded-lg transition-colors shrink-0"
                    >
                      {saving[p.id] ? '...' : saved[p.id] ? '✓' : 'Save'}
                    </button>
                  </div>
                  {errors[p.id] && (
                    <p className="text-red-400 text-[11px] mt-1.5">{errors[p.id]}</p>
                  )}
                </form>
              )}
            </div>
          ))}

          <div className="bg-[#0F1225] rounded-xl p-4 space-y-2">
            <p className="text-[11px] text-slate-400 font-medium">🔒 How your keys are protected</p>
            <ul className="text-[11px] text-slate-500 space-y-1 list-disc list-inside">
              <li>Keys are sent directly from your browser to our server over HTTPS</li>
              <li>They are stored in our database and <strong className="text-slate-400">never returned to the browser again</strong></li>
              <li>When you run an app, our backend fetches your key directly — it never passes through your browser</li>
              <li>Only you can access your keys (enforced by row-level security)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
