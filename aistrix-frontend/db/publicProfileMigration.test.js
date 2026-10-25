import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('adds optional profile fields idempotently without changing existing identity or payment data', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      create table public.developer_profiles(user_id uuid primary key, display_name text, bio text, website text, stripe_account_id text, total_earnings numeric);
      alter table public.developer_profiles enable row level security;
      grant select on public.developer_profiles to anon;
      create table public.apps(created_by uuid, is_published boolean, visibility text);
      insert into public.developer_profiles values('00000000-0000-4000-8000-000000000001','Existing developer',null,null,'account-preserved',12.50);
      insert into public.developer_profiles values('00000000-0000-4000-8000-000000000002','Hidden developer',null,null,'private-account',42.00);
      insert into public.apps values('00000000-0000-4000-8000-000000000001',true,'public'),('00000000-0000-4000-8000-000000000002',true,'private');`)
    const sql = readFileSync(new URL('../../supabase/migrations/20261024010000_developer_profile_public_fields.sql', import.meta.url), 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    const { rows } = await db.query("select * from public.developer_profiles where user_id='00000000-0000-4000-8000-000000000001'")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: '00000000-0000-4000-8000-000000000001', display_name: 'Existing developer', stripe_account_id: 'account-preserved', avatar_url: null, github: null, twitter: null })
    expect(Number(rows[0].total_earnings)).toBe(12.5)
    expect(rows[0].updated_at).toBeTruthy()
    await db.exec('set role anon')
    expect((await db.query('select * from public.developer_profiles')).rows).toEqual([])
    const publicRows = (await db.query('select * from public.public_developer_profiles')).rows
    expect(publicRows).toHaveLength(1)
    expect(publicRows[0].display_name).toBe('Existing developer')
    expect(publicRows[0]).not.toHaveProperty('stripe_account_id')
    expect(publicRows[0]).not.toHaveProperty('total_earnings')
    await expect(db.query("update public.public_developer_profiles set display_name='Unauthorized edit'")).rejects.toThrow()
    expect((await db.query('select display_name from public.public_developer_profiles')).rows[0].display_name).toBe('Existing developer')
    await expect(db.query('select stripe_account_id from public.public_developer_profiles')).rejects.toThrow()
    await db.exec('reset role')
    await db.exec("update public.apps set is_published=false where created_by='00000000-0000-4000-8000-000000000001'; set role anon")
    expect((await db.query('select * from public.public_developer_profiles')).rows).toEqual([])
  } finally { await db.close() }
}, 30_000)
