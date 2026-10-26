import { PUBLIC_PROFILE_SELECT } from './publicCatalog'

const BASE_FIELDS = 'user_id,display_name,bio,website'

export async function loadPublicProfiles(client, ids) {
  if (!ids.length) return []
  let relation = 'public_developer_profiles'
  let result = await client.from(relation).select(PUBLIC_PROFILE_SELECT).in('user_id', ids)
  if (['42P01', 'PGRST205'].includes(result.error?.code) && /public_developer_profiles/.test(result.error.message || '')) {
    // Before the public view migration, honor the original table's owner-only
    // RLS. Anonymous profiles remain absent rather than using a privileged key.
    relation = 'developer_profiles'
    result = await client.from(relation).select(PUBLIC_PROFILE_SELECT).in('user_id', ids)
  }
  // The baseline schema predates these optional public profile fields. Keep
  // discovery working during additive migration rollout; do not mask auth,
  // network or other schema failures as an empty catalog.
  if (['42703', 'PGRST204'].includes(result.error?.code) && /\b(github|twitter|avatar_url)\b/.test(result.error.message || '')) {
    result = await client.from(relation).select(BASE_FIELDS).in('user_id', ids)
  }
  if (result.error) throw new Error('Public developer profiles are temporarily unavailable.')
  return result.data || []
}

export async function savePublicProfile(client, userId, form) {
  const optional = { github: form.github?.trim() || null, twitter: form.twitter?.trim() || null, avatar_url: form.avatar_url?.trim() || null }
  const basic = { user_id: userId, display_name: form.display_name?.trim() || null, bio: form.bio?.trim() || null, website: form.website?.trim() || null }
  let result = await client.from('developer_profiles').upsert({ ...basic, ...optional, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (['42703', 'PGRST204'].includes(result.error?.code) && /\b(github|twitter|avatar_url|updated_at)\b/.test(result.error.message || '')) {
    if (Object.values(optional).some(Boolean)) {
      throw new Error('Profile links and avatars need the latest database update. Your changes have not been saved.')
    }
    result = await client.from('developer_profiles').upsert(basic, { onConflict: 'user_id' })
  }
  if (result.error) throw new Error('Your profile could not be saved. Your edits are still available; please retry.')
}
