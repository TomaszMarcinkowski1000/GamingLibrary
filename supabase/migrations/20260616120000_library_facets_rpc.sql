-- Migration: library_facets RPC (S-06 filter-and-sort-library)
-- One RLS-scoped round trip that returns, for the calling user's library, the distinct
-- owned platforms / genres / series and the present play statuses — each with a match
-- count — so the filter dropdowns only ever offer values that can actually match and can
-- show per-value counts. SECURITY INVOKER (mirroring list_used_platforms) keeps the
-- caller's RLS in force, and the explicit user_id predicate lets the per-user index serve
-- the scans. Counts are computed over the whole library, independent of any active filter.
--
-- Returns a single jsonb object with four keys: platforms, genres, series, statuses. Each
-- value is an array of { "value": text, "count": int }. Platform counts group by
-- trim(platform); genre/series unnest the text[] column (drop null/blank elements) before
-- distinct/count; statuses group by play_status. platforms/genres/series are ordered by
-- value (statuses are returned in any order — the page zero-fills and orders them). Empty
-- facets degrade to [] rather than null so the caller never has to null-check.

create or replace function public.library_facets()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object('value', value, 'count', cnt) order by value)
      from (
        select trim(platform) as value, count(*)::int as cnt
        from public.library_entries
        where user_id = (select auth.uid())
          and platform is not null
          and trim(platform) <> ''
        group by trim(platform)
      ) p
    ), '[]'::jsonb),
    'genres', coalesce((
      select jsonb_agg(jsonb_build_object('value', value, 'count', cnt) order by value)
      from (
        select g as value, count(*)::int as cnt
        from public.library_entries e
        cross join lateral unnest(e.genre) as g
        where e.user_id = (select auth.uid())
          and g is not null
          and trim(g) <> ''
        group by g
      ) gq
    ), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('value', value, 'count', cnt) order by value)
      from (
        select s as value, count(*)::int as cnt
        from public.library_entries e
        cross join lateral unnest(e.series) as s
        where e.user_id = (select auth.uid())
          and s is not null
          and trim(s) <> ''
        group by s
      ) sq
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(jsonb_build_object('value', value, 'count', cnt))
      from (
        select play_status as value, count(*)::int as cnt
        from public.library_entries
        where user_id = (select auth.uid())
        group by play_status
      ) st
    ), '[]'::jsonb)
  );
$$;

-- Tighten execution to the authenticated role only (anon has no library access).
revoke all on function public.library_facets() from public;
grant execute on function public.library_facets() to authenticated;
