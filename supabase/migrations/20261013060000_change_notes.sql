-- Why a published app went back from Deploy to Test/Design: the reason and
-- note the developer gives when moving it back. Kept with the draft (shown
-- again if they move it back again) and written into the next published
-- version's history entry, then cleared. Not part of the app's behaviour, so
-- it doesn't mark draft changes.
alter table public.apps add column if not exists change_note jsonb;
