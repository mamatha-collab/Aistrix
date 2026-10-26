import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export function createPublicClient() {
  // Public catalog reads never inherit a user's cookies or a service-role key.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  })
}

export async function createSessionClient() {
  const jar = await cookies()
  return createServerClient(url, key, { cookies: {
    getAll: () => jar.getAll(),
    setAll(values) {
      // Server Components cannot write cookies. The proxy refreshes them before
      // rendering; writable route handlers use their own response adapter.
      try { values.forEach(({ name, value, options }) => jar.set(name, value, options)) }
      catch { /* Read-only Server Component cookie store. */ }
    },
  } })
}
