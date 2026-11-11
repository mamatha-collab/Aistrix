import type { User } from '@supabase/supabase-js'
import { errorMessage } from '../types/domain'
import { useState } from 'react'
import { useToast } from '../hooks/useToast'
import { PROVIDER_STYLE, removeProviderKey, saveProviderKey, useProviders } from '../lib/providers'

// Shared by account settings and the Models workspace; credentials still use
// the existing authenticated backend validation/encryption endpoints.
export default function ProviderConnections({ user }: { user?: User }) {
  const toast = useToast()
  // API Keys
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [keySaving, setKeySaving] = useState<Record<string, boolean>>({})
  const [keyShow, setKeyShow] = useState<Record<string, boolean>>({})

  const providers = useProviders()
  const PROVIDERS = providers.map(p => {
    const style = PROVIDER_STYLE[p.id]
    return { ...p, ...style, name: style?.name || p.name || p.label || p.id, color: style?.color || '#6C5CE7', placeholder: style?.placeholder || 'Paste provider API key' }
  })
  const keys = Object.fromEntries(providers.filter(p => p.connected).map(p => [p.id, p]))

  // Saved through the backend: it checks the key with the provider and
  // stores it encrypted.
  async function saveKey(provider: string) {
    const raw = keyInputs[provider]?.trim()
    if (!raw) return
    setKeySaving(prev => ({ ...prev, [provider]: true }))
    try {
      await saveProviderKey(provider, raw)
      setKeyInputs(prev => ({ ...prev, [provider]: '' }))
      toast(`${PROVIDER_STYLE[provider]?.name || provider} key saved`, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error', 6000)
    } finally {
      setKeySaving(prev => ({ ...prev, [provider]: false }))
    }
  }

  async function removeKey(provider: string) {
    try {
      await removeProviderKey(provider)
      toast('Key removed', 'info')
    } catch (e) { toast(errorMessage(e), 'error') }
  }

  return <section aria-label="Provider connections">
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
                    <span className="text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">✓ Connected{keys[p.id]?.last4 ? ` ····${keys[p.id]?.last4}` : ''}</span>
                    <button onClick={() => removeKey(p.id)} className="text-[10px] text-red-400 hover:text-red-300">Remove</button>
                  </div>
                ) : <span className="text-[10px] text-slate-500">Not connected</span>}
              </div>
              {!keys[p.id] && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    value={user?.email || `aistrix-${p.id}-key`}
                    readOnly
                    hidden
                  />
                  <div className="flex-1 relative">
                    <input
                      name={`${p.id}-api-key`}
                      aria-label={`${p.name} API key`}
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
  </section>
}
