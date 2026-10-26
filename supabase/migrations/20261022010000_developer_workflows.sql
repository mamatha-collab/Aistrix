-- Developer workflows (Dev Studio → Workflows) live in public.flows next to
-- Business flows, so they share the engine, webhook links and schedules.
--   kind     'developer' = built in Dev Studio (field wiring, versions per
--            step); Business lists keep showing only their own flows.
--   trigger  how a run starts and the fields it brings:
--            {"type": "manual" | "webhook", "fields": [{"field", "type", "required"}]}
alter table public.flows add column if not exists kind text not null default 'business';
do $$ begin
  alter table public.flows add constraint flows_kind_check check (kind in ('business', 'developer'));
exception when duplicate_object then null; end $$;
alter table public.flows add column if not exists trigger jsonb not null default '{"type": "manual", "fields": []}'::jsonb;
create index if not exists flows_user_kind on public.flows (user_id, kind);
