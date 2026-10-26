// Deploy step: trigger link, webhook signing/test, and run stats across all
// users. All developer-only endpoints on the backend.
import { supabase } from '../supabase'
import { errorFromResponse } from './runStream'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function call(path, { method = 'GET', fallback } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${API_URL}${path}`, {
    method, headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  })
  if (!res.ok) throw await errorFromResponse(res, fallback)
  return res.json()
}

// { token } — null when the app has no trigger link.
export const getTrigger = appId => call(`/v1/apps/${appId}/trigger`, { fallback: 'Could not load the trigger link' })
// Creates the link, or replaces it (the old one stops working).
export const createTrigger = appId => call(`/v1/apps/${appId}/trigger`, { method: 'POST', fallback: 'Could not create the trigger link' })
export const deleteTrigger = appId => call(`/v1/apps/${appId}/trigger`, { method: 'DELETE', fallback: 'Could not turn off the trigger link' })

// { secret } used to sign webhook requests (X-Aistrix-Signature).
export const getWebhookSecret = appId => call(`/v1/apps/${appId}/webhook/secret`, { fallback: 'Could not load the signing secret' })
// { ok, status, error? } — sends a signed sample payload to the saved URL.
export const sendTestWebhook = appId => call(`/v1/apps/${appId}/webhook/test`, { method: 'POST', fallback: 'Could not send the test' })

// { total, users, rated, satisfaction, avg_in, avg_out, last_run }
export const getAppStats = appId => call(`/v1/apps/${appId}/stats`, { fallback: 'Could not load run history' })

// What end users see: the live version's name, form and greeting.
// { source: 'live' | 'offline' | 'draft', live_version, name, emoji, description, app_type, greeting, input_placeholder, form_schema }
export const getLivePreview = appId => call(`/v1/apps/${appId}/live-preview`, { fallback: 'Could not load the preview' })
