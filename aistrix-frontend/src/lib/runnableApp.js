import { APP_PUBLIC_SELECT, withPrivateField } from './appColumns'

// A published app with what its runner needs (public columns plus the
// private fields the caller may read). null when it isn't published.
export async function loadRunnableApp(client, appId) {
  const { data, error } = await client.from('apps')
    .select(`${APP_PUBLIC_SELECT}, domains(name, emoji, color)`)
    .eq('id', appId).eq('is_published', true).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? withPrivateField(client, data) : null
}
