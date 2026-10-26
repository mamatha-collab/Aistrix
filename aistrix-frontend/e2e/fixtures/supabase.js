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
    marketplace_listings: [],
    app_comparisons: [],
    app_blueprints: ['app-1', 'app-2'].map(app_id => ({ app_id, user_id: 'fixture-user', blueprint: copy(blueprint), updated_at: '2026-10-14T12:00:00.000Z' })),
    app_tools: [], app_test_cases: [], app_versions: [],
  },
  failures: {}, requests: [], testRuns: [], toasts: [],
}
// ?phase2=test: the second (unpublished) app is in the Test step.
if (new URLSearchParams(location.search).get('phase2')) {
  state.tables.app_blueprints[1].blueprint.dev_phase = new URLSearchParams(location.search).get('phase2')
}
if (new URLSearchParams(location.search).get('scenario') === 'empty') {
  state.tables.apps = []
  state.tables.app_blueprints = []
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

if (new URLSearchParams(location.search).get('scenario')?.startsWith('market-customer')) {
  Object.assign(app, { is_published: true, live_version: 1, visibility: 'public' })
  state.tables.marketplace_listings = Array.from({ length: 26 }, (_, index) => ({
    id: `market-${index}`, app_id: index === 0 ? 'app-1' : `customer-app-${index}`, user_id: 'fixture-user', title: `Listed app ${index + 1}`,
    tagline: 'Clear business answers', category: index === 25 ? 'Engineering' : 'Productivity', status: 'live',
  }))
  state.tables.apps.push(...Array.from({ length: 25 }, (_, index) => ({ ...app, id: `customer-app-${index + 1}` })))
  state.tables.marketplace_listings.push({ id: 'hidden', app_id: 'app-2', user_id: 'fixture-user', title: 'Unpublished app', status: 'live' })
  state.tables.developer_profiles = [{ user_id: 'fixture-user', display_name: 'Fixture Developer' }]
  state.tables.app_reviews = []; state.tables.app_entitlements = []
}

class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.wantSingle = false }
  select(selection) { this.selection = selection; return this }
  eq(key, value) { this.filters.push(row => key.split('.').reduce((item, part) => item?.[part], row) === value); return this }
  or(expression) { const alternatives = expression.split(',').map(part => part.split('.eq.')); this.filters.push(row => alternatives.some(([key,value]) => String(row[key]) === value)); return this }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this }
  gte(key, value) { this.filters.push(row => row[key] != null && row[key] >= value); return this }
  is(key, value) { this.filters.push(row => (row[key] ?? null) === value); return this }
  // JSON containment as PostgREST does it: every object in the wanted array is matched by one in the column.
  contains(key, value) {
    const wanted = typeof value === 'string' ? JSON.parse(value) : value
    const matches = (have, want) => want && typeof want === 'object' ? Object.entries(want).every(([k, v]) => matches(have?.[k], v)) : have === want
    this.filters.push(row => Array.isArray(row[key]) && wanted.every(want => row[key].some(have => matches(have, want)))); return this
  }
  not(key, operator, value) {
    if (operator !== 'is') throw new Error(`Unsupported fixture operator: ${operator}`)
    this.filters.push(row => value === null ? row[key] != null : row[key] !== value)
    return this
  }
  ilike(key, pattern) {
    const needle = pattern.slice(1, -1).replace(/\\([%_\\])/g, '$1').toLowerCase()
    this.filters.push(row => String(row[key] || '').toLowerCase().includes(needle)); return this
  }
  range(start, end) { this.bounds = [start, end]; return this }
  order() { return this }
  limit() { return this }
  insert(value) { this.op = 'insert'; this.value = value; return this }
  upsert(value) { this.op = 'upsert'; this.value = value; return this }
  update(value) { this.op = 'update'; this.value = value; return this }
  delete() { this.op = 'delete'; return this }
  maybeSingle() { this.wantSingle = true; return this }
  single() { this.wantSingle = true; return this }
  // ?slow=<table>: that table answers after a network-like delay.
  then(resolve, reject) {
    const slow = new URLSearchParams(location.search).get('slow') === this.table && this.op === 'select'
    const wait = slow ? new Promise(done => setTimeout(done, 400)) : Promise.resolve()
    return wait.then(() => this.execute()).then(resolve, reject)
  }
  execute() {
    if (this.table === 'public_developer_profiles' && !state.tables.public_developer_profiles) {
      return { data: null, error: { code: 'PGRST205', message: 'Could not find public_developer_profiles in the schema cache' } }
    }
    const failureKey = `${this.table}:${this.op}`
    if (state.failures[failureKey]) return { data: null, error: { message: state.failures[failureKey], code: 'FIXTURE_ERROR' } }
    const rows = state.tables[this.table] ||= []
    const selectedRows = this.selection?.includes('apps!inner') ? rows.map(row => ({ ...row, apps: state.tables.apps.find(app => app.id === row.app_id) })).filter(row => row.apps)
      : this.table === 'apps' && this.selection?.includes('marketplace_listings(')
        ? rows.map(row => ({ ...row, marketplace_listings: state.tables.marketplace_listings.filter(listing => listing.app_id === row.id),
          domains: (state.tables.domains || []).find(domain => domain.id === row.domain_id) || null })) : rows
    let data = selectedRows.filter(row => this.filters.every(filter => filter(row)))
    if (this.op === 'insert' || this.op === 'upsert') {
      const incoming = (Array.isArray(this.value) ? this.value : [this.value]).map(copy)
      for (const row of incoming) {
        if (!row.id && this.table !== 'app_blueprints') row.id = `fixture-${rows.length + 1}`
        const existing = this.table === 'app_blueprints' ? rows.find(r => r.app_id === row.app_id) : rows.find(r => r.id === row.id)
        if (existing && this.op === 'insert') return { data: null, error: { code: '23505', message: 'Duplicate blueprint' } }
        if (existing) Object.assign(existing, row)
        else rows.push(row)
      }
      data = incoming
    } else if (this.op === 'update') data.forEach(row => Object.assign(row, copy(this.value)))
    else if (this.op === 'delete') state.tables[this.table] = rows.filter(row => !data.includes(row))
    const count = data.length
    if (this.bounds) data = data.slice(this.bounds[0], this.bounds[1] + 1)
    return { data: copy(this.wantSingle ? data[0] || null : data), error: null, count }
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
    if (state.failures[`rpc:${name}`]) return { data: null, error: { message: state.failures[`rpc:${name}`] } }
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
    // Every test's latest result, like the server's tests/status (used by the Test PDF report).
    cases: runs.map(run => ({ label: run.label || run.case_ref || run.category, source: run.source || 'suite', category: run.category,
      passed: !!run.passed, errors: run.errors || [], input: run.input || '', output: run.output || '' })),
    required_passed: requirements.filter(r => r.passed).length, profile: { runs: runs.filter(r => r.category === 'performance').length } }
}

