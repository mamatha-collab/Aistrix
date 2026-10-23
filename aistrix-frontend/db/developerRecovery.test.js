import { afterAll, beforeAll, expect, it } from 'vitest'
import { createDatabase } from './supabaseStub'

let db
const user = '00000000-0000-0000-0000-000000004001'
const flow = '00000000-0000-0000-0000-000000004002'
const token = '00000000-0000-0000-0000-000000004003'
const wrong = '00000000-0000-0000-0000-000000004004'
const service = fn => db.transaction(async tx => { await tx.exec('set local role service_role'); return fn(tx) })
beforeAll(async () => {
  db = await createDatabase()
  await db.query('insert into auth.users(id) values($1)', [user])
  await db.query("insert into flows(id,user_id,name) values($1,$2,'Recovery')", [flow, user])
}, 60_000)
afterAll(async () => { await db?.close() })

it('only the live owner can renew a workflow; expired runs fail without replaying steps', async () => {
  const id = (await db.query(`insert into flow_runs(flow_id,user_id,trigger,lease_token,lease_expires_at,steps)
    values($1,$2,'interactive',$3,now()+interval '60 seconds','[{"status":"ok","output":"sent"}]') returning id`, [flow, user, token])).rows[0].id
  const beat = t => service(tx => tx.query('select heartbeat_flow_run($1,$2) alive', [id, t]))
  expect((await beat(wrong)).rows[0].alive).toBe(false)
  expect((await beat(token)).rows[0].alive).toBe(true)
  await db.query("update flow_runs set lease_expires_at=now()-interval '1 second' where id=$1", [id])
  expect((await beat(token)).rows[0].alive).toBe(false)
  expect((await service(tx => tx.query('select recover_interrupted_flow_runs() count'))).rows[0].count).toBe(1)
  expect((await service(tx => tx.query('select recover_interrupted_flow_runs() count'))).rows[0].count).toBe(0)
  const row = (await db.query('select * from flow_runs where id=$1', [id])).rows[0]
  expect(row.status).toBe('failed')
  expect(row.lease_token).toBeNull()
  expect(row.steps[0].output).toBe('sent')
  expect(row.error).toMatch(/external action may have completed/)
})

it('approval waits survive sweeps; cancelled and finished runs cannot renew', async () => {
  for (const status of ['waiting_approval', 'cancelled', 'done']) {
    const id = (await db.query(`insert into flow_runs(flow_id,user_id,trigger,status,lease_token,lease_expires_at)
      values($1,$2,'schedule',$3,$4,now()-interval '1 hour') returning id`, [flow, user, status, token])).rows[0].id
    expect((await service(tx => tx.query('select heartbeat_flow_run($1,$2) alive', [id, token]))).rows[0].alive).toBe(false)
    await service(tx => tx.query('select recover_interrupted_flow_runs()'))
    expect((await db.query('select status from flow_runs where id=$1', [id])).rows[0].status).toBe(status)
  }
})

it('notification claims exclude competitors and reclaim abandoned sends with a new token', async () => {
  const id = (await db.query(`insert into developer_notifications(user_id,kind,ref,status,payload)
    values($1,'refund','retry','pending','{"subject":"Refund"}') returning id`, [user])).rows[0].id
  const claim = () => service(tx => tx.query('select * from claim_developer_notifications($1)', [id]))
  const first = (await claim()).rows[0]
  expect(first.attempts).toBe(1)
  expect((await claim()).rows).toHaveLength(0)
  await db.query("update developer_notifications set lease_expires_at=now()-interval '1 second' where id=$1", [id])
  const retry = (await claim()).rows[0]
  expect(retry.attempts).toBe(2)
  expect(retry.lease_token).not.toBe(first.lease_token)
  const stale = await db.query("update developer_notifications set status='sent' where id=$1 and lease_token=$2 returning id", [id, first.lease_token])
  expect(stale.rows).toHaveLength(0)
  await db.query("update developer_notifications set status='pending',next_attempt_at=now()+interval '1 hour' where id=$1", [id])
  expect((await claim()).rows).toHaveLength(0)
  await db.query("update developer_notifications set status='sent' where id=$1", [id])
  expect((await claim()).rows).toHaveLength(0)
})

it('browser roles cannot read job payloads or invoke recovery/claims', async () => {
  const schema = (await service(tx => tx.query('select developer_jobs_schema_status() checks'))).rows[0].checks
  expect(Object.values(schema).every(v => v === true)).toBe(true)
  for (const role of ['anon', 'authenticated']) {
    for (const sql of ['select * from developer_notifications', 'select * from flow_runs',
      'select recover_interrupted_flow_runs()', 'select * from claim_developer_notifications()',
      'select developer_jobs_schema_status()',
      `select heartbeat_flow_run('${flow}','${token}')`]) {
      await expect(db.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(sql) })).rejects.toThrow(/permission denied/)
    }
  }
})
