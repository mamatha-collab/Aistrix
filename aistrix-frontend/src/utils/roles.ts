import { supabase } from '../supabase'

export async function getUserRole(userId: string | undefined) {
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

export const isAdmin = (role: string | null | undefined) => role === 'admin'
export const isModerator = (role: string | null | undefined) => role === 'admin' || role === 'moderator'
