-- ════════════════════════════════════════════════════════════════════════════
-- Workspaces — STEP 1 (additive; nothing existing changes behaviour)
--
-- A workspace is the owner of apps, keys, purchases and billing. It can be
-- one person (their Personal workspace) or a team.
--
-- • workspaces / workspace_members / workspace_invites
-- • every user gets a Personal workspace (existing users backfilled, new
--   sign-ups automatically)
-- • nullable workspace_id on top-level owned resources, backfilled from the
--   current owner and auto-filled on insert, so today's code keeps working
--
-- Child records of an app (blueprints, tools, knowledge, secrets, versions,
-- test cases, files, members) intentionally get NO workspace_id: they belong
-- to their app's workspace.
--
-- Step 2 switches access rules + the app to workspace membership; step 3 makes
-- workspace_id required. Run in the Supabase SQL editor. Re-runnable.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Tables ───────────────────────────────────────────────────────────────
create table if not exists workspaces (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(trim(name)) between 1 and 80),
  slug                text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  is_personal         boolean not null default false,
  personal_owner_id   uuid unique references auth.users(id) on delete cascade,
  plan                text not null default 'free' check (plan in ('free', 'pro', 'team', 'enterprise')),
  billing_email       text,
  stripe_customer_id  text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- a personal workspace belongs to exactly one user; a team workspace to none
  constraint workspaces_personal_owner check (is_personal = (personal_owner_id is not null))
);

create table if not exists workspace_members (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'member'
                check (role in ('owner', 'admin', 'developer', 'member', 'billing')),
  invited_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on workspace_members(user_id);

create table if not exists workspace_invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  email         text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role          text not null default 'member'
                check (role in ('admin', 'developer', 'member', 'billing')),
  token         uuid not null unique default gen_random_uuid(),
  invited_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz
);
create index if not exists workspace_invites_workspace_idx on workspace_invites(workspace_id);
create unique index if not exists workspace_invites_open_email_idx
  on workspace_invites(workspace_id, lower(email)) where accepted_at is null;

-- ── 2. Helper functions (SECURITY DEFINER so RLS can use them without recursion)
create or replace function is_workspace_member(p_workspace_id uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
     where workspace_id = p_workspace_id and user_id = auth.uid()
       and (p_roles is null or role = any(p_roles))
  )
$$;

