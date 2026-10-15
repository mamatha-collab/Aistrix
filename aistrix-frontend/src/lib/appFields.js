// Saving app settings without overwriting a teammate: the server writes the
// change only if the fields being changed still hold the values this screen
// loaded (update_app_fields). Other fields — run counters, someone else's
// edit to a different setting — never block a save.

const LABELS = {
  system_prompt: 'the prompt', description: 'the description', ai_model: 'the model', ai_provider: 'the AI provider',
  output_type: 'the output format', billing_mode: 'who pays', free_runs_per_user_day: 'the free runs per user',
  webhook_url: 'the webhook', max_runs_per_day: 'the daily limit', embed_public: 'visitor access',
  embed_allowed_domains: 'the allowed websites', required_context: 'the required context', visibility: 'who can open it',
  is_paid: 'the price', price_per_run: 'the price', change_note: 'the change note',
}

export class AppConflictError extends Error {
  constructor(conflicts = [], current = {}) {
    const what = [...new Set(conflicts.map(k => LABELS[k] || k.replace(/_/g, ' ')))].join(', ')
    super(`Someone else changed ${what || 'this app'} since you opened it. Showing their version — make your change again if you still want it.`)
    this.name = 'AppConflictError'
    this.conflicts = conflicts
    this.current = current     // their values, to show instead of the stale ones
  }
}

// app: the app as this screen loaded it (the values to compare against).
// patch: the fields to change. expected (optional): compare against these
// instead (e.g. to save over a teammate's change on purpose).
// Returns { error } like a Supabase call; error is an AppConflictError when
// someone else changed one of these fields first.
export async function saveAppFields(client, app, patch, { expected } = {}) {
  const base = expected || Object.fromEntries(
    Object.keys(patch).filter(k => app && k in app).map(k => [k, app[k] ?? null]))
  const { data, error } = await client.rpc('update_app_fields', { p_app_id: app.id, p_patch: patch, p_expected: base })
  if (error?.code === 'PGRST202') {
    // update_app_fields isn't on this database yet (migration pending): plain update.
    const { error: plainError } = await client.from('apps').update(patch).eq('id', app.id)
    return { error: plainError || null }
  }
  if (error) return { error }
  if (data && data.ok === false) return { error: new AppConflictError(data.conflicts, data.current) }
  return { error: null }
}
