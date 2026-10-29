-- OPTIONAL / IRREVERSIBLE: only run if company policy truly requires deletion
-- after 30 days. Otherwise keep historical records in the database while
-- the website shows only the latest 30 days. Requires Supabase pg_cron.
-- 17:00 UTC = 01:00 next day in Singapore.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'icph_hcs_delete_archives_older_than_30_days',
  '0 17 * * *',
  $$delete from public.hcs_cycles where cut_end < now() - interval '30 days'$$
);
