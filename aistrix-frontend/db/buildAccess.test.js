// The database's own access rules for Build, tested against real Postgres
// (PGlite) with every migration applied. Browser code writes apps, designs,
// tools and tests straight to the database, so these rules — not the API —
// decide what each teammate can change.
import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDatabase } from './supabaseStub'

const U = {
  owner: '00000000-0000-0000-0000-0000000000a1',
  admin: '00000000-0000-0000-0000-0000000000a2',
  developer: '00000000-0000-0000-0000-0000000000a3',
  member: '00000000-0000-0000-0000-0000000000a4',
  billing: '00000000-0000-0000-0000-0000000000a5',
  outsider: '00000000-0000-0000-0000-0000000000a6',
  appEditor: '00000000-0000-0000-0000-0000000000a7',
  appViewer: '00000000-0000-0000-0000-0000000000a8',
}
const WS = '00000000-0000-0000-0000-0000000000b1'
const APP = '00000000-0000-0000-0000-0000000000c1'

const CAN_BUILD = ['owner', 'admin', 'developer', 'appEditor']
const CANNOT_BUILD = ['member', 'billing', 'outsider', 'appViewer']

let db

// Runs as that user; returns { rows, error } instead of throwing.
async function as(who, sql, params = []) {
  try {
    const rows = await asUser(db, U[who], tx => tx.query(sql, params).then(r => r.rows))
    return { rows, error: null }
  } catch (error) {
    return { rows: [], error }
  }
}