create or replace function personal_workspace_id(p_user_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from workspaces where personal_owner_id = p_user_id
$$;

-- Creates (or returns) a user's personal workspace.
create or replace function ensure_personal_workspace(p_user_id uuid, p_email text default null, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
begin
  select id into v_ws from workspaces where personal_owner_id = p_user_id;
  if v_ws is null then
    insert into workspaces (name, slug, is_personal, personal_owner_id, created_by, billing_email)
    values (
      left(coalesce(nullif(trim(p_name), ''), nullif(split_part(coalesce(p_email, ''), '@', 1), ''), 'Personal'), 80),
      'u-' || left(replace(p_user_id::text, '-', ''), 16),
      true, p_user_id, p_user_id, p_email)
    on conflict (personal_owner_id) do nothing
    returning id into v_ws;
    if v_ws is null then
      select id into v_ws from workspaces where personal_owner_id = p_user_id;
    end if;
  end if;
  insert into workspace_members (workspace_id, user_id, role)
  values (v_ws, p_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;
  return v_ws;
end $$;

-- New sign-ups get a personal workspace automatically. Never lets an error
-- here block sign-up itself; the backfill below (re-runnable) repairs gaps.
create or replace function handle_new_user_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform ensure_personal_workspace(new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  exception when others then
    raise warning 'personal workspace for % not created: %', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists on_auth_user_created_workspace on auth.users;
create trigger on_auth_user_created_workspace after insert on auth.users
  for each row execute function handle_new_user_workspace();

-- Whoever creates a team workspace becomes its owner.
create or replace function handle_new_team_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.is_personal and new.created_by is not null then
    insert into workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists workspaces_add_owner on workspaces;
create trigger workspaces_add_owner after insert on workspaces
  for each row execute function handle_new_team_workspace();

create or replace function touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists workspaces_touch on workspaces;
create trigger workspaces_touch before update on workspaces
  for each row execute function touch_updated_at();

-- Accept an invite addressed to the signed-in user's email.
create or replace function accept_workspace_invite(p_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv workspace_invites%rowtype;
begin
  select * into v_inv from workspace_invites where token = p_token for update;
  if not found then raise exception 'Invite not found'; end if;
  if v_inv.accepted_at is not null then raise exception 'Invite already used'; end if;
  if v_inv.expires_at < now() then raise exception 'Invite expired'; end if;
  if lower(v_inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite was sent to a different email address';
  end if;
  insert into workspace_members (workspace_id, user_id, role, invited_by)
  values (v_inv.workspace_id, auth.uid(), v_inv.role, v_inv.invited_by)
  on conflict (workspace_id, user_id) do nothing;
  update workspace_invites set accepted_at = now() where id = v_inv.id;
  return v_inv.workspace_id;
end $$;
revoke execute on function accept_workspace_invite(uuid) from public, anon;
grant execute on function accept_workspace_invite(uuid) to authenticated;

-- Internal helpers: not callable from the browser.
revoke execute on function ensure_personal_workspace(uuid, text, text) from public, anon, authenticated;
revoke execute on function handle_new_user_workspace() from public, anon, authenticated;
revoke execute on function handle_new_team_workspace() from public, anon, authenticated;

-- Keep at least one owner in every team workspace. Personal workspaces are
-- skipped so deleting a user account (which cascades) is never blocked by it.
create or replace function keep_a_workspace_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from workspaces w where w.id = old.workspace_id and not w.is_personal)
     and not exists (select 1 from workspace_members m
                      where m.workspace_id = old.workspace_id and m.role = 'owner' and m.user_id <> old.user_id) then
    raise exception 'A team workspace must keep at least one owner';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists workspace_members_keep_owner on workspace_members;
create trigger workspace_members_keep_owner before update or delete on workspace_members
  for each row execute function keep_a_workspace_owner();

-- ── 3. Access rules for the new tables ──────────────────────────────────────
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table workspace_invites enable row level security;

drop policy if exists workspaces_select on workspaces;
create policy workspaces_select on workspaces for select to authenticated
  using (is_workspace_member(id) or created_by = (select auth.uid()));
drop policy if exists workspaces_insert on workspaces;
create policy workspaces_insert on workspaces for insert to authenticated
  with check (not is_personal and created_by = (select auth.uid()));
drop policy if exists workspaces_update on workspaces;
create policy workspaces_update on workspaces for update to authenticated
  using (is_workspace_member(id, array['owner', 'admin']))
  with check (is_workspace_member(id, array['owner', 'admin']));
drop policy if exists workspaces_delete on workspaces;
create policy workspaces_delete on workspaces for delete to authenticated
  using (not is_personal and is_workspace_member(id, array['owner']));

-- Personal workspaces have exactly one member. In team workspaces,
-- owners/admins manage people; granting or removing "owner" is owners-only.
drop policy if exists workspace_members_select on workspace_members;
create policy workspace_members_select on workspace_members for select to authenticated
  using (is_workspace_member(workspace_id));
drop policy if exists workspace_members_insert on workspace_members;
create policy workspace_members_insert on workspace_members for insert to authenticated
  with check (
    is_workspace_member(workspace_id, array['owner', 'admin'])
    and (role <> 'owner' or is_workspace_member(workspace_id, array['owner']))
    and not exists (select 1 from workspaces w where w.id = workspace_id and w.is_personal)
  );
drop policy if exists workspace_members_update on workspace_members;
create policy workspace_members_update on workspace_members for update to authenticated
  using (is_workspace_member(workspace_id, array['owner', 'admin'])
         and not exists (select 1 from workspaces w where w.id = workspace_id and w.is_personal))
  with check (role <> 'owner' or is_workspace_member(workspace_id, array['owner']));
drop policy if exists workspace_members_delete on workspace_members;
create policy workspace_members_delete on workspace_members for delete to authenticated
  using (
    not exists (select 1 from workspaces w where w.id = workspace_id and w.is_personal)
    and (user_id = (select auth.uid())                                        -- leave a team
         or (is_workspace_member(workspace_id, array['owner', 'admin']) and role <> 'owner')
         or is_workspace_member(workspace_id, array['owner']))
  );

drop policy if exists workspace_invites_select on workspace_invites;
create policy workspace_invites_select on workspace_invites for select to authenticated
  using (is_workspace_member(workspace_id, array['owner', 'admin'])
         or lower(email) = lower((select auth.jwt() ->> 'email')));
drop policy if exists workspace_invites_insert on workspace_invites;
create policy workspace_invites_insert on workspace_invites for insert to authenticated
  with check (is_workspace_member(workspace_id, array['owner', 'admin'])
              and invited_by = (select auth.uid())
              and not exists (select 1 from workspaces w where w.id = workspace_id and w.is_personal));
drop policy if exists workspace_invites_delete on workspace_invites;
create policy workspace_invites_delete on workspace_invites for delete to authenticated
  using (is_workspace_member(workspace_id, array['owner', 'admin']));

-- ── 4. Personal workspaces for every existing user ──────────────────────────
select ensure_personal_workspace(u.id, u.email, u.raw_user_meta_data ->> 'full_name')
  from auth.users u;

-- ── 5. workspace_id on top-level owned resources ────────────────────────────
-- Fills workspace_id from the owner's personal workspace when an insert
-- doesn't set it. TG_ARGV[0] names the table's owner column.
create or replace function default_workspace_from_owner()
returns trigger language plpgsql set search_path = public as $$
declare
  v_owner uuid;
begin
  if new.workspace_id is null then
    v_owner := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;
    if v_owner is not null then
      new.workspace_id := personal_workspace_id(v_owner);
    end if;
  end if;
  return new;
end $$;

-- (table, column that identifies the owner today)
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('apps', 'created_by'),                 -- the app's owner
      ('developer_api_keys', 'user_id'),
      ('app_entitlements', 'user_id'),        -- buyer
      ('purchases', 'buyer_id'),              -- buyer
      ('developer_profiles', 'user_id'),      -- payouts
      ('user_business_profiles', 'user_id'),
      ('knowledge_vault', 'user_id'),
      ('user_data_sources', 'user_id'),
      ('flows', 'user_id'),
      ('scheduled_events', 'user_id'),
      ('batch_jobs', 'user_id'),
      ('run_history', 'user_id'),             -- user_id stays = who ran it
      ('run_events', 'user_id'),
      ('app_records', 'user_id')
    ) as v(tbl, owner_col)
  loop
    -- "set null", not cascade, for now: deleting a workspace must not delete
    -- apps or purchase records. Step 3 sets the final rule per table.
    execute format('alter table %I add column if not exists workspace_id uuid references workspaces(id) on delete set null', t.tbl);
    execute format('create index if not exists %I on %I(workspace_id)', t.tbl || '_workspace_id_idx', t.tbl);
    execute format(
      'update %I x set workspace_id = w.id from workspaces w
        where x.workspace_id is null and w.personal_owner_id = x.%I', t.tbl, t.owner_col);
    execute format('drop trigger if exists %I on %I', t.tbl || '_default_workspace', t.tbl);
    execute format(
      'create trigger %I before insert on %I for each row execute function default_workspace_from_owner(%L)',
      t.tbl || '_default_workspace', t.tbl, t.owner_col);
  end loop;
end $$;

commit;
