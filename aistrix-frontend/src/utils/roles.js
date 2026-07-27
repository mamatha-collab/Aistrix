import { supabase } from '../supabase'

export async function getUserRole(userId) {
  if (!userId) return null
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return null
    return data?.role || null
  } catch {
    return null
  }
}

export const isAdmin = role => role === 'admin'
export const isModerator = role => role === 'admin' || role === 'moderator'
