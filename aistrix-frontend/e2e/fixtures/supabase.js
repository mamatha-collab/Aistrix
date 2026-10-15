// Used only by the isolated browser fixture server; never by production Vite.
import { reviewState } from '../../src/lib/promotionReview'
const copy = value => structuredClone(value)
const blueprint = {
  dev_phase: 'design', inputs: [{ key: 'task', label: 'Task', type: 'short_text', required: true }],
  input_schema: { type: 'object', fields: [{ field: 'task', type: 'string', required: true }] },
  output_contract: { format: 'markdown', sections: ['Summary'] },
  ai_behavior: { fallback_behavior: 'Ask for the missing task.' },
}
const app = {
  id: 'app-1', name: 'Fixture Assistant', emoji: '✦', description: 'A fixture business assistant.',
  system_prompt: 'Answer the task in markdown with a Summary section.', ai_provider: 'openai', ai_model: 'gpt-4o',
  output_type: 'markdown', app_type: 'prompt', created_by: 'fixture-user', total_runs: 0,
  is_published: false, visibility: 'private', form_schema: [],
}

export const state = window.buildFixture = {
  tables: {
    apps: [app, { ...app, id: 'app-2', name: 'Second Assistant' }],
    app_blueprints: ['app-1', 'app-2'].map(app_id => ({ app_id, user_id: 'fixture-user', blueprint: copy(blueprint), updated_at: '2026-10-14T12:00:00.000Z' })),
    app_tools: [], app_test_cases: [], app_versions: [],
  },
  failures: {}, requests: [], testRuns: [], toasts: [],
}
if (new URLSearchParams(location.search).get('scenario') === 'read-failure') {
  state.failures['app_blueprints:select'] = 'Saved design temporarily unavailable'
}
if (new URLSearchParams(location.search).get('scenario')?.startsWith('live')) {
  state.tables.app_blueprints[0].blueprint.dev_phase = 'deploy'
  const v1 = snapshot({ ...app, system_prompt: 'Original published prompt.' })
  const v2 = snapshot({ ...app, system_prompt: 'Current published prompt.' })
  Object.assign(app, { is_published: true, live_version: 2, prod_snapshot: v2, has_draft_changes: true })
  state.tables.app_versions = [v1, v2].map((version_data, index) => ({ app_id: app.id, version_num: index + 1, version_data, changelog: `Release ${index + 1}`, created_at: '2026-10-14T12:00:00Z' }))
  for (const category of ['functional', 'edge', 'safety', 'performance']) {
    state.testRuns.push({ app_id: app.id, category, passed: true, draft: JSON.stringify(snapshot(app)) })
  }
}
if (new URLSearchParams(location.search).get('scenario') === 'live-preview-failure') {
  state.failures['/v1/apps/app-1/live-preview'] = 'Temporary preview failure'
}

class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.wantSingle = false }
  select() { return this }
  eq(key, value) { this.filters.push(row => row[key] === value); return this }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this }
  is(key, value) { this.filters.push(row => row[key] === value); return this }
  order() { return this }
  limit() { return this }
  insert(value) { this.op = 'insert'; this.value = value; return this }
  upsert(value) { this.op = 'upsert'; this.value = value; return this }
  update(value) { this.op = 'update'; this.value = value; return this }
  delete() { this.op = 'delete'; return this }
  maybeSingle() { this.wantSingle = true; return this }
  single() { this.wantSingle = true; return this }
  then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject) }
  execute() {
    const failureKey = `${this.table}:${this.op}`
    if (state.failures[failureKey]) return { data: null, error: { message: state.failures[failureKey], code: 'FIXTURE_ERROR' } }
    const rows = state.tables[this.table] ||= []
    let data = rows.filter(row => this.filters.every(filter => filter(row)))
    if (this.op === 'insert' || this.op === 'upsert') {
      const incoming = (Array.isArray(this.value) ? this.value : [this.value]).map(copy)
      for (const row of incoming) {
        if (!row.id && this.table !== 'app_blueprints') row.id = `fixture-${rows.length + 1}`
        const existing = this.table === 'app_blueprints' && rows.find(r => r.app_id === row.app_id)
        if (existing && this.op === 'insert') return { data: null, error: { code: '23505', message: 'Duplicate blueprint' } }
        if (existing) Object.assign(existing, row)
        else rows.push(row)
      }
      data = incoming
    } else if (this.op === 'update') data.forEach(row => Object.assign(row, copy(this.value)))
    else if (this.op === 'delete') state.tables[this.table] = rows.filter(row => !data.includes(row))
    return { data: copy(this.wantSingle ? data[0] || null : data), error: null, count: data.length }
  }
}

