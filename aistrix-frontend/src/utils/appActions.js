import { supabase } from '../supabase'
import { APP_PUBLIC_SELECT } from '../lib/appColumns'

import { BRAND } from '../lib/brand'
// Clones an app's core configuration into a new app owned by the current
// user — the "Save as reusable template" next-best-action shown after a run.
// The user can then rename it and tweak it freely without touching the
// original. Matches CreateAppModal's own insert shape (public + published) —
// the apps table's RLS insert policy rejects unpublished/private rows from
// the client, so there's no draft state to save into instead.
export async function duplicateApp(app, userId) {
  const payload = {
    name: `${app.name} (copy)`,
    emoji: app.emoji,
    description: app.description,
    system_prompt: app.system_prompt,
    ai_provider: app.ai_provider,
    ai_model: app.ai_model,
    tags: app.tags || [],
    input_placeholder: app.input_placeholder || null,
    domain_id: app.domain_id || null,
    app_type: app.app_type || 'prompt',
    form_schema: app.form_schema || [],
    output_type: app.output_type || 'markdown',
    sample_input: app.sample_input || null,
    visibility: 'public',
    is_published: false,   // copies start as drafts; publish from Deploy
    created_by: userId,
    workflow_order: 999,
    total_runs: 0,
  }
  const res = await supabase.from('apps').insert(payload).select(`${APP_PUBLIC_SELECT}, domains(name, emoji, color, slug)`).single()
  return res.data ? { ...res, data: { ...res.data, system_prompt: payload.system_prompt } } : res
}

// Turns a raw thrown error (often a browser-native string like "Failed to
// fetch" that means nothing to a user) into something actionable. Shared
// across every runner so a backend-down/timeout/rate-limit error reads the
// same way no matter which app type the user happened to be running.
// What browsers throw when a request never reaches the server (Chrome,
// Firefox, Safari, React Native). Server messages that merely mention
// "fetch" (e.g. "Could not fetch that URL") must pass through unchanged.
const CONNECTION_FAILURE = /^(Failed to fetch|NetworkError when attempting to fetch resource|Load failed|Network request failed)/i

export function friendlyErrorMessage(err) {
  if (err?.name === 'AbortError') return 'Request timed out. Try a shorter input.'
  const msg = err?.message || ''
  if (CONNECTION_FAILURE.test(msg)) return 'Could not connect to the backend. Check your connection and make sure the server is running.'
  if (msg === '429' || /rate limit/i.test(msg)) return msg === '429' ? 'Rate limit reached. Try again in a moment.' : msg
  return msg || 'Something went wrong. Please try again.'
}

// Opens the user's email client with the result pre-filled as the body —
// the "Export to email" next-best-action. mailto: bodies are practically
// capped well under the URL length limits of most browsers/clients, so the
// result is truncated rather than silently failing to open.
export function emailResult(title, result) {
  const MAX_BODY = 1800
  const body = result.length > MAX_BODY ? result.slice(0, MAX_BODY) + `\n\n[Result truncated — copy the full text from ${BRAND}]` : result
  const subject = encodeURIComponent(title)
  window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(body)}`
}
