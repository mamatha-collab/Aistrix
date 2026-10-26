-- Developer tier limits, revised: Free 5 drafts / 3 published, Verified 10
-- drafts / 6 published (tests and analytics unchanged).
update public.developer_limits set draft_apps = 5, published_apps = 3 where tier = 'free';
update public.developer_limits set draft_apps = 10, published_apps = 6 where tier = 'verified';