export const supabase = {
  from: table => new Query(table),
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel: () => {},
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'fixture-token', user: { id: 'fixture-user' } } } }),
    signOut: async () => ({}),
  },
  rpc: async (name, args) => {
    if (name === 'set_app_published_with_gate') {
      const current = state.tables.apps.find(row => row.id === args.p_app_id)
      if (current) current.is_published = args.p_publish
    }
    if (name === 'app_private_fields') {
      // The fixture user edits every app: return their private columns.
      const keys = ['system_prompt', 'pages', 'prod_snapshot', 'webhook_url', 'custom_model_url', 'custom_model_name', 'change_note', 'review_notes']
      const rows = state.tables.apps.filter(row => (args.p_app_ids || []).includes(row.id))
        .map(row => ({ id: row.id, ...Object.fromEntries(keys.map(k => [k, row[k] ?? null])) }))
      return { data: rows, error: null }
    }
    if (name === 'update_app_fields') {
      // Same contract as the database function: write only if the changed
      // fields still hold the values the screen loaded.
      const current = state.tables.apps.find(row => row.id === args.p_app_id)
      if (!current) return { data: null, error: { code: 'P0002', message: 'App not found' } }
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
      const conflicts = Object.keys(args.p_expected || {}).filter(k => !same(current[k], args.p_expected[k])).sort()
      if (conflicts.length) {
        return { data: { ok: false, conflicts, current: Object.fromEntries(conflicts.map(k => [k, current[k] ?? null])) }, error: null }
      }
      Object.assign(current, args.p_patch)
      return { data: { ok: true }, error: null }
    }
    return { data: [{ ok: true }], error: null }
  },
}

function status(id) {
  const current = state.tables.apps.find(row => row.id === id)
  const runs = state.testRuns.filter(run => run.app_id === id && run.draft === JSON.stringify(snapshot(current)))
  const requirements = ['functional', 'edge', 'safety', 'performance'].map(category => ({
    id: category, label: category, required: true,
    passed: runs.some(run => run.category === category && run.passed),
    status: runs.some(run => run.category === category && run.passed) ? 'passed' : 'missing',
  }))
  return { requirements, all_passed: requirements.every(r => r.passed), total: runs.length,
    passed: runs.filter(run => run.passed).length, failed: [], required_total: 4,
    required_passed: requirements.filter(r => r.passed).length, profile: { runs: runs.filter(r => r.category === 'performance').length } }
}

const nativeFetch = window.fetch.bind(window)
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href)
  if (!url.pathname.startsWith('/v1/')) return nativeFetch(input, init)
  const path = url.pathname
  state.requests.push({ path, method: init.method || 'GET' })
  const response = (body, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } })
  if (state.failures[path]) return response({ error: state.failures[path], detail: state.failures[path] }, 503)
  if (path === '/v1/providers') return response({ providers: [{ id: 'openai', label: 'OpenAI', connected: true, default_model: 'gpt-4o', models: [{ id: 'gpt-4o', label: 'GPT-4o' }] }] })
  if (path === '/v1/usage') return response({ daily: { used: 0, limit: 100 }, has_keys: true })
  const id = path.split('/')[3]
  const current = state.tables.apps.find(row => row.id === id)
  if (path.endsWith('/tests/status')) return response(status(id))
  if (path.endsWith('/tests/run')) {
    const body = JSON.parse(init.body)
    const run = { ...body, app_id: id, passed: true, output: '## Summary\nUseful business answer.', errors: [], latency_ms: 200,
      category: body.source === 'profile' ? 'performance' : body.category || 'functional', substantive_checks: 1 }
    state.testRuns.push({ ...run, draft: JSON.stringify(snapshot(current)) })
    return response(run)
  }
  if (path.endsWith('/release')) {
    const tests = status(id)
    return response({ ready: tests.all_passed, tests, checks: [], test_problems: tests.all_passed ? [] : ['Run the current draft tests.'],
      has_changes: JSON.stringify(current?.prod_snapshot) !== JSON.stringify(snapshot(current)), has_live_version: !!current?.prod_snapshot })
  }
  if (path.endsWith('/promote')) {
    if (!status(id).all_passed) return response({ error: 'Tests required', test_problems: ['Run tests.'] }, 409)
    const version = (current.live_version || 0) + 1
    current.prod_snapshot = snapshot(current)
    Object.assign(current, { live_version: version, is_published: true, has_draft_changes: false })
    state.tables.app_versions.push({ app_id: id, version_num: version, version_data: copy(current.prod_snapshot), created_at: new Date().toISOString(), changelog: `Release ${version}` })
    return response({ ok: true, version, promoted_at: new Date().toISOString() })
  }
  if (path.endsWith('/versions')) return response({ versions: state.tables.app_versions.filter(row => row.app_id === id).sort((a, b) => b.version_num - a.version_num).map(row => ({ ...row, is_live: row.version_num === current.live_version })), live_version: current.live_version })
  if (path.endsWith('/rollback')) {
    const version = Number(path.split('/').at(-2))
    const row = state.tables.app_versions.find(row => row.app_id === id && row.version_num === version)
    if (!row) return response({ error: 'Not found' }, 404)
    current.prod_snapshot = copy(row.version_data)
    Object.assign(current, { live_version: version, is_published: true, has_draft_changes: true })
    return response({ ok: true, live_version: version, promoted_at: new Date().toISOString(), has_draft_changes: true })
  }
  if (path.endsWith('/live-preview')) return response({ ...current, ...(current?.prod_snapshot || {}), live_version: current?.live_version,
    source: current?.prod_snapshot ? (current.is_published ? 'live' : 'offline') : 'draft' })
  if (path.endsWith('/stats')) return response({ total: 0, users: 0, sample: 0 })
  if (path.endsWith('/trigger')) return response({ token: null })
  return response({})
}

function snapshot(current) {
  return copy(reviewState(current, state.tables.app_blueprints.find(row => row.app_id === current?.id)?.blueprint,
    state.tables.app_tools.filter(row => row.app_id === current?.id)))
}
