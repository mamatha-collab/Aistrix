import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { asUser, createDatabase } from './supabaseStub'

let db, source
const owner = '00000000-0000-0000-0000-000000009001'
const other = '00000000-0000-0000-0000-000000009002'
const app = '00000000-0000-0000-0000-000000009003'
const wrong = '00000000-0000-0000-0000-000000009004'
const digest = `registry.example.com/code/${app}@sha256:${'a'.repeat(64)}`
const manifest = { version: 1, runtime: 'python', mode: 'job', entrypoint: 'main:run', timeout_seconds: 30, memory_mb: 256, network: 'none' }
const service = fn => db.transaction(async tx => { await tx.exec('set local role service_role'); return fn(tx) })
const enqueue = (kind = 'build', user = owner, input = {}) => service(tx => tx.query('select * from enqueue_code_task($1,$2,$3,$4,$5)', [app,user,kind,source.id,input]))
const claim = (kind = 'build', worker = kind) => service(tx => tx.query('select * from claim_code_task($1,$2)', [worker,kind]))
const finish = (job, token = job.lease_token, status = 'succeeded') => service(tx => tx.query('select finish_code_task($1,$2,$3,$4,$5,$6,$7) ok', [job.id,token,status,{ image: digest },'built',null,123]))
const deploy = (build, expected = null) => service(tx => tx.query('select * from deploy_code_build($1,$2,$3,$4)', [app,owner,build,expected]))

beforeAll(async () => {
  db = await createDatabase()
  await db.query('insert into auth.users(id) values($1),($2)', [owner,other])
  await db.query("insert into apps(id,name,created_by,app_type,visibility) values($1,'Code fixture',$2,'code_job','private')", [app,owner])
}, 180000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec('delete from code_deployments; delete from code_tasks; delete from code_sources; delete from code_workers')
  source = (await service(tx => tx.query('select * from save_code_source($1,$2,$3,$4,$5)', [app,owner,'a'.repeat(64),{ 'main.py':'def run(payload): return payload' },manifest]))).rows[0]
  await db.exec("insert into code_workers(id,kind) values('build','build'),('run','run')")
})

it('code source, payloads, deployments and worker RPCs are unavailable to browser roles', async () => {
  await expect(db.query('update apps set is_published=true where id=$1',[app])).rejects.toThrow(/private jobs/)
  await expect(db.query("update apps set visibility='public' where id=$1",[app])).rejects.toThrow(/private jobs/)
  for (const role of ['anon','authenticated']) {
    for (const sql of ['select * from code_sources','select * from code_tasks','select * from code_workers','select * from code_deployments',
      `select * from claim_code_task('build','build')`, `select heartbeat_code_task('${app}','${wrong}')`,
      'select recover_code_tasks()',
      `select * from enqueue_code_task('${app}','${owner}','build','${source.id}','{}')`,
      `select * from deploy_code_build('${app}','${owner}','${wrong}')`,
      `select * from save_code_source('${app}','${owner}','${'b'.repeat(64)}','{}','{}')`]) {
      await expect(db.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(sql) })).rejects.toThrow(/permission denied/)
    }
  }
  await expect(asUser(db, other, tx => tx.query('select * from code_tasks'))).rejects.toThrow(/permission denied/)
})

it('deduplicates immutable sources and enforces source storage quotas', async () => {
  const repeated = await service(tx => tx.query('select * from save_code_source($1,$2,$3,$4,$5)', [app,owner,'a'.repeat(64),source.files,manifest]))
  expect(repeated.rows[0].id).toBe(source.id)
  await expect(service(tx => tx.query('select * from save_code_source($1,$2,$3,$4,$5)', [app,other,'b'.repeat(64),source.files,manifest]))).rejects.toThrow(/not found/)
  for (let i=1; i<20; i++) await db.query('insert into code_sources(app_id,user_id,source_hash,files,manifest) values($1,$2,$3,$4,$5)', [app,owner,i.toString(16).padStart(64,'0'),source.files,manifest])
  await expect(service(tx => tx.query('select * from save_code_source($1,$2,$3,$4,$5)', [app,owner,'b'.repeat(64),source.files,manifest]))).rejects.toThrow(/quota/)
})

