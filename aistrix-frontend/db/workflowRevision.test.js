import { afterAll, beforeAll, expect, it } from 'vitest'
import { createDatabase } from './supabaseStub'

let db
const user = '00000000-0000-0000-0000-000000005001'
beforeAll(async () => {
  db = await createDatabase()
  await db.query('insert into auth.users(id) values($1)', [user])
}, 60_000)
afterAll(async () => { await db?.close() })

const make = async name => (await db.query(
  `insert into flows(user_id, name, kind, steps) values($1, $2, 'developer', '[]') returning id, revision`, [user, name])).rows[0]
const revisionOf = async id => (await db.query('select revision from flows where id = $1', [id])).rows[0].revision

it('starts every workflow at revision 1', async () => {
  expect((await make('Fresh')).revision).toBe(1)
})

it('moves the revision only when what the editor saves changes', async () => {
  const { id } = await make('Edits')
  await db.query(`update flows set steps = '[{"id":"s1"}]' where id = $1`, [id])
  expect(await revisionOf(id)).toBe(2)
  await db.query(`update flows set name = 'Renamed' where id = $1`, [id])
  expect(await revisionOf(id)).toBe(3)
  await db.query(`update flows set "trigger" = '{"type":"manual","fields":[{"field":"x"}]}' where id = $1`, [id])
  expect(await revisionOf(id)).toBe(4)
})

it('ignores changes the editor does not save: webhook, memory, description', async () => {
  const { id } = await make('Bookkeeping')
  await db.query(`update flows set webhook_token = gen_random_uuid(), memory = '{"a":1}', description = 'Notes' where id = $1`, [id])
  expect(await revisionOf(id)).toBe(1)
  await db.query(`update flows set steps = steps, name = name where id = $1`, [id])
  expect(await revisionOf(id)).toBe(1)
})

it('a client cannot set the revision itself', async () => {
  const { id } = await make('Locked')
  await db.query('update flows set revision = 99 where id = $1', [id])
  expect(await revisionOf(id)).toBe(1)
})

it('a save made against an old revision matches no row, so it changes nothing', async () => {
  const { id } = await make('Race')
  await db.query(`update flows set name = 'First editor' where id = $1 and revision = 1`, [id])
  const second = await db.query(`update flows set name = 'Second editor' where id = $1 and revision = 1 returning id`, [id])
  expect(second.rows).toHaveLength(0)
  expect((await db.query('select name, revision from flows where id = $1', [id])).rows[0]).toEqual({ name: 'First editor', revision: 2 })
})
