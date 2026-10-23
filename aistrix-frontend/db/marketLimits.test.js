import { afterAll, beforeAll, expect, it } from 'vitest'
import { asUser, createDatabase } from './supabaseStub'
let db
const owner='00000000-0000-0000-0000-000000003001', editor='00000000-0000-0000-0000-000000003002', app='00000000-0000-0000-0000-000000003003'
const service = fn => db.transaction(async tx => { await tx.exec('set local role service_role'); return fn(tx) })
beforeAll(async () => {
  db=await createDatabase()
  for (const id of [owner, editor]) await db.query('insert into auth.users(id) values($1)',[id])
  await db.query("insert into apps(id,name,created_by,system_prompt,is_published,live_version,total_runs) values($1,'Market app',$2,'Prompt',true,1,5)",[app,owner])
  await db.query("insert into app_members(app_id,user_id,role) values($1,$2,'editor')",[app,editor])
  await db.query("insert into marketplace_listings(app_id,user_id,title,tagline,category,status) values($1,$2,'Market app','Helpful answers','Productivity','draft')",[app,editor])
},60_000)
afterAll(async()=>{ await db?.close() })
it('shared sliding-window limit is exact across repeated callers and isolated by bucket',async()=>{
  const results=await Promise.all(Array.from({length:30},()=>service(tx=>tx.query('select consume_visitor_limit($1,7) allowed',['a'.repeat(64)]))))
  expect(results.filter(r=>r.rows[0].allowed)).toHaveLength(7)
  expect((await service(tx=>tx.query('select consume_visitor_limit($1,7) allowed',['b'.repeat(64)]))).rows[0].allowed).toBe(true)
  await db.query("update visitor_rate_buckets set hits=array_fill(now()-interval '61 minutes',array[7]) where bucket=$1",['a'.repeat(64)])
  expect((await service(tx=>tx.query('select consume_visitor_limit($1,7) allowed',['a'.repeat(64)]))).rows[0].allowed).toBe(true)
  expect((await db.query('select cardinality(hits) count from visitor_rate_buckets where bucket=$1',['a'.repeat(64)])).rows[0].count).toBe(1)
})
it('visitor keys expire and browser roles cannot read or consume buckets',async()=>{
  await db.query("insert into visitor_rate_buckets(bucket,touched_at) values($1,now()-interval '3 hours')",['c'.repeat(64)])
  await service(tx=>tx.query('select consume_visitor_limit($1,7)',['b'.repeat(64)]))
  expect((await db.query('select bucket from visitor_rate_buckets where bucket=$1',['c'.repeat(64)])).rows).toHaveLength(0)
  for(const role of ['anon','authenticated']) for(const sql of ["select * from visitor_rate_buckets",`select consume_visitor_limit('${'d'.repeat(64)}',7)`]) {
    await expect(db.transaction(async tx=>{await tx.exec(`set local role ${role}`);return tx.query(sql)})).rejects.toThrow(/permission denied/)
  }
})
it('listing transition validates a current release, rejects stale revisions and preserves direct access on unlist',async()=>{
  const change=async(live,revision)=>service(tx=>tx.query('select set_market_listing_status($1,$2,$3) listing',[app,live,revision]))
  let row=(await db.query('select * from marketplace_listings where app_id=$1',[app])).rows[0]
  const oldRevision=row.updated_at
  row=(await change(true,oldRevision)).rows[0].listing
  expect(row.status).toBe('live')
  await expect(change(false,'2000-01-01')).rejects.toThrow(/Listing changed/)
  row=(await change(false,row.updated_at)).rows[0].listing
  expect(row.status).toBe('draft')
  expect((await db.query('select is_published from apps where id=$1',[app])).rows[0].is_published).toBe(true)
  await db.query('update apps set is_published=false where id=$1',[app])
  await expect(change(true,row.updated_at)).rejects.toThrow(/Publish the app/)
  for(const role of ['anon','authenticated']) await expect(db.transaction(async tx=>{await tx.exec(`set local role ${role}`);return tx.query('select set_market_listing_status($1,true,null)',[app])})).rejects.toThrow(/permission denied/)
})
it('revoked listing creators cannot retain draft access',async()=>{
  expect((await asUser(db,editor,tx=>tx.query('select id from marketplace_listings where app_id=$1',[app]))).rows).toHaveLength(1)
  await db.query('delete from app_members where app_id=$1 and user_id=$2',[app,editor])
  expect((await asUser(db,editor,tx=>tx.query('select id from marketplace_listings where app_id=$1',[app]))).rows).toHaveLength(0)
})