const nativeFetch = window.fetch.bind(window)
const scenario = new URLSearchParams(location.search).get('scenario') || ''
if (scenario === 'operations') {
  const now = new Date().toISOString()
  const reported = new Date(Date.now() - 3600000).toISOString()   // feedback came in before the latest release
  state.tables.run_history = [
    { id: 'run-invoice', app_id: 'app-1', app_name: 'Fixture Assistant', user_id: 'fixture-user', created_at: now, rating_value: -1, feedback_text: 'The answer invented an invoice number.', input: 'Check invoice with no invoice number.', output: 'Invoice 123 is complete.' },
    { id: 'run-other', app_id: 'app-2', app_name: 'Second Assistant', user_id: 'fixture-user', created_at: now, rating_value: -1, feedback_text: 'The translation ignored the glossary.', input: 'Translate the receipt.', output: 'Incorrect translation.' },
  ]
  Object.assign(app, { is_published: true, live_version: 1, total_runs: 4, promoted_at: now, prod_snapshot: snapshot(app) })
  state.tables.app_blueprints[0].blueprint.dev_phase = 'deploy'
  // What the server shares with the developers (customers chose to include the run).
  state.feedback = state.tables.run_history.map((r, i) => ({ id: `fb-${i + 1}`, app_id: r.app_id, run_id: r.id, rating: r.rating_value,
    comment: r.feedback_text, shared_input: r.input, shared_output: r.output, status: 'new', note: null, test_case_id: null, created_at: reported, updated_at: reported }))
}

