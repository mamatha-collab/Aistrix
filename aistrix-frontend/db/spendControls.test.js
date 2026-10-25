import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

const KEY = '00000000-0000-4000-8000-0000000000a1'
const OTHER_KEY = '00000000-0000-4000-8000-0000000000a2'
const WORKSPACE = '00000000-0000-4000-8000-0000000000b1'
const APP = '00000000-0000-4000-8000-0000000000c1'
let db
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

async function reserve(amount, { key = KEY, workspace = WORKSPACE, payer = 'own', platformLimit = null, rid = id() } = {}) {
  const { rows } = await db.query('select public.reserve_spend($1,$2,$3,$4,$5,$6,$7,$8) as r',
    [rid, key, workspace, payer, APP, 'claude-haiku-5-5', amount, platformLimit])
  return { rid, ...rows[0].r }
}
const settle = async (rid, actual, outcome) => (await db.query('select public.settle_spend($1,$2,$3) as ok', [rid, actual, outcome])).rows[0].ok

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table public.flows(id uuid primary key default gen_random_uuid(), name text, steps jsonb default '[]');
    insert into public.flows(name) values ('existing');`)
  const sql = readFileSync(new URL('../../supabase/migrations/20261025010000_spend_controls_privacy.sql', import.meta.url), 'utf8')
  await db.exec(sql)
  await db.exec(sql)   // safe to apply twice
}, 60_000)
afterAll(async () => { await db?.close() })

it('keeps existing workflows standard and accepts only known privacy modes', async () => {
  expect((await db.query("select privacy from public.flows where name='existing'")).rows[0].privacy).toBe('standard')
  await db.exec("insert into public.flows(name, privacy) values ('private', 'private_only')")
  await expect(db.exec("insert into public.flows(name, privacy) values ('odd', 'secretish')")).rejects.toThrow()
})

it('records runs without limits until a cap is set', async () => {
  const r = await reserve(5)
  expect(r.ok).toBe(true)
  expect(await settle(r.rid, 4.5, 'settled')).toBe(true)
  expect(await settle(r.rid, 9, 'settled')).toBe(false)   // settles once
})

it('refuses a reservation that would pass a key cap, counting open and uncertain runs', async () => {
  await db.exec(`insert into public.spend_caps(scope, scope_id, period, limit_usd) values ('key', '${KEY}', 'month', 10)`)
  // 4.5 settled so far
  const open = await reserve(3)
  expect(open.ok).toBe(true)                       // 7.5 held
  const tooMuch = await reserve(3)
  expect(tooMuch).toMatchObject({ ok: false, code: 'cap_reached', scope: 'key' })
  expect(Number(tooMuch.used_usd)).toBeCloseTo(7.5)
  await settle(open.rid, 1, 'settled')             // real cost was lower: 5.5 used
  expect((await reserve(3)).ok).toBe(true)         // 8.5
  const uncertain = await reserve(1)               // 9.5
  await settle(uncertain.rid, null, 'uncertain')
  expect((await reserve(1)).ok).toBe(false)        // uncertain stays counted
  const released = await reserve(0.4)              // 9.9
  await settle(released.rid, null, 'released')     // never ran: frees its hold
  expect((await reserve(0.5)).ok).toBe(true)       // 10.0, exactly at the cap
})

it('applies caps per key owner and never to the platform payer', async () => {
  expect((await reserve(50, { key: OTHER_KEY, workspace: null })).ok).toBe(true)
  expect((await reserve(50, { payer: 'platform', workspace: null })).ok).toBe(true)
})

it('refuses unknown prices only where a cap applies', async () => {
  expect(await reserve(null)).toMatchObject({ ok: false, code: 'unknown_price', scope: 'key' })
  expect((await reserve(null, { key: OTHER_KEY, workspace: null })).ok).toBe(true)
})

it('enforces workspace caps across different key owners', async () => {
  const ws = '00000000-0000-4000-8000-0000000000b2'
  await db.exec(`insert into public.spend_caps(scope, scope_id, period, limit_usd) values ('workspace', '${ws}', 'day', 2)`)
  expect((await reserve(1.5, { key: OTHER_KEY, workspace: ws })).ok).toBe(true)
  expect(await reserve(1, { key: '00000000-0000-4000-8000-0000000000a3', workspace: ws }))
    .toMatchObject({ ok: false, code: 'cap_reached', scope: 'workspace', period: 'day' })
})

it('applies the platform cap passed by the server to platform-paid runs only', async () => {
  const platformUsed = 50
  expect(await reserve(1, { payer: 'platform', key: null, workspace: null, platformLimit: platformUsed + 0.5 }))
    .toMatchObject({ ok: false, code: 'cap_reached', scope: 'platform' })
  expect((await reserve(0.5, { payer: 'platform', key: null, workspace: null, platformLimit: platformUsed + 0.5 })).ok).toBe(true)
})

it('treats a repeated reservation id as the same reservation', async () => {
  const rid = id()
  expect((await reserve(1, { key: OTHER_KEY, workspace: null, rid })).ok).toBe(true)
  expect(await reserve(1, { key: OTHER_KEY, workspace: null, rid })).toMatchObject({ ok: true, repeat: true })
  expect((await db.query('select count(*)::int as c from public.spend_reservations where id = $1', [rid])).rows[0].c).toBe(1)
})

it('marks abandoned reservations uncertain instead of free', async () => {
  const r = await reserve(0.25, { key: OTHER_KEY, workspace: null })
  await db.query("update public.spend_reservations set expires_at = now() - interval '1 minute' where id = $1", [r.rid])
  expect((await db.query('select public.expire_spend_reservations() as n')).rows[0].n).toBeGreaterThanOrEqual(1)
  expect((await db.query('select status from public.spend_reservations where id = $1', [r.rid])).rows[0].status).toBe('uncertain')
  await expect(db.query("select public.settle_spend($1, 1, 'bogus')", [id()])).rejects.toThrow()
})

it('keeps spending data and functions server-only', async () => {
  expect((await db.query('select public.spend_controls_status() as s')).rows[0].s).toEqual({ ready: true })
  await db.exec('set role authenticated')
  try {
    await expect(db.query('select * from public.spend_reservations')).rejects.toThrow()
    await expect(db.query('select * from public.spend_caps')).rejects.toThrow()
    await expect(db.query("select public.reserve_spend(gen_random_uuid(), null, null, 'platform', null, null, 1)")).rejects.toThrow()
  } finally { await db.exec('reset role') }
})
