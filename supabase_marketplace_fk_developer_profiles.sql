-- Add FK from marketplace_listings.user_id to developer_profiles.user_id
-- so PostgREST can resolve the join in:
--   marketplace_listings?select=*,developer_profiles(display_name)

alter table marketplace_listings
  add constraint marketplace_listings_user_id_fkey
  foreign key (user_id) references developer_profiles(user_id)
  on delete set null;
