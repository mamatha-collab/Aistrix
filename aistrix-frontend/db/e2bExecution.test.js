import { beforeAll, afterAll, expect, it } from 'vitest'
import { createDatabase } from './supabaseStub'
let db, source, build
const owner = '00000000-0000-4000-8000-000000007001'
const app = '00000000-0000-4000-8000-000000007003'
const hash = 'a'.repeat(64)
const image = `e2b://template:00000000-0000-4000-8000-000000000001@sha256:${hash}`
const service = fn => db.transaction(async tx => { await tx.exec('set local role service_role'); return fn(tx) })
beforeAll(async () => {
  db = await createDatabase()
  await db.query('insert into auth.users(id) values($1)', [owner])
  await db.query("insert into apps(id,name,created_by,app_type,visibility) values($1,'E2B test',$2,'code_job','private')", [app, owner])
  const manifest = { version: 1, runtime: 'python', mode: 'job', entrypoint: 'main:run', timeout_seconds: 30, memory_mb: 256, network: 'none' }
  source = (await db.query('insert into code_sources(app_id,user_id,source_hash,files,manifest) values($1,$2,$3,$4,$5) returning id', [app, owner, hash, { 'main.py': 'def run(p): return p' }, manifest])).rows[0].id
  await db.exec("insert into code_workers(id,kind,executor) values('managed-build','build','e2b'),('managed-run','run','e2b'),('dedicated','build','dedicated')")
}, 180000)
afterAll(async () => { await db?.close() })
const enqueue = (kind, cap, preview = null) => service(tx => tx.query('select * from enqueue_e2b_task($1,$2,$3,$4,$5,null,$6,$7)', [app, owner, kind, kind === 'build' ? source : null, {}, preview, cap]))
it('reserves runtime atomically and routes work only to the matching executor', async () => {
  await expect(enqueue('build', 89)).rejects.toThrow(/allowance reached/)
  expect((await db.query('select * from code_tasks')).rows).toHaveLength(0)
  build = (await enqueue('build', 3600)).rows[0]
  expect(build.executor).toBe('e2b')
  expect(build.reserved_seconds).toBe(90)
  expect((await service(tx => tx.query("select * from claim_code_task('dedicated','build')"))).rows).toHaveLength(0)
  const claimed = (await service(tx => tx.query("select * from claim_code_task('managed-build','build')"))).rows[0]
  await expect(service(tx => tx.query("select finish_code_task($1,$2,'succeeded',$3,'',null,1)", [build.id, claimed.lease_token, { provider: 'e2b', image: image.slice(0, -1) + 'b' }]))).rejects.toThrow(/immutable E2B/)
  expect((await service(tx => tx.query("select finish_code_task($1,$2,'succeeded',$3,'',null,1) as ok", [build.id, claimed.lease_token, { provider: 'e2b', image }]))).rows[0].ok).toBe(true)
})
it('previews without deployment and retains cancelled reservations', async () => {
  const preview = (await enqueue('run', 150, build.id)).rows[0]
  expect(preview.reserved_seconds).toBe(60)
  expect((await db.query('select * from code_deployments')).rows).toHaveLength(0)
  await db.query("update code_tasks set status='cancelled' where id=$1", [preview.id])
  await expect(enqueue('run', 150, build.id)).rejects.toThrow(/allowance reached/)
})
it('rejects browser access to managed admission', async () => {
  await expect(db.transaction(async tx => { await tx.exec('set local role authenticated'); return tx.query('select * from enqueue_e2b_task($1,$2,$3)', [app, owner, 'build']) })).rejects.toThrow(/permission denied/)
})
