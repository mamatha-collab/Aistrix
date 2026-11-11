import { beforeAll, afterAll, expect, it } from 'vitest'
import { createDatabase } from './supabaseStub'
let db, source
const owner = '00000000-0000-4000-8000-000000008001'
const other = '00000000-0000-4000-8000-000000008002'
const app = '00000000-0000-4000-8000-000000008003'
const manifest = { version: 1, runtime: 'python', mode: 'job', entrypoint: 'main:run', timeout_seconds: 30, memory_mb: 256, network: 'none' }
const service = fn => db.transaction(async tx => { await tx.exec('set local role service_role'); return fn(tx) })
beforeAll(async () => {
  db = await createDatabase()
  await db.query('insert into auth.users(id) values($1),($2)', [owner, other])
  await db.query("insert into apps(id,name,created_by,app_type,visibility) values($1,'Studio',$2,'code_job','private')", [app, owner])
}, 180000)
afterAll(async () => { await db?.close() })
it('initializes and fences drafts, keeps history, and rejects another owner', async () => {
  const save = (revision, hash, user = owner) => service(tx => tx.query('select * from save_code_studio_draft($1,$2,$3,$4,$5,$6)', [app, user, revision, hash.repeat(64), { 'main.py': 'def run(p): return p' }, manifest]))
  source = (await save(0, 'a')).rows[0]
  expect(Number(source.revision)).toBe(1)
  expect((await db.query('select studio_contract from code_sources where id=$1', [source.source_id])).rows[0].studio_contract).toBe(true)
  expect(Number((await save(1, 'a')).rows[0].revision)).toBe(1)
  const next = (await save(1, 'b')).rows[0]
  expect(Number(next.revision)).toBe(2)
  await expect(save(1, 'c')).rejects.toThrow(/Draft revision changed/)
  await expect(save(2, 'c', other)).rejects.toThrow(/Code app not found/)
  expect((await db.query('select * from code_studio_revisions')).rows).toHaveLength(2)
})
it('previews a successful build without creating or replacing a deployment', async () => {
  await db.exec("insert into code_workers(id,kind) values('run','run')")
  const image = `registry.invalid/code/${app}@sha256:${'a'.repeat(64)}`
  const build = (await db.query("insert into code_tasks(app_id,user_id,source_id,kind,status,result) values($1,$2,$3,'build','succeeded',$4) returning *", [app, owner, source.source_id, { image }])).rows[0]
  const preview = (await service(tx => tx.query('select * from enqueue_code_preview($1,$2,$3,$4)', [app, owner, build.id, { amount: 100 }]))).rows[0]
  expect(preview.source_id).toBe(source.source_id)
  expect(preview.image).toBe(image)
  expect((await db.query('select * from code_deployments')).rows).toHaveLength(0)
  await expect(service(tx => tx.query('select * from enqueue_code_preview($1,$2,$3,$4)', [app, other, build.id, {}]))).rejects.toThrow(/Code app not found/)
  await expect(service(tx => tx.query('select * from enqueue_code_preview($1,$2,$3,$4)', [app, owner, preview.id, {}]))).rejects.toThrow(/successful build/)
})
it('browser roles cannot access Studio source, revision RPCs, or previews', async () => {
  for (const role of ['anon', 'authenticated']) for (const sql of ['select * from code_studio_drafts', 'select * from code_studio_revisions', `select * from enqueue_code_preview('${app}','${owner}','${app}','{}')`, `select * from save_code_studio_draft('${app}','${owner}',0,'${'a'.repeat(64)}','{}','{}')`]) {
    await expect(db.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(sql) })).rejects.toThrow(/permission denied/)
  }
})
