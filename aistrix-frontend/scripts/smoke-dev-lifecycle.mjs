import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const repo = path.resolve(root, '..')

function readEnv(file) {
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const idx = line.indexOf('=')
      return [line.slice(0, idx), line.slice(idx + 1).replace(/^["']|["']$/g, '')]
    }))
}

const frontendEnv = readEnv(path.join(root, '.env.staging'))
const backendEnv = readEnv(path.join(repo, 'aistrix-backend', '.env.staging'))

const supabaseUrl = frontendEnv.VITE_SUPABASE_URL || backendEnv.SUPABASE_URL
const anonKey = frontendEnv.VITE_SUPABASE_ANON_KEY
const serviceKey = backendEnv.SUPABASE_SERVICE_ROLE_KEY
const apiUrl = (frontendEnv.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

if (!supabaseUrl || !anonKey || !serviceKey) {
  throw new Error('Missing staging Supabase env. Expected VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.')
}

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })

async function api(pathname, token, options = {}) {
  const res = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  return { res, body }
}

function assert(ok, message) {
  if (!ok) throw new Error(message)
}

async function main() {
  const email = process.env.AISTRIX_SMOKE_EMAIL || 'codex-smoke@aistrix.test'
  const password = process.env.AISTRIX_SMOKE_PASSWORD || 'TestPass123!'
  const users = await admin.auth.admin.listUsers()
  let user = users.data.users.find(u => u.email === email)
  if (!user) {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) throw created.error
    user = created.data.user
  } else {
    const updated = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true })
    if (updated.error) throw updated.error
  }

  const signed = await auth.auth.signInWithPassword({ email, password })
  if (signed.error) throw signed.error
  const token = signed.data.session.access_token

  let appId
  try {
    const inserted = await admin.from('apps').insert({
      name: `Smoke Lifecycle ${Date.now()}`,
      emoji: '🧪',
      description: 'Automated staging smoke app for Design, Test, and Deploy lifecycle gates.',
      system_prompt: 'You are a concise assistant. Return a useful answer with a summary and next steps.',
      ai_provider: 'openai',
      ai_model: 'gpt-4o-mini',
      tags: ['smoke', 'dev-lifecycle'],
      input_placeholder: 'Describe the business task.',
      app_type: 'prompt',
      output_type: 'markdown',
      visibility: 'private',
      is_published: false,
      created_by: user.id,
      workflow_order: 999,
      total_runs: 0,
    }).select('id').single()
    if (inserted.error) throw inserted.error
    appId = inserted.data.id

    const blueprint = {
      input_schema: { type: 'object', fields: [
        { field: 'task', type: 'string', required: true, description: 'The business task to complete' },
      ] },
      output_schema: { type: 'object', fields: [
        { field: 'summary', type: 'string', required: true },
        { field: 'next_steps', type: 'string_array', required: true },
      ] },
      output_contract: { format: 'markdown', fields: [] },
      ai_behavior: { missing_data_fallback: 'Ask for the missing task before proceeding.' },
    }
    const bp = await admin.from('app_blueprints').upsert({
      app_id: appId,
      user_id: user.id,
      blueprint,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'app_id' })
    if (bp.error) throw bp.error

    const appMeta = await api(`/v1/apps/${appId}`, token)
    assert(appMeta.res.ok, `GET /v1/apps failed: ${appMeta.res.status}`)
    assert(appMeta.body.input_schema?.length === 1, 'App metadata did not expose the input schema')

    const status = await api(`/v1/apps/${appId}/tests/status`, token)
    assert(status.res.ok, `GET test status failed: ${status.res.status}`)
    assert(status.body.requirements?.some(r => r.id === 'functional'), 'Test status did not include functional requirement')
    assert(status.body.all_passed === false, 'New untested app should not pass the quality gate')

    const release = await api(`/v1/apps/${appId}/release`, token)
    assert(release.res.ok, `GET release failed: ${release.res.status}`)
    assert(release.body.ready === false, 'Untested app should not be release-ready')
    assert(release.body.test_problems?.length, 'Release gate should explain missing tests')

    const promote = await api(`/v1/apps/${appId}/promote`, token, { method: 'POST' })
    assert(promote.res.status === 409, `Promote should be blocked before tests pass, got ${promote.res.status}`)

    console.log(JSON.stringify({
      ok: true,
      appId,
      requirements: status.body.requirements.map(r => `${r.id}:${r.status}`),
      releaseReady: release.body.ready,
      promoteStatus: promote.res.status,
    }, null, 2))
  } finally {
    if (appId) {
      await admin.from('app_blueprints').delete().eq('app_id', appId)
      await admin.from('apps').delete().eq('id', appId)
    }
  }
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
