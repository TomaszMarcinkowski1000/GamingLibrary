-- Migration: enrich library_entries metadata (F-02 IGDB metadata enrichment)
-- Amends F-01's public.library_entries so IGDB's multi-valued metadata fields are
-- preserved as arrays instead of flattened to scalars, and adds the new `series` field.
-- F-02 amends F-01's schema by design (see context/changes/igdb-metadata-enrichment/change.md).
--
-- genre   text -> text[]  (IGDB returns multiple genres)
-- developer text -> text[] (co-developed titles have multiple studios with developer=true)
-- series  (new) text[]    (IGDB games.collections[].name — a game may belong to several)
--
-- The `using` clauses wrap any existing non-null scalar into a single-element array so the
-- conversion is safe even though the MVP table is empty. release_year / release_date /
-- length_hours / igdb_id / metadata_status are unchanged. RLS and policies are untouched —
-- column-type changes do not affect row policies.

alter table public.library_entries
  alter column genre type text[] using (case when genre is null then null else array[genre] end),
  alter column developer type text[] using (case when developer is null then null else array[developer] end),
  add column series text[];
