// AI providers developers can build with, the models they can pick, and
// whether the signed-in user has saved their own key (GET /v1/providers).
// Keys are saved/removed through the backend, which checks them with the
// provider and stores them encrypted — the browser never writes key rows.
import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { errorFromResponse } from './runStream'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Display details that aren't part of the API response.
export const PROVIDER_STYLE = {
  claude: { name: 'Claude', color: '#6C5CE7', icon: '🟣', placeholder: 'sk-ant-api03-...' },
  openai: { name: 'GPT', color: '#00A67E', icon: '🟢', placeholder: 'sk-proj-...' },
  gemini: { name: 'Gemini', color: '#4285F4', icon: '🔵', placeholder: 'AIza...' },
}

// Used until /v1/providers answers (or if it can't be reached).
export const DEFAULT_PROVIDERS = [
  { id: 'claude', label: 'Claude', company: 'Anthropic', connected: false, keys_url: 'https://console.anthropic.com/settings/keys',
    default_model: 'claude-sonnet-5-5',
    models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }] },
  { id: 'openai', label: 'OpenAI', company: 'OpenAI', connected: false, keys_url: 'https://platform.openai.com/api-keys',
    default_model: 'gpt-4o-mini',
    models: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }, { id: 'gpt-4o', label: 'GPT-4o' }] },
  { id: 'gemini', label: 'Gemini', company: 'Google', connected: false, keys_url: 'https://aistudio.google.com/apikey',
    default_model: 'gemini-3.8-flash',
    models: [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }] },
]

let cache = null
let inflight = null
const listeners = new Set()

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : null
}

export async function loadProviders({ refresh = false } = {}) {
  if (cache && !refresh) return cache
  if (inflight && !refresh) return inflight
  inflight = (async () => {
    const headers = await authHeaders()
    if (!headers) return DEFAULT_PROVIDERS
    const res = await fetch(`${API_URL}/v1/providers`, { headers })
    if (!res.ok) throw await errorFromResponse(res, 'Could not load AI providers')
    cache = (await res.json()).providers
    listeners.forEach(fn => fn(cache))
    return cache
  })()
  try { return await inflight } finally { inflight = null }
}

export function useProviders() {
  const [providers, setProviders] = useState(cache || DEFAULT_PROVIDERS)
  useEffect(() => {
    listeners.add(setProviders)
    loadProviders().then(setProviders).catch(() => { /* keep the defaults */ })
    return () => { listeners.delete(setProviders) }
  }, [])
  return providers
}

export function providerById(providers, id) {
  return providers.find(p => p.id === id) || DEFAULT_PROVIDERS.find(p => p.id === id) || DEFAULT_PROVIDERS[0]
}

// Model options for a provider, keeping the app's current model listed even
// if it isn't in the list (saved earlier, or from the developer's own key).
export function modelOptions(providers, providerId, current) {
  const models = providerById(providers, providerId).models || []
  return current && !models.some(m => m.id === current) ? [...models, { id: current, label: current }] : models
}

export async function saveProviderKey(provider, key) {
  const headers = await authHeaders()
  if (!headers) throw new Error('Sign in again to save keys')
  const res = await fetch(`${API_URL}/v1/provider-keys/${provider}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
  })
  if (!res.ok) throw await errorFromResponse(res, 'Could not save the key')
  const saved = await res.json()
  await loadProviders({ refresh: true }).catch(() => {})
  return saved
}

export async function removeProviderKey(provider) {
  const headers = await authHeaders()
  if (!headers) throw new Error('Sign in again to remove keys')
  const res = await fetch(`${API_URL}/v1/provider-keys/${provider}`, { method: 'DELETE', headers })
  if (!res.ok) throw await errorFromResponse(res, 'Could not remove the key')
  await loadProviders({ refresh: true }).catch(() => {})
}
