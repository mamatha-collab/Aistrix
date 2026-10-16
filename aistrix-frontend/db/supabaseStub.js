// A real Postgres (PGlite) with Supabase's migrations applied, for testing
// the database's access rules (RLS, triggers, functions) without Docker or a
// hosted project. Only the pieces of Supabase the migrations rely on are
// stubbed: roles, auth.users/auth.uid()/auth.jwt(), storage, vault.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'

const here = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = path.resolve(here, '../../supabase/migrations')

const PRELUDE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create role supabase_storage_admin nologin;
create role dashboard_user nologin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema extensions;
create schema vault;
create schema auth;
create table auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now()
);
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(auth.jwt() ->> 'role', 'anon') $$;
create function auth.email() returns text language sql stable as
  $$ select auth.jwt() ->> 'email' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated, service_role;
`

// Extensions PGlite doesn't have (vault, pg_stat_statements) are stubbed above.
function adapt(sql) {
  return sql
    .replace(/create extension if not exists supabase_vault[^;]*;/gi, '')
    .replace(/create extension if not exists pg_stat_statements[^;]*;/gi, '')
}

export async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto, uuid_ossp } })
  await db.exec(PRELUDE)
  for (const file of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(adapt(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')))
    } catch (e) {
      throw new Error(`${file}: ${e.message}`)
    }
  }
  return db
}

// Run fn as a signed-in user (RLS applies), like a browser request with that JWT.
export async function asUser(db, userId, fn) {
  return db.transaction(async tx => {
    await tx.exec(`set local role authenticated`)
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
    return fn(tx)
  })
}
