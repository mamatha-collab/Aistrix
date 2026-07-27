// Creates 3 local test accounts via the Supabase Admin API and assigns roles:
//   1. End user      — no role row (default/regular account)
//   2. Moderator      — role = 'moderator' in user_roles
//   3. App developer  — no special role; any signed-in user can build/publish
//                       apps (the "Developer" tab has no role gate), so this
//                       account is just a second plain user for testing
//                       app-creation flows separately from the end-user one.
//
// Usage:
//   1. Add SUPABASE_SERVICE_ROLE_KEY to aistrix-backend/.env (Supabase
//      dashboard → Project Settings → API → service_role key). Never commit
//      this key or expose it to the frontend.
//   2. Run: node scripts/create_test_users.mjs
//
// Safe to re-run — existing accounts are detected and skipped/updated rather
// than duplicated.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', 'aistrix-backend', '.env')

function loadEnv(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

const fileEnv = loadEnv(envPath)
const SUPABASE_URL = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  console.error(`Add SUPABASE_SERVICE_ROLE_KEY to ${envPath} (Supabase dashboard → Project Settings → API → service_role) and re-run.`)
  process.exit(1)
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

const USERS = [
  { email: 'enduser@aistrix.test',  password: 'TestPass123!', role: null },
  { email: 'moderator@aistrix.test', password: 'TestPass123!', role: 'moderator' },
  { email: 'developer@aistrix.test', password: 'TestPass123!', role: null },
]

async function findUserByEmail(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { headers })
  if (!res.ok) return null
  const data = await res.json()
  return (data.users || []).find(u => u.email === email) || null
}

async function createUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.msg || data.message || JSON.stringify(data))
  return data
}

async function setRole(userId, role) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: userId, role }),
  })
  if (!res.ok) throw new Error(await res.text())
}

for (const u of USERS) {
  let user = await findUserByEmail(u.email)
  if (user) {
    console.log(`✓ ${u.email} already exists (${user.id}) — skipping creation`)
  } else {
    user = await createUser(u.email, u.password)
    console.log(`✓ created ${u.email} (${user.id})`)
  }
  if (u.role) {
    await setRole(user.id, u.role)
    console.log(`  → role set to '${u.role}'`)
  }
}

console.log('\nDone. Sign in locally with:')
for (const u of USERS) console.log(`  ${u.email} / ${u.password}`)
