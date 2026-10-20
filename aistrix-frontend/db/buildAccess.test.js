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

  it('GitHub tokens are server-only: not even their owner can read them from the browser', async () => {
    await db.query(`insert into developer_github (user_id, token_encrypted, login, repo) values ($1, 'gAAAA-cipher', 'octo', 'acme/app')`, [U.owner])
    for (const who of ['owner', 'developer']) {
      const read = await as(who, `select token_encrypted from developer_github`)
      expect(read.error).not.toBeNull()
      const write = await as(who, `insert into developer_github (user_id, token_encrypted) values ($1, 'x')`, [U[who]])
      expect(write.error).not.toBeNull()
    }
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

describe('release gate and revenue records', () => {
  it('editing a saved test stamps when it changed, so old passes stop counting', async () => {
    const made = await as('developer', `insert into app_test_cases (app_id, user_id, name, input) values ($1, $2, 'gate', 'a') returning id`, [APP, U.developer])
    const id = made.rows[0].id
    await db.query(`update app_test_cases set updated_at = '2000-01-01' where id = $1`, [id])
    await as('developer', `update app_test_cases set rules = '[{"type":"must-contain","value":"x"}]', updated_at = '1999-01-01' where id = $1`, [id])
    const { rows } = await db.query(`select updated_at > '2001-01-01' as fresh from app_test_cases where id = $1`, [id])
    expect(rows[0].fresh).toBe(true)                    // and it can't be backdated
  })

  it('a Stripe payment can only be recorded once', async () => {
    const row = `insert into purchases (app_id, dev_id, plan, gross_amount, stripe_payment_ref) values ($1, $2, 'pay_per_run', 25, 'pi_once')`
    await db.query(row, [APP, U.owner])
    await expect(db.query(row, [APP, U.owner])).rejects.toThrow(/duplicate key/)
  })

  it('browsers cannot write revenue; each developer reads only their own', async () => {
    const forged = await as('owner', `insert into purchases (app_id, dev_id, plan, gross_amount) values ($1, $2, 'pay_per_run', 9999)`, [APP, U.owner])
    expect(forged.error).not.toBeNull()
    expect((await as('owner', `select stripe_payment_ref from purchases`)).rows.map(r => r.stripe_payment_ref)).toContain('pi_once')
    expect((await as('developer', `select 1 from purchases`)).rows).toHaveLength(0)
  })
})

describe('Improve comparison history is for the app editors only', () => {
  const entry = who => as(who, `insert into app_comparisons (app_id, user_id, input, baseline, candidate) values ($1, $2, 'Check invoice', '{"label":"v1","prompt":"SECRET"}', '{"label":"Draft"}') returning id`, [APP, U[who]])

  it('editors save and read comparisons; viewers and outsiders cannot', async () => {
    expect((await entry('developer')).error).toBeNull()
    expect((await as('appEditor', `select input from app_comparisons where app_id = $1`, [APP])).rows.length).toBeGreaterThan(0)
    for (const who of ['member', 'appViewer', 'outsider']) {
      expect((await entry(who)).error).not.toBeNull()
      expect((await as(who, `select baseline from app_comparisons where app_id = $1`, [APP])).rows).toHaveLength(0)
    }
  })

  it("nobody can record a comparison under someone else's name", async () => {
    expect((await as('developer', `insert into app_comparisons (app_id, user_id, input, baseline, candidate) values ($1, $2, 'x', '{}', '{}')`, [APP, U.owner])).error).not.toBeNull()
  })
})

describe('Marketplace listings go live only through the server', () => {
  it('editors keep a draft listing, but cannot set it live from the browser', async () => {
    const draft = await as('developer', `insert into marketplace_listings (app_id, user_id, title) values ($1, $2, 'Pitch') returning id`, [APP, U.developer])
    expect(draft.error).toBeNull()
    expect((await as('developer', `update marketplace_listings set status = 'live' where app_id = $1`, [APP])).error?.message).toMatch(/go live from Dev Studio/)
    expect((await as('owner', `update marketplace_listings set title = 'Pitch writer' where app_id = $1 returning id`, [APP])).rows).toHaveLength(1)
  })

  it('nobody can list (or expose) an app they cannot edit', async () => {
    const other = '00000000-0000-0000-0000-00000000c0de'
    await db.query(`insert into apps (id, name, created_by, is_published, visibility) values ($1, 'Private draft', $2, false, 'private')`, [other, U.appEditor])
    expect((await as('outsider', `insert into marketplace_listings (app_id, user_id, title) values ($1, $2, 'Mine now')`, [other, U.outsider])).error).not.toBeNull()
    await db.query(`insert into marketplace_listings (app_id, user_id, title, status) values ($1, $2, 'Live but unpublished', 'live')`, [other, U.appEditor])
    expect((await as('outsider', `select name from apps where id = $1`, [other])).rows).toHaveLength(0)   // a live listing doesn't publish the app
    // …and the listing itself stays out of the Marketplace while the app is unpublished.
    expect((await as('outsider', `select title from marketplace_listings where app_id = $1`, [other])).rows).toHaveLength(0)
  })

  it('unpublishing takes a live listing out of the Marketplace; republishing brings it back', async () => {
    const app = '00000000-0000-0000-0000-00000000c0df'
    await db.query(`insert into apps (id, name, created_by, is_published, visibility) values ($1, 'Listed', $2, true, 'public')`, [app, U.owner])
    await db.query(`insert into marketplace_listings (app_id, user_id, title, status) values ($1, $2, 'Listed app', 'live')`, [app, U.owner])
    const visible = async () => (await as('outsider', `select title from marketplace_listings where app_id = $1`, [app])).rows.length
    expect(await visible()).toBe(1)
    await db.query(`update apps set is_published = false where id = $1`, [app])
    expect(await visible()).toBe(0)
    expect((await as('owner', `select title from marketplace_listings where app_id = $1`, [app])).rows).toHaveLength(1)   // its editors still see it
    await db.query(`update apps set is_published = true where id = $1`, [app])
    expect(await visible()).toBe(1)
  })

  it("every editor of the app sees its listing, whoever created it", async () => {
    expect((await as('appEditor', `select title from marketplace_listings where app_id = $1`, [APP])).rows).toHaveLength(1)
  })
})

describe('payouts are claimed before money moves', () => {
  it('only one of two concurrent claims on a purchase succeeds', async () => {
    const { rows } = await db.query(`insert into purchases (app_id, dev_id, plan, gross_amount, dev_share, stripe_payment_ref, payout_status)
                                     values ($1, $2, 'pay_per_run', 25, 20, 'pi_claim', 'pending') returning id, payout_attempts`, [APP, U.owner])
    expect(rows[0].payout_attempts).toBe(0)
    const claim = `update purchases set payout_status = 'transferring', payout_attempts = 1, payout_claimed_at = now()
                   where id = $1 and payout_status = 'pending' and payout_attempts = 0 returning id`
    expect((await db.query(claim, [rows[0].id])).rows).toHaveLength(1)
    expect((await db.query(claim, [rows[0].id])).rows).toHaveLength(0)
  })

  it('browsers cannot change payout state', async () => {
    const res = await as('owner', `update purchases set payout_status = 'transferred', payout_attempts = 0 where stripe_payment_ref = 'pi_claim' returning id`)
    expect(res.error !== null || res.rows.length === 0).toBe(true)
  })
})

describe('customer feedback and run telemetry are server-only', () => {
  it('nobody reads or writes the feedback inbox from the browser (the API checks editors and hides customers)', async () => {
    await db.query(`insert into run_history (id, user_id, app_name, input, app_id) values ('00000000-0000-0000-0000-0000000000f1', $1, 'Pitch', 'private question', $2)`, [U.outsider, APP])
    await db.query(`insert into app_feedback (app_id, run_id, rating, comment) values ($1, '00000000-0000-0000-0000-0000000000f1', -1, 'wrong')`, [APP])
    for (const who of ['owner', 'developer', 'outsider']) {
      expect((await as(who, `select comment from app_feedback`)).error).not.toBeNull()
      expect((await as(who, `update app_feedback set status = 'verified'`)).error).not.toBeNull()
    }
  })

  it('the run log keeps outcome, time, cost and version, and browsers cannot read it', async () => {
    await db.query(`insert into app_runs (app_id, source, status, error_kind, latency_ms, live_version, model, cost_usd) values ($1, 'app', 'error', 'timeout', 61000, 2, 'gpt-4o', 0.002)`, [APP])
    expect((await as('owner', `select status from app_runs`)).rows).toHaveLength(0)
  })
})

describe('pay-per-run: each purchase is one run', () => {
  const buy = (ref, runs = 1) => db.query(`select record_purchase($1::jsonb, $2) id`, [
    { app_id: APP, buyer_id: U.outsider, dev_id: U.owner, plan: 'pay_per_run', gross_amount: 2, platform_fee: 0.4, dev_share: 1.6, stripe_payment_ref: ref }, runs])
  const access = async () => (await db.query(`select id, plan, status, run_quota, runs_this_period from app_entitlements where app_id = $1 and user_id = $2`, [APP, U.outsider])).rows
  const reserve = async id => (await db.query(`select reserve_entitlement_run($1) used`, [id])).rows[0].used

  it('a purchase grants one run; the same payment reported twice grants nothing more', async () => {
    expect((await buy('pi_run_1')).rows[0].id).not.toBeNull()
    expect((await buy('pi_run_1')).rows[0].id).toBeNull()
    const [ent] = await access()
    expect(ent).toMatchObject({ plan: 'pay_per_run', status: 'active', run_quota: 1, runs_this_period: 0 })
  })

  it('the run can be used once; a failed run gives it back; buying again adds one more', async () => {
    const [ent] = await access()
    expect(await reserve(ent.id)).toBe(1)
    expect(await reserve(ent.id)).toBeNull()            // a second run at the same time gets nothing
    await db.query(`select release_entitlement_run($1)`, [ent.id])
    expect(await reserve(ent.id)).toBe(1)
    await buy('pi_run_2')
    expect((await access())[0]).toMatchObject({ run_quota: 2, runs_this_period: 1 })
    expect(await reserve(ent.id)).toBe(2)
    expect(await reserve(ent.id)).toBeNull()
  })

  it('an active subscription is never replaced by a single-run purchase', async () => {
    await db.query(`insert into app_entitlements (app_id, user_id, plan, status) values ($1, $2, 'subscription', 'active')`, [APP, U.billing])
    await db.query(`select record_purchase($1::jsonb, 1)`, [{ app_id: APP, buyer_id: U.billing, dev_id: U.owner, plan: 'pay_per_run', stripe_payment_ref: 'pi_sub_holder' }])
    const { rows } = await db.query(`select plan, run_quota from app_entitlements where app_id = $1 and user_id = $2`, [APP, U.billing])
    expect(rows).toEqual([{ plan: 'subscription', run_quota: null }])
  })

  it('a full refund takes back the run it bought only if it was not used', async () => {
    const quota = async () => (await db.query(`select run_quota, runs_this_period from app_entitlements where app_id = $1 and user_id = $2`, [APP, U.outsider])).rows[0]
    await buy('pi_refund_me')
    const before = await quota()
    expect((await db.query(`select revoke_purchased_run($1, $2) ok`, [APP, U.outsider])).rows[0].ok).toBe(true)
    expect((await quota()).run_quota).toBe(before.run_quota - 1)
    await db.query(`update app_entitlements set runs_this_period = run_quota where app_id = $1 and user_id = $2`, [APP, U.outsider])
    expect((await db.query(`select revoke_purchased_run($1, $2) ok`, [APP, U.outsider])).rows[0].ok).toBe(false)   // already used
    expect((await as('outsider', `select revoke_purchased_run('${APP}', '${U.outsider}')`)).error).not.toBeNull()
  })

  it('one access record per buyer and app', async () => {
    await expect(db.query(`insert into app_entitlements (app_id, user_id, plan) values ($1, $2, 'pay_per_run')`, [APP, U.outsider])).rejects.toThrow(/duplicate key/)
  })

  it('browsers cannot grant, reserve or give back runs', async () => {
    const [ent] = await access()
    for (const sql of [`select record_purchase('{}'::jsonb, 5)`, `select reserve_entitlement_run('${ent.id}')`, `select release_entitlement_run('${ent.id}')`]) {
      expect((await as('outsider', sql)).error).not.toBeNull()
    }
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

describe('the rest of what Build touches', () => {
  const SCRATCH = '00000000-0000-0000-0000-0000000000c9'
  beforeAll(async () => {
    await db.query(`insert into apps (id, name, created_by, workspace_id) values ($1, 'Scratch', $2, $3)`, [SCRATCH, U.owner, WS])
    await db.query(`insert into app_test_runs (app_id, user_id, draft_hash, source, case_ref, passed)
                    select $1, $2, 'h', 'suite', 'c1', true`, [APP, U.owner])
    await db.query(`insert into app_versions (app_id, user_id, version_data, version_num) values ($1, $2, '{}', 1)`, [APP, U.owner])
    await db.query(`insert into run_history (user_id, app_id, app_name, workspace_id, input, output) values ($1, $2, 'Pitch', $3, 'in', 'out')`, [U.owner, APP, WS])
  })

  it.each(['developer', 'appEditor', 'member', 'outsider'])('%s cannot delete an app they do not own', async who => {
    const r = await as(who, `delete from apps where id = $1 returning id`, [SCRATCH])
    expect(r.rows).toHaveLength(0)
  })

  it('the owner can delete their app', async () => {
    const r = await as('owner', `delete from apps where id = $1 returning id`, [SCRATCH])
    expect(r.rows).toHaveLength(1)
  })

  it.each(['owner', 'admin'])('%s (app owner or workspace admin) can add a collaborator', async who => {
    const r = await as(who, `insert into app_members (app_id, user_id, role) values ($1, $2, 'viewer') returning id`, [APP, U.billing])
    expect(r.error).toBeNull()
    await db.query(`delete from app_members where app_id = $1 and user_id = $2`, [APP, U.billing])
  })

  it.each(['developer', 'appEditor', 'member'])('%s cannot add collaborators or promote themselves', async who => {
    expect((await as(who, `insert into app_members (app_id, user_id, role) values ($1, $2, 'editor')`, [APP, U.outsider])).error).not.toBeNull()
    const promote = await as(who, `update app_members set role = 'owner' where app_id = $1 returning id`, [APP])
    expect(promote.rows).toHaveLength(0)
  })

  it.each(['member', 'appViewer', 'outsider'])('%s cannot read test results or version history', async who => {
    expect((await as(who, `select id from app_test_runs where app_id = $1`, [APP])).rows).toHaveLength(0)
    expect((await as(who, `select id from app_versions where app_id = $1`, [APP])).rows).toHaveLength(0)
  })

  it('editors can read test results and version history (so the checks above are meaningful)', async () => {
    expect((await as('owner', `select id from app_test_runs where app_id = $1`, [APP])).rows.length).toBeGreaterThan(0)
    expect((await as('developer', `select id from app_versions where app_id = $1`, [APP])).rows.length).toBeGreaterThan(0)
  })

  it('test results are recorded by the server only', async () => {
    const r = await as('owner', `insert into app_test_runs (app_id, user_id, draft_hash, source, case_ref, passed) values ($1, $2, 'h', 'suite', 'forged', true)`, [APP, U.owner])
    expect(r.error).not.toBeNull()
  })

  it("a developer cannot read the owner's run history; a workspace admin can", async () => {
    expect((await as('developer', `select id from run_history where user_id = $1`, [U.owner])).rows).toHaveLength(0)
    expect((await as('admin', `select id from run_history where user_id = $1`, [U.owner])).rows.length).toBeGreaterThan(0)
  })

  it('knowledge base: editors only', async () => {
    expect((await as('developer', `insert into app_knowledge (app_id, title, content) values ($1, 'Doc', 'x') returning id`, [APP])).error).toBeNull()
    expect((await as('member', `insert into app_knowledge (app_id, title, content) values ($1, 'Doc', 'x')`, [APP])).error).not.toBeNull()
  })

  it('app secrets are never readable from the browser, even by the owner', async () => {
    expect((await as('owner', `select * from app_secrets`)).rows).toHaveLength(0)
  })
})

describe('launch readiness', () => {
  it('deleting an app keeps its sales records for accounting', async () => {
    const app = '00000000-0000-0000-0000-00000000c0e1'
    await db.query(`insert into apps (id, name, created_by, is_published, visibility) values ($1, 'Short-lived', $2, false, 'private')`, [app, U.owner])
    await db.query(`insert into purchases (app_id, dev_id, plan, gross_amount, stripe_payment_ref) values ($1, $2, 'pay_per_run', 25, 'pi_kept')`, [app, U.owner])
    await db.query(`delete from apps where id = $1`, [app])
    const { rows } = await db.query(`select app_id, gross_amount from purchases where stripe_payment_ref = 'pi_kept'`)
    expect(rows).toHaveLength(1)
    expect(rows[0].app_id).toBeNull()
  })

  it('notification records and one-time markers are server-only', async () => {
    await db.query(`insert into developer_notifications (user_id, kind, ref) values ($1, 'refund', 'pi_1')`, [U.owner])
    await expect(db.query(`insert into developer_notifications (user_id, kind, ref) values ($1, 'refund', 'pi_1')`, [U.owner])).rejects.toThrow(/duplicate key/)
    await db.query(`insert into server_once (key) values ('github-state:abc')`)
    await expect(db.query(`insert into server_once (key) values ('github-state:abc')`)).rejects.toThrow(/duplicate key/)
    for (const table of ['developer_notifications', 'server_once']) {
      expect((await as('owner', `select * from ${table}`)).error).not.toBeNull()
      expect((await as('owner', `insert into ${table} default values`)).error).not.toBeNull()
    }
  })

  it('a developer can turn alert emails off on their own profile', async () => {
    await db.query(`insert into developer_profiles (user_id) values ($1) on conflict do nothing`, [U.developer])
    const res = await as('developer', `update developer_profiles set email_alerts = false where user_id = $1 returning email_alerts`, [U.developer])
    expect(res.error).toBeNull()
    expect(res.rows[0].email_alerts).toBe(false)
  })
})

describe('developer tiers', () => {
  const DEV = '00000000-0000-0000-0000-0000000000e1'
  beforeAll(async () => {
    await db.query(`insert into auth.users (id, email) values ($1, 'tiered@example.test') on conflict do nothing`, [DEV])
  })
  const tier = async user => (await db.query(`select developer_tier($1) t`, [user])).rows[0].t
  const claim = async user => (await db.query(`select claim_test_run($1) c`, [user])).rows[0].c

  it('everyone starts Free; only staff can make a developer Verified', async () => {
    expect(await tier(DEV)).toBe('free')
    await db.query(`insert into developer_profiles (user_id) values ($1) on conflict do nothing`, [DEV])
    const self = await asUser(db, DEV, tx => tx.query(`update developer_profiles set is_verified = true where user_id = $1 returning is_verified`, [DEV]))
    expect(self.rows[0].is_verified).toBe(false)                         // ignored: developers can't verify themselves
    expect(await tier(DEV)).toBe('free')
    expect((await as('owner', `select tier, draft_apps from developer_limits order by tier`)).rows)
      .toEqual([{ tier: 'free', draft_apps: 10 }, { tier: 'verified', draft_apps: 30 }])   // the limits are public
  })

  it('a Free developer can have 10 draft apps', async () => {
    for (let i = 0; i < 10; i++) {
      await db.query(`insert into apps (name, created_by, is_published, visibility) values ($1, $2, false, 'private')`, [`Draft ${i}`, DEV])
    }
    await expect(db.query(`insert into apps (name, created_by, is_published, visibility) values ('One too many', $1, false, 'private')`, [DEV]))
      .rejects.toThrow(/up to 10 draft apps/)
    await db.query(`update developer_profiles set is_verified = true where user_id = $1`, [DEV])     // as staff/server
    expect(await tier(DEV)).toBe('verified')
    await db.query(`insert into apps (name, created_by, is_published, visibility) values ('Verified can', $1, false, 'private')`, [DEV])
  })

  it('test runs are limited per day and at once, and a slot frees on release', async () => {
    await db.query(`update developer_profiles set is_verified = false where user_id = $1`, [DEV])
    const first = await claim(DEV)
    expect(first).toMatchObject({ ok: true, slot: 1, used: 1, limit: 20, tier: 'free' })
    expect(await claim(DEV)).toMatchObject({ ok: false, reason: 'concurrent', limit: 1 })
    await db.query(`select release_test_run($1, 1)`, [DEV])
    await db.query(`update developer_test_usage set runs = 20 where user_id = $1`, [DEV])
    expect(await claim(DEV)).toMatchObject({ ok: false, reason: 'daily', limit: 20 })
    expect((await db.query(`select count(*)::int n from developer_test_slots where user_id = $1`, [DEV])).rows[0].n).toBe(0)
    expect((await as('owner', `select * from developer_test_usage`)).error).not.toBeNull()   // server only
    expect((await as('owner', `select claim_test_run($1)`, [U.owner])).error).not.toBeNull()
  })

  it('only staff approval marks an app approved for publishing', async () => {
    const { rows } = await db.query(`insert into apps (name, created_by, is_published, visibility) values ('Review me', $1, false, 'private') returning id`, [U.owner])
    const id = rows[0].id
    const forged = await as('owner', `update apps set publish_approved_at = now() where id = $1 returning publish_approved_at`, [id])
    expect(forged.rows[0]?.publish_approved_at ?? null).toBeNull()
    await db.query(`update apps set status = 'approved', is_published = true where id = $1`, [id])         // staff approve (service/staff)
    expect((await db.query(`select publish_approved_at from apps where id = $1`, [id])).rows[0].publish_approved_at).not.toBeNull()
  })
})