if (scenario === 'business') {
  Object.assign(app, { is_published: true, live_version: 1, visibility: 'public', status: 'active', tags: ['support'] })
  state.tables.flows = []; state.tables.flow_schedules=[]; state.tables.favorites=[]
  state.tables.marketplace_listings=[{id:'business-listing',app_id:'app-1',user_id:'fixture-user',title:'Fixture Assistant',tagline:'Useful business answers',category:'Productivity',status:'live'}]
}

// Build with AI: the two model calls (follow-up questions, then the app
// config), streamed the way /run streams them.
function fakeModelReply(body) {
  const config = body.input?.includes('Requirements:')
  const json = config
    ? { name: 'Invoice Checker', emoji: '🧾', description: 'Checks invoices for missing fields.',
        system_prompt: 'You review invoices for a finance team. List missing fields, totals that do not add up, and duplicates. '.repeat(3),
        app_type: 'prompt', output_type: 'markdown', tools: [], tags: ['finance'], notes: 'Ready to test.' }
    : { questions: [{ id: 'q1', question: 'Who will use it?', options: ['Finance team', 'Freelancers'] }] }
  const events = [JSON.stringify({ token: JSON.stringify(json) }), JSON.stringify({ done: true, provider: 'openai', model: 'gpt-4o' })]
  return new Response(events.map(e => `data: ${e}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function monitorFor(appId, days) {
  const busy = scenario === 'monitor' && appId === 'app-1'
  const daily = Array.from({ length: days }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (days - 1 - i))
    return { date: d.toISOString().slice(0, 10), runs: busy ? 10 : 0, errors: busy && i === days - 1 ? 4 : 0, cost_usd: busy ? 0.02 : 0, satisfaction: null, rated: 0 }
  })
  const runs = daily.reduce((n, d) => n + d.runs, 0), errors = daily.reduce((n, d) => n + d.errors, 0)
  return {
    days, daily, truncated: false,
    totals: { runs, users: busy ? 6 : 0, visitor_runs: busy ? 3 : 0, errors, error_rate: runs ? errors / runs : null,
      latency_p50_ms: busy ? 1200 : null, latency_p95_ms: busy ? 4200 : null, cost_usd: busy ? 0.02 * days : null,
      cost_recorded_runs: busy ? runs : 0, cost_per_run_usd: busy ? 0.002 : null, rated: busy ? 8 : 0, satisfaction: busy ? 0.75 : null, last_run: null },
    by_version: busy ? [{ version: 2, runs: runs - 20, errors, error_rate: errors / (runs - 20), latency_p95_ms: 4200 }, { version: 1, runs: 20, errors: 0, error_rate: 0, latency_p95_ms: 3000 }] : [],
    by_source: busy ? { app: runs - 3, embed: 3 } : {},
    error_kinds: busy ? { timeout: errors } : {},
    alerts: busy ? [{ level: 'critical', kind: 'errors_24h', message: '40% of runs failed in the last 24 hours (4 of 10).' }] : [],
  }
}

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href)
  if (url.pathname === '/run') {
    state.requests.push({ path: '/run', method: 'POST', body: JSON.parse(init.body || '{}') })
    return fakeModelReply(JSON.parse(init.body || '{}'))
  }
  if (url.pathname === '/stripe/earnings.csv') {
    state.requests.push({ path: url.pathname + url.search, method: 'GET' })
    return new Response('date,app,plan,sale_usd\n2026-10-19,Fixture Assistant,pay_per_run,2.5\n', { status: 200,
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="aistrix-revenue-30d-2026-10-19.csv"' } })
  }
  if (url.pathname === '/stripe/payouts/retry') {
    state.requests.push({ path: url.pathname, method: 'POST' })
    const result = state.payoutResult || { sent: 2, failed: 0, in_progress: 0, remaining: 0 }
    if (state.earnings && !result.remaining) Object.assign(state.earnings, { total_pending: 0, owed_count: 0 })
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (url.pathname === '/stripe/earnings' || url.pathname === '/stripe/connect/status' || /^\/apps\/[^/]+\/secrets(?:\/[^/]+)?$/.test(url.pathname)) {
    const path = url.pathname
    state.requests.push({ path, search: url.search, method: init.method || 'GET', authorized: init.headers?.Authorization === 'Bearer fixture-token' })
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (state.failures[path]) return json({ detail: state.failures[path] }, 503)
    if (path === '/stripe/earnings') return json(state.earnings || { total_gross: 0, total_dev_share: 0, total_pending: 0, platform_fee_pct: 20, by_app: [], recent: [] })
    if (path === '/stripe/connect/status') return json({ connected: false, details_submitted: false, payouts_enabled: false })
    const appId = path.split('/')[2]
    state.secretsByApp ||= {}
    const secrets = state.secretsByApp[appId] ||= []
    if (init.method === 'DELETE') {
      state.secretsByApp[appId] = secrets.filter(s => s.key !== decodeURIComponent(path.split('/')[4]))
      return json({ ok: true })
    }
    if (init.method === 'PUT') {
      const { key } = JSON.parse(init.body)
      const existing = secrets.find(s => s.key === key)
      if (existing) existing.updated_at = new Date().toISOString()
      else secrets.push({ key, updated_at: new Date().toISOString() })
      return json({ key })
    }
    // secretsNeeded: names the app's tools use ({{secrets.NAME}}), as the server reports them.
    const needed = (state.secretsNeeded || {})[appId] || []
    return json({ secrets: secrets.map(s => ({ ...s, used_by: needed.filter(n => n.key === s.key).flatMap(n => n.used_by) })),
      missing: needed.filter(n => !secrets.some(s => s.key === n.key)) })
  }
  if (!url.pathname.startsWith('/v1/')) return nativeFetch(input, init)
  const path = url.pathname
  state.requests.push({ path, method: init.method || 'GET' })
  const response = (body, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } })
  if (state.failures[path]) return response({ error: state.failures[path], detail: state.failures[path] }, 503)
  // scenario=…nokey: the developer has no OpenAI key saved.
  if (path === '/v1/providers') return response({ providers: [{ id: 'openai', label: 'OpenAI', connected: !scenario.includes('nokey'), default_model: 'gpt-4o', models: [{ id: 'gpt-4o', label: 'GPT-4o' }] }] })
  if (path === '/v1/usage') return response({ daily: { used: 0, limit: 100 }, has_keys: true })
  // Developer plan and the account's data (same shapes as the server).
  if (path === '/v1/developer/plan') {
    const limits = { draft_apps: 5, published_apps: 3, tests_per_day: 20, concurrent_tests: 1, analytics: 'basic' }
    return response(state.plan || { tier: 'free', label: 'Free developer', limits, usage: { draft_apps: 2, published_apps: 1, tests_today: 4 },
      all_limits: { free: limits, verified: { draft_apps: 10, published_apps: 6, tests_per_day: 100, concurrent_tests: 3, analytics: 'standard' } } })
  }
  if (path === '/v1/account/deletion-check') return response(state.deletionCheck || { can_delete: true, blockers: [] })
  if (path === '/v1/account/delete') {
    state.deletedAccount = JSON.parse(init.body || '{}').confirm
    return response({ ok: true })
  }
  if (path === '/v1/account/export') {
    return new Response(JSON.stringify({ user_id: 'fixture-user', apps: state.tables.apps }), { status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="aistrix-account-2026-10-20.json"' } })
  }
  // Marketplace: the server puts a listing live (the browser can't).
  if (/^\/v1\/apps\/[^/]+\/listing\/(go-live|unlist)$/.test(path)) {
    const listing = (state.tables.marketplace_listings || []).find(l => l.app_id === path.split('/')[3])
    if (!listing) return response({ error: 'Save a listing first', detail: 'Save a listing first' }, 409)
    listing.status = path.endsWith('/unlist') ? 'draft' : 'live'
    return response({ ok: true, listing })
  }
  // Customer feedback inbox and ratings (server side).
  state.feedback ||= []
  if (/^\/v1\/apps\/[^/]+\/feedback$/.test(path)) {
    const appId = path.split('/')[3], status = url.searchParams.get('status') || 'open'
    const mine = state.feedback.filter(f => f.app_id === appId)
    const items = mine.filter(f => status === 'all' || (status === 'open' ? ['new', 'investigating'].includes(f.status) : f.status === status))
    const counts = {}
    for (const f of mine) counts[f.status] = (counts[f.status] || 0) + 1
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 200)
    return response({ items: items.slice(offset, offset + limit), counts, next_offset: items.length > offset + limit ? offset + limit : null, counts_truncated: false })
  }
  if (/^\/v1\/feedback\/[^/]+$/.test(path) && init.method === 'PATCH') {
    const item = state.feedback.find(f => f.id === path.split('/')[3])
    if (!item) return response({ detail: 'Feedback not found' }, 404)
    Object.assign(item, JSON.parse(init.body))
    return response({ ok: true, item })
  }
  if (/^\/v1\/runs\/[^/]+\/feedback$/.test(path)) {
    const body = JSON.parse(init.body), runId = path.split('/')[3]
    const run = state.tables.run_history.find(r => r.id === runId)
    if (!run) return response({ detail: 'Run not found' }, 404)
    Object.assign(run, { rating_value: body.rating, feedback_text: body.comment })
    const shared = body.rating === -1 || !!body.comment || body.share_run
    if (shared) state.feedback.push({ id: `fb-${state.feedback.length + 1}`, app_id: run.app_id, run_id: runId, rating: body.rating, comment: body.comment,
      shared_input: body.share_run ? run.input : null, shared_output: body.share_run ? run.output : null, status: 'new', created_at: new Date().toISOString() })
    return response({ ok: true, shared_with_developer: shared })
  }
  // Monitor: server aggregates. scenario=monitor gives app-1 traffic, a
  // failing release and alerts; otherwise apps have no runs yet.
  if (path === '/v1/monitor' || /^\/v1\/apps\/[^/]+\/monitor$/.test(path)) {
    const days = Number(url.searchParams.get('days') || 7)
    if (path === '/v1/monitor') {
      const ids = (url.searchParams.get('app_ids') || '').split(',').filter(Boolean)
      return response({ days, telemetry_health: state.telemetryHealth, summary: monitorFor(ids.includes('app-1') ? 'app-1' : '', days), apps: ids.filter(i => state.tables.apps.some(a => a.id === i)).map(i => ({ app_id: i, live_version: state.tables.apps.find(a => a.id === i)?.live_version, ...monitorFor(i, days),
        open_feedback: (state.feedback || []).filter(f => f.app_id === i && ['new', 'investigating'].includes(f.status)).length })) })
    }
    const health = monitorFor(path.split('/')[3], days)
    if (state.analytics === 'basic') {
      // Free developers: totals and errors only (same as the server's basic_analytics).
      const hidden = ['latency_p50_ms', 'latency_p95_ms', 'cost_usd', 'cost_per_run_usd', 'cost_recorded_runs', 'latency_recorded_runs']
      return response({ app_id: path.split('/')[3], live_version: 2, telemetry_health: state.telemetryHealth, ...health, analytics: 'basic',
        totals: Object.fromEntries(Object.entries(health.totals).map(([k, v]) => [k, hidden.includes(k) ? null : v])),
        daily: health.daily.map(d => ({ ...d, cost_usd: null })), by_version: [], alerts: [] })
    }
    return response({ app_id: path.split('/')[3], live_version: 2, telemetry_health: state.telemetryHealth, ...health })
  }
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
      has_changes: JSON.stringify(current?.prod_snapshot) !== JSON.stringify(snapshot(current)), has_live_version: !!current?.prod_snapshot,
      review: ['pending', 'rejected'].includes(current?.status) ? current.status : 'none', review_notes: current?.status === 'rejected' ? current.review_notes : null })
  }
  if (path.endsWith('/promote')) {
    if (!status(id).all_passed) return response({ error: 'Tests required', test_problems: ['Run tests.'] }, 409)
    const version = (current.live_version || 0) + 1
    if (state.reviewFirstPublish && !current.publish_approved_at) {
      // Same contract as the server: the first release waits for staff.
      current.prod_snapshot = snapshot(current)
      Object.assign(current, { live_version: version, is_published: false, status: 'pending', has_draft_changes: false })
      state.tables.app_versions.push({ app_id: id, version_num: version, version_data: copy(current.prod_snapshot), created_at: new Date().toISOString(), changelog: `Release ${version}` })
      return response({ ok: true, pending_review: true, is_published: false, version,
        message: "Submitted for review. An app's first release is checked by the Aistrix team; it goes live as soon as it's approved, and later releases go live straight away." })
    }
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
    const expected = url.searchParams.get('expected_live')
    if (expected != null && Number(expected) !== current.live_version) {
      return response({ detail: "Another release was made while you were doing this. Reload to see what's live now, then try again." }, 409)
    }
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
