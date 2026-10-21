-- Shared sliding-hour visitor limits. Only backend service-role calls may
-- consume a bucket; keys are HMACs, never raw visitor IP addresses.
create table if not exists public.visitor_rate_buckets (
  bucket text primary key check (length(bucket) = 64),
  hits timestamptz[] not null default '{}',
  touched_at timestamptz not null default now()
);
alter table public.visitor_rate_buckets enable row level security;
revoke all on public.visitor_rate_buckets from public, anon, authenticated;
create index if not exists visitor_rate_buckets_touched_idx on public.visitor_rate_buckets(touched_at);

create or replace function public.consume_visitor_limit(p_bucket text, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  current_hits timestamptz[];
  moment timestamptz;
begin
  if length(p_bucket) <> 64 or p_limit < 1 or p_limit > 100000 then
    raise exception 'Invalid visitor limit parameters' using errcode = '22023';
  end if;
  -- Bounded cleanup; skip buckets another request currently owns.
  delete from public.visitor_rate_buckets where bucket in (
    select bucket from public.visitor_rate_buckets
    where touched_at < clock_timestamp() - interval '2 hours'
    order by touched_at limit 100 for update skip locked
  );
  insert into public.visitor_rate_buckets(bucket) values(p_bucket) on conflict do nothing;
  select hits into current_hits from public.visitor_rate_buckets where bucket=p_bucket for update;
  moment := clock_timestamp();
  select coalesce(array_agg(t), '{}') into current_hits
    from unnest(current_hits) t where t > moment - interval '1 hour';
  if cardinality(current_hits) >= p_limit then
    return false;
  end if;
  update public.visitor_rate_buckets set hits=array_append(current_hits,moment), touched_at=moment where bucket=p_bucket;
  return true;
end $$;
revoke all on function public.consume_visitor_limit(text,integer) from public, anon, authenticated;
grant execute on function public.consume_visitor_limit(text,integer) to service_role;
