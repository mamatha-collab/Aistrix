import 'server-only'
import { redirect } from 'next/navigation'
import { createSessionClient } from './supabase'
import { workspaceReturnPath } from '../lib/workspaceRoutes'

export async function requireWorkspaceSession(path, query) {
  const client = await createSessionClient()
  const { data, error } = await client.auth.getUser()
  if (error || !data?.user) {
    const next = workspaceReturnPath(path, await query)
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }
  return data.user
}
