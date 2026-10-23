import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDatabase } from './supabaseStub'

const owner = '00000000-0000-0000-0000-000000001001'
const customer = '00000000-0000-0000-0000-000000001002'
const editor = '00000000-0000-0000-0000-000000001003'
const app = '00000000-0000-0000-0000-000000001004'
const event = '00000000-0000-0000-0000-000000001005'
let db
beforeAll(async () => {
  db = await createDatabase()
  for (const id of [owner, customer, editor]) await db.query('insert into auth.users(id) values($1)', [id])
  await db.query("insert into apps(id,name,created_by,system_prompt) values($1,'Operations fixture',$2,'Prompt')", [app, owner])
  await db.query("insert into app_members(app_id,user_id,role) values($1,$2,'editor')", [app, editor])
  await db.query(`insert into run_history(user_id,app_id,app_name,input,output)
    select $1,$2,'Operations fixture','Consent-controlled input','Response' from generate_series(1,6005)`, [customer, app])
  await db.query(`insert into app_feedback(app_id,run_id,rating,status)
    select $1,id,-1,'new' from run_history where app_id=$1`, [app])
}, 60_000)
afterAll(async () => { await db?.close() })

describe('Monitor and Eval database readiness', () => {
  it('all required schema, triggers, RLS and delivery uniqueness exist', async () => {
    const result = await db.transaction(async tx => {
      await tx.exec('set local role service_role')
      return tx.query('select operations_schema_status() result')
    })
    expect(Object.values(result.rows[0].result).every(value => value === true)).toBe(true)
    expect(Object.keys(result.rows[0].result).length).toBeGreaterThanOrEqual(7)
  })
  it('feedback counts are exact beyond the API cap and previous 5000-row sample', async () => {
    const result = await db.transaction(async tx => {
      await tx.exec('set local role service_role')
      return tx.query('select app_feedback_counts($1) result', [app])
    })
    expect(result.rows[0].result).toEqual({ new: 6005 })
  })
  it.each([owner, editor, customer])('browser users cannot directly read telemetry or feedback (%s)', async id => {
    for (const table of ['app_runs', 'app_feedback']) {
      await expect(asUser(db, id, tx => tx.query(`select * from ${table}`))).rejects.toThrow(/permission denied/)
    }
    await expect(asUser(db, id, tx => tx.query('select app_feedback_counts($1)', [app]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, id, tx => tx.query('select operations_schema_status()'))).rejects.toThrow(/permission denied/)
  })
  it('anonymous users cannot read the private tables or privileged functions', async () => {
    for (const sql of ['select * from app_runs', 'select * from app_feedback', 'select operations_schema_status()']) {
      await expect(db.transaction(async tx => { await tx.exec('set local role anon'); return tx.query(sql) })).rejects.toThrow(/permission denied/)
    }
  })
  it('replayed delivery inserts exactly one immutable telemetry row', async () => {
    await db.transaction(async tx => {
      await tx.exec('set local role service_role')
      for (let i = 0; i < 2; i++) await tx.query(`insert into app_runs(app_id,event_id,source,status,latency_ms)
        values($1,$2,'api','ok',$3) on conflict(event_id) do nothing`, [app, event, i ? 9999 : 120])
    })
    const result = await db.query('select latency_ms from app_runs where event_id=$1', [event])
    expect(result.rows).toEqual([{ latency_ms: 120 }])
  })
  it('feedback updates touch timestamps and retain linked regression integrity', async () => {
    const testCase = await db.query("insert into app_test_cases(app_id,user_id,name) values($1,$2,'Linked case') returning id", [app, owner])
    await db.query("update app_feedback set test_case_id=$2,updated_at='2000-01-01' where id=(select id from app_feedback where app_id=$1 limit 1)", [app, testCase.rows[0].id])
    const result = await db.query('select updated_at from app_feedback where test_case_id=$1', [testCase.rows[0].id])
    expect(new Date(result.rows[0].updated_at).getFullYear()).toBeGreaterThan(2000)
  })
  it('revoked editors lose access to linked test evidence', async () => {
    await asUser(db, editor, tx => tx.query("insert into app_test_cases(app_id,user_id,name) values($1,$2,'Editor authored case')", [app, editor]))
    const before = await asUser(db, editor, tx => tx.query('select id from app_test_cases where app_id=$1', [app]))
    expect(before.rows).toHaveLength(2)
    await db.query('delete from app_members where app_id=$1 and user_id=$2', [app, editor])
    const after = await asUser(db, editor, tx => tx.query('select id from app_test_cases where app_id=$1', [app]))
    expect(after.rows).toHaveLength(0)
  })
})