beforeAll(async () => {
  db = await createDatabase()
  for (const [name, id] of Object.entries(U)) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@example.test`])
  }
  await db.query(`insert into workspaces (id, name, slug, is_personal, created_by) values ($1, 'Acme', 'acme', false, $2)`, [WS, U.owner])
  await db.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing`, [WS, U.owner])
  for (const role of ['admin', 'developer', 'member', 'billing']) {
    await db.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`, [WS, U[role], role])
  }
  await db.query(`insert into apps (id, name, created_by, workspace_id, system_prompt, is_published, visibility)
                  values ($1, 'Pitch', $2, $3, 'DRAFT PROMPT', false, 'private')`, [APP, U.owner, WS])
  await db.query(`insert into app_members (app_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`, [APP, U.appEditor, U.appViewer])
  await db.query(`insert into app_blueprints (app_id, user_id, blueprint) values ($1, $2, '{"audience":"ops"}')`, [APP, U.owner])
}, 60_000)

describe('who can change a Build app (direct writes from the browser)', () => {
  it.each(CAN_BUILD)('%s can edit the app, its design, tools and tests', async who => {
    const save = await as(who, `select update_app_fields($1, $2, '{}') r`, [APP, { description: `by ${who}` }])
    expect(save.error).toBeNull()
    expect(save.rows[0].r.ok).toBe(true)

    const bp = await as(who, `update app_blueprints set blueprint = blueprint || '{"note":"x"}' where app_id = $1 returning app_id`, [APP])
    expect(bp.rows).toHaveLength(1)

    const tool = await as(who, `insert into app_tools (app_id, name, description, type) values ($1, $2, 'd', 'http') returning id`, [APP, `t_${who}`])
    expect(tool.error).toBeNull()

    const test = await as(who, `insert into app_test_cases (app_id, user_id, name) values ($1, $2, 'case') returning id`, [APP, U[who]])
    expect(test.error).toBeNull()
  })

  it.each(CANNOT_BUILD)('%s cannot change the app, its design, tools or tests', async who => {
    const save = await as(who, `select update_app_fields($1, $2, '{}') r`, [APP, { system_prompt: 'HIJACKED' }])
    expect(save.error).not.toBeNull()

    const direct = await as(who, `update apps set system_prompt = 'HIJACKED' where id = $1 returning id`, [APP])
    expect(direct.rows).toHaveLength(0)

    const bp = await as(who, `update app_blueprints set blueprint = '{}' where app_id = $1 returning app_id`, [APP])
    expect(bp.rows).toHaveLength(0)

    const tool = await as(who, `insert into app_tools (app_id, name, description, type) values ($1, 'evil', 'd', 'http')`, [APP])
    expect(tool.error).not.toBeNull()

    const test = await as(who, `insert into app_test_cases (app_id, user_id, name) values ($1, $2, 'case')`, [APP, U[who]])
    expect(test.error).not.toBeNull()

    const { rows } = await db.query(`select system_prompt from apps where id = $1`, [APP])
    expect(rows[0].system_prompt).not.toBe('HIJACKED')
  })

  it('an outsider cannot even see a private workspace app', async () => {
    const { rows } = await as('outsider', `select id from apps where id = $1`, [APP])
    expect(rows).toHaveLength(0)
  })
})

describe('release state only changes through the server', () => {
  it.each(['owner', 'developer'])('%s cannot publish or set the live version directly', async who => {
    expect((await as(who, `update apps set is_published = true where id = $1`, [APP])).error).not.toBeNull()
    expect((await as(who, `update apps set live_version = 9 where id = $1`, [APP])).error).not.toBeNull()
    expect((await as(who, `update apps set prod_snapshot = '{}' where id = $1`, [APP])).error).not.toBeNull()
    expect((await as(who, `select update_app_fields($1, '{"is_published": true}', '{}')`, [APP])).error).not.toBeNull()
  })

  it('a published version can only be recorded by the server', async () => {
    const r = await as('owner', `insert into app_versions (app_id, user_id, version_data, version_num) values ($1, $2, '{}', 1)`, [APP, U.owner])
    expect(r.error).not.toBeNull()
  })

  it.each(['app_triggers', 'app_runs', 'app_run_days'])('%s is server-only (no browser reads or writes)', async table => {
    expect((await as('owner', `select * from ${table}`)).rows).toHaveLength(0)
    const write = table === 'app_triggers'
      ? as('owner', `insert into app_triggers (app_id, token) values ($1, 'trg_x')`, [APP])
      : table === 'app_runs'
        ? as('owner', `insert into app_runs (app_id, source) values ($1, 'app')`, [APP])
        : as('owner', `insert into app_run_days (app_id, day, runs) values ($1, current_date, 0)`, [APP])
    expect((await write).error).not.toBeNull()
  })
})

describe('saving app settings never overwrites a teammate', () => {
  it('a stale save is refused with the current value; nothing is written', async () => {
    await db.query(`update apps set tone = 'friendly' where id = $1`, [APP])
    const stale = await as('developer', `select update_app_fields($1, $2, $3) r`, [APP, { tone: 'concise' }, { tone: 'playful' }])
    expect(stale.rows[0].r).toEqual({ ok: false, conflicts: ['tone'], current: { tone: 'friendly' } })
    expect((await db.query(`select tone from apps where id = $1`, [APP])).rows[0].tone).toBe('friendly')
  })

  it('a save based on the current value goes through', async () => {
    const ok = await as('developer', `select update_app_fields($1, $2, $3) r`, [APP, { tone: 'professional' }, { tone: 'friendly' }])
    expect(ok.rows[0].r.ok).toBe(true)
    expect((await db.query(`select tone from apps where id = $1`, [APP])).rows[0].tone).toBe('professional')
  })

  it('other fields changing (e.g. run counters) do not block a save', async () => {
    await db.query(`update apps set total_runs = total_runs + 5 where id = $1`, [APP])
    const ok = await as('admin', `select update_app_fields($1, $2, $3) r`, [APP, { greeting: 'Hi' }, { greeting: null }])
    expect(ok.rows[0].r.ok).toBe(true)
  })

  it('arrays and lists compare by value', async () => {
    await db.query(`update apps set embed_allowed_domains = array['a.com','b.com'] where id = $1`, [APP])
    const ok = await as('owner', `select update_app_fields($1, $2, $3) r`, [APP,
      { embed_allowed_domains: ['c.com'] }, { embed_allowed_domains: ['a.com', 'b.com'] }])
    expect(ok.rows[0].r.ok).toBe(true)
  })
})

describe('workspace roles and personal settings', () => {
  it('a member cannot make themselves an admin', async () => {
    const r = await as('member', `update workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2 returning role`, [WS, U.member])
    expect(r.rows).toHaveLength(0)
  })

  it('an admin cannot make someone an owner', async () => {
    const r = await as('admin', `update workspace_members set role = 'owner' where workspace_id = $1 and user_id = $2`, [WS, U.developer])
    expect(r.error).not.toBeNull()
  })

  it("a developer cannot read a teammate's integration keys", async () => {
    await db.query(`insert into developer_settings (user_id, settings) values ($1, '{"github":{"token":"secret"}}')`, [U.owner])
    const r = await as('developer', `select settings from developer_settings where user_id = $1`, [U.owner])
    expect(r.rows).toHaveLength(0)
  })
})

describe('draft tracking', () => {
  it('adding a tool marks a live app as having draft changes (and does not fail)', async () => {
    await db.query(`update apps set has_draft_changes = false where id = $1`, [APP])
    const r = await as('developer', `insert into app_tools (app_id, name, description, type) values ($1, 'draft_check', 'd', 'http') returning id`, [APP])
    expect(r.error).toBeNull()
    expect((await db.query(`select has_draft_changes from apps where id = $1`, [APP])).rows[0].has_draft_changes).toBe(true)
  })

  it('moving the workflow phase alone does not mark draft changes', async () => {
    await db.query(`update apps set has_draft_changes = false where id = $1`, [APP])
    await as('owner', `update app_blueprints set blueprint = blueprint || '{"dev_phase":"test"}' where app_id = $1`, [APP])
    expect((await db.query(`select has_draft_changes from apps where id = $1`, [APP])).rows[0].has_draft_changes).toBe(false)
  })
})

describe('app prompts and private settings stay private', () => {
  const PUB = '00000000-0000-0000-0000-0000000000c2'
  beforeAll(async () => {
    await db.query(`insert into apps (id, name, created_by, workspace_id, system_prompt, webhook_url, custom_model_url, pages, is_published, visibility)
                    values ($1, 'Public app', $2, $3, 'SECRET PROMPT', 'https://hooks.example/secret', 'https://model.example', $4, false, 'public')`,
      [PUB, U.owner, WS, JSON.stringify([{ name: 'Intro', fields: [{ label: 'Topic' }], system_prompt: 'PAGE SECRET' }])])
    await db.query(`update apps set is_published = true where id = $1`, [PUB])
  })

  async function asAnon(sql, params = []) {
    try {
      const rows = await db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(sql, params)).rows })
      return { rows, error: null }
    } catch (error) { return { rows: [], error } }
  }

  it.each(['system_prompt', 'prod_snapshot', 'webhook_url', 'custom_model_url', 'pages', 'change_note', 'review_notes'])(
    'nobody can read %s of a published app directly (signed out or in)', async column => {
      expect((await asAnon(`select ${column} from apps where id = $1`, [PUB])).error?.message).toMatch(/permission denied/)
      expect((await as('outsider', `select ${column} from apps where id = $1`, [PUB])).error?.message).toMatch(/permission denied/)
      expect((await as('owner', `select ${column} from apps where id = $1`, [PUB])).error?.message).toMatch(/permission denied/)
    })

  it('everyone can still read what end users need, and page prompts are stripped', async () => {
    const { rows, error } = await asAnon(`select name, form_schema, is_paid, pages_public from apps where id = $1`, [PUB])
    expect(error).toBeNull()
    expect(rows[0].name).toBe('Public app')
    expect(rows[0].pages_public).toEqual([{ name: 'Intro', fields: [{ label: 'Topic' }] }])
  })

  it.each(['owner', 'developer', 'appEditor'])('%s (an editor) reads the private fields through app_private_fields', async who => {
    const app = who === 'appEditor' ? APP : PUB
    const { rows, error } = await as(who, `select * from app_private_fields($1)`, [[app]])
    expect(error).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0].system_prompt).toBeTruthy()
  })

  it.each(['member', 'billing', 'outsider', 'appViewer'])('%s gets nothing from app_private_fields', async who => {
    const { rows } = await as(who, `select * from app_private_fields($1)`, [[APP, PUB]])
    expect(rows).toHaveLength(0)
  })

  it('signed-out visitors cannot call the private-fields function at all', async () => {
    expect((await asAnon(`select * from app_private_fields($1)`, [[PUB]])).error).not.toBeNull()
    expect((await asAnon(`select app_row_for_editor($1)`, [PUB])).error).not.toBeNull()
  })

  it('a non-editor cannot read the row through app_row_for_editor', async () => {
    const { rows } = await as('outsider', `select app_row_for_editor($1) r`, [PUB])
    expect(rows[0].r).toBeNull()
  })

  it('editors can still save prompts and webhooks with conflict checks', async () => {
    const ok = await as('developer', `select update_app_fields($1, $2, $3) r`, [PUB, { webhook_url: 'https://hooks.example/new' }, { webhook_url: 'https://hooks.example/secret' }])
    expect(ok.error).toBeNull()
    expect(ok.rows[0].r.ok).toBe(true)
  })
})
