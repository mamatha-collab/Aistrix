// A developer's integration settings (developer_settings.settings, one JSON
// object per user: langfuse, sentry, stripe, unleash…).

export async function loadDeveloperSettings(client, userId) {
  const { data, error } = await client
    .from('developer_settings')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data?.settings || {}
}

// Saves one integration without touching the others: merges into a fresh
// read of the saved settings, never into what a page loaded (which is empty
// if that load failed — saving it would wipe the rest).
export async function saveDeveloperSetting(client, userId, key, vals) {
  let current
  try {
    current = await loadDeveloperSettings(client, userId)
  } catch {
    throw new Error("Couldn't read your saved integrations, so nothing was saved (to avoid overwriting them). Try again.")
  }
  const merged = { ...current, [key]: vals }
  const { error } = await client.from('developer_settings')
    .upsert({ user_id: userId, settings: merged }, { onConflict: 'user_id' })
  if (error) throw error
  return merged
}
