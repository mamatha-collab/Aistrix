import { createClient } from '@supabase/supabase-js'
import { supabaseWorkspaceFetch } from './lib/workspace'

// Was hardcoded directly in source (with two dead placeholder consts left
// alongside it) — now pulled from env like every other config value in this
// app, so nothing project-specific has to change in code to point at a
// different Supabase project (e.g. staging vs. production).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// The custom fetch adds X-Workspace-Id to database requests so new rows are
// filed under the active workspace (see lib/workspace.js).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: supabaseWorkspaceFetch },
})

// Local development: say which project this is (and the backend logs its own),
// so a production/staging mix-up is visible at once.
if (import.meta.env.DEV) {
  console.info(`[dev] Supabase project ${new URL(SUPABASE_URL).hostname.split('.')[0]} (mode ${import.meta.env.MODE})`)
}
