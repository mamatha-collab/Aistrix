import { createBrowserClient } from '@supabase/ssr'
import { supabaseWorkspaceFetch } from './lib/workspace'
import { migrateBrowserSession } from './lib/authPaths'

// Was hardcoded directly in source (with two dead placeholder consts left
// alongside it) — now pulled from env like every other config value in this
// app, so nothing project-specific has to change in code to point at a
// different Supabase project (e.g. staging vs. production).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// The custom fetch adds X-Workspace-Id to database requests so new rows are
// filed under the active workspace (see lib/workspace.js).
export const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: supabaseWorkspaceFetch },
})

export const browserSessionReady = typeof window === 'undefined'
  ? Promise.resolve()
  : migrateBrowserSession(supabase, { getItem: key => window.localStorage.getItem(key), removeItem: key => window.localStorage.removeItem(key) }, SUPABASE_URL)

// Local development: say which project this is (and the backend logs its own),
// so a production/staging mix-up is visible at once.
if ((process.env.NODE_ENV !== 'production')) {
  console.info(`[dev] Supabase project ${new URL(SUPABASE_URL).hostname.split('.')[0]} (mode ${(process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NODE_ENV)})`)
}