it('allows normal authenticated private app creation with the public return columns', async () => {
  const result = await asUser(db,owner,tx => tx.query("insert into apps(name,created_by,app_type,visibility) values('Authenticated code creation',$1,'code_job','private') returning id,app_type,visibility",[owner]))
  expect(result.rows[0].app_type).toBe('code_job')
  await db.query('delete from apps where id=$1',[result.rows[0].id])
})

it('requires an owner and a recently healthy matching worker', async () => {
  await expect(enqueue('build', other)).rejects.toThrow(/not found/)
  await db.exec("update code_workers set seen_at=now()-interval '100 seconds' where kind='build'")
  await expect(enqueue()).rejects.toThrow(/healthy worker/)
  await expect(claim()).rejects.toThrow(/not healthy/)
})

it('atomically enforces active and daily quotas across queued and completed work', async () => {
  await enqueue(); await enqueue()
  await expect(enqueue()).rejects.toThrow(/Two jobs/)
  await db.exec("update code_tasks set status='failed'")
  for (let i=0;i<3;i++) { await enqueue(); await db.exec("update code_tasks set status='cancelled'") }
  await expect(enqueue()).rejects.toThrow(/Daily code job quota/)
})

it('claims once, fences stale completions and refuses unsupported final states', async () => {
  await enqueue()
  const job = (await claim()).rows[0]
  expect((await claim()).rows).toHaveLength(0)
  expect((await finish(job, wrong)).rows[0].ok).toBe(false)
  expect((await service(tx => tx.query('select update_code_task_logs($1,$2,$3) ok',[job.id,wrong,'wrong owner']))).rows[0].ok).toBe(false)
  expect((await service(tx => tx.query('select update_code_task_logs($1,$2,$3) ok',[job.id,job.lease_token,'Compiling']))).rows[0].ok).toBe(true)
  await expect(finish(job, job.lease_token, 'queued')).rejects.toThrow(/Invalid completion/)
  expect((await finish(job)).rows[0].ok).toBe(true)
  expect((await finish(job)).rows[0].ok).toBe(false)
})

it('never replays an expired run and rejects late heartbeats and success reports', async () => {
  await enqueue()
  const job = (await claim()).rows[0]
  await db.query("update code_tasks set lease_expires_at=now()-interval '1 second' where id=$1", [job.id])
  expect((await service(tx => tx.query('select heartbeat_code_task($1,$2) alive', [job.id,job.lease_token]))).rows[0].alive).toBe(false)
  expect((await finish(job)).rows[0].ok).toBe(false)
  expect((await service(tx => tx.query('select recover_code_tasks($1) count',[app]))).rows[0].count).toBe(1)
  expect((await claim()).rows).toHaveLength(0)
  expect((await db.query('select status from code_tasks where id=$1', [job.id])).rows[0].status).toBe('interrupted')
})

it('rejects a mutable image and uses compare-and-swap deployment and immutable run snapshots', async () => {
  await enqueue()
  const first = (await claim()).rows[0]
  await expect(service(tx => tx.query("select finish_code_task($1,$2,'succeeded',$3,'',null,0)", [first.id,first.lease_token,{ image:'registry.example.com/latest' }]))).rejects.toThrow(/immutable/)
  await finish(first)
  await deploy(first.id)
  await expect(deploy(first.id)).rejects.toThrow(/changed/)
  await expect(service(tx => tx.query("select * from enqueue_code_task($1,$2,'run',null,'{}',$3)",[app,owner,wrong]))).rejects.toThrow(/changed/)
  const run = (await enqueue('run')).rows[0]
  expect(run.image).toBe(digest)
  expect(run.source_id).toBe(source.id)
  await expect(deploy(run.id, first.id)).rejects.toThrow(/successful build/)
  const second = (await enqueue()).rows[0]
  const secondClaim = (await claim()).rows[0]
  await finish(secondClaim)
  await deploy(second.id, first.id)
  expect((await db.query('select image from code_tasks where id=$1', [run.id])).rows[0].image).toBe(digest)
  await deploy(first.id, second.id) // rollback is the same guarded deployment operation
})

it('cancellation fences an active worker and an undeployed app cannot run', async () => {
  await expect(enqueue('run')).rejects.toThrow(/Deploy a successful build/)
  await enqueue()
  const job = (await claim()).rows[0]
  await expect(db.query('delete from apps where id=$1',[app])).rejects.toThrow(/active code jobs/)
  await db.query("update code_tasks set status='cancelled',lease_token=null where id=$1", [job.id])
  expect((await finish(job)).rows[0].ok).toBe(false)
})
