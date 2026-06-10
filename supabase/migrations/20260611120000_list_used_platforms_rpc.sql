-- Migration: list_used_platforms RPC (F1 perf fix for manual-add-and-browse / S-01)
-- Pushes the distinct-platforms computation down to Postgres so the combobox-options
-- query no longer selects every row of the user's library and dedupes in JS on each
-- page load. SECURITY INVOKER (the default) means the caller's RLS still applies, so
-- the function only ever sees the calling user's rows; the explicit user_id predicate
-- lets the per-user index (F-01) serve the scan.
--
-- Returns distinct, non-empty, trimmed platform values deduped case-insensitively.
-- Within each case-folded group the value that sorts first wins, making the result
-- deterministic; rows are ordered alphabetically.

create or replace function public.list_used_platforms()
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (lower(trim(platform))) trim(platform)
  from public.library_entries
  where user_id = (select auth.uid())
    and trim(platform) <> ''
  order by lower(trim(platform)), trim(platform);
$$;

-- Tighten execution to the authenticated role only (anon has no library access).
revoke all on function public.list_used_platforms() from public;
grant execute on function public.list_used_platforms() to authenticated;
