import { createClient } from '@supabase/supabase-js'

// Was hardcoded directly in source (with two dead placeholder consts left
// alongside it) — now pulled from env like every other config value in this
// app, so nothing project-specific has to change in code to point at a
// different Supabase project (e.g. staging vs. production).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)