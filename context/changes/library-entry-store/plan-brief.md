# Library-entry store — Plan Brief

> Full plan: `context/changes/library-entry-store/plan.md`

## What & Why

Build roadmap foundation **F-01**: a single user-isolated `library_entries` Postgres table with Row Level Security, plus a shared TypeScript entry type. It is not user-facing — it exists to unlock every downstream slice (S-01…S-07) and to de-risk the two NFRs it owns: per-user isolation and persistence.

## Starting Point

Auth and the Supabase cookie-SSR client are already live (`src/lib/supabase.ts`, `src/middleware.ts`), so `auth.uid()` is usable for RLS. But the data layer is empty: no `src/types.ts`, no `src/db/`, and `supabase/migrations/` doesn't exist yet. This is the project's first migration.

## Desired End State

A `library_entries` table exists with RLS enabled and four granular per-operation policies; a user can only touch their own rows and entries survive a DB restart (both verified in SQL). `src/types.ts` exports an ergonomic `LibraryEntry` entity + Insert/Update DTOs + `PlayStatus`/`MetadataStatus` unions, backed by generated `src/db/database.types.ts`, and the Supabase client is `Database`-typed.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Play status storage | `text` + CHECK (slugs) | Easiest to evolve; DB-enforced; type-gen friendly | Plan |
| Status values | `not_played`(default)/`playing_now`/`played`/`completed`/`completed_100` + label map | Explicit `not_played` default removes nullable ambiguity; stable code-safe slugs, labels in `PLAY_STATUS_LABELS` | Plan |
| Forward columns included | no-match flag, `igdb_id`, `play_time_hours` | Named in unlock chain; avoids near-term follow-up migrations | Plan |
| Two date fields | `created_at` (date-added, informational) + `date_bought` (purchase) | User clarification: recommender "newly bought" reads actual purchase date | Plan |
| Type source of truth | Hand-written `src/types.ts` over generated `database.types.ts` | Roadmap names a `src/types.ts` type; gen types keep it honest to schema | Plan |
| RLS shape | 4 per-operation policies, `to authenticated` | CLAUDE.md mandates granular per-operation, per-role policies | Plan |
| Verification | SQL-level against local Supabase | Tests RLS/persistence where they live; no throwaway app code | Plan |

## Scope

**In scope:** one `library_entries` table + constraints + `user_id` index; RLS + 4 policies; SQL isolation/persistence verification; generated DB types; `src/types.ts` domain types; `Database`-typed client; `db:types` + `typecheck` scripts.

**Out of scope:** API routes, services, UI; enrichment logic; search/filter indexes; `updated_at`; seed data; production migration apply.

## Architecture / Approach

Phase 1 lands the schema + RLS as the first migration and proves isolation + persistence directly in SQL (no app surface exists to test through). Phase 2 turns the schema into typed code: generate row types, author ergonomic domain types, and thread the `Database` generic into the existing client so downstream slices inherit typed queries.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & RLS migration | First migration: table, constraints, index, RLS + 4 policies; SQL-verified isolation/persistence | RLS correctness — missing `WITH CHECK` on INSERT/UPDATE would break isolation |
| 2. Types & typed client | Generated DB types, `src/types.ts` domain types, `Database`-typed client, npm scripts | Generated/hand types drifting from schema if not regenerated after migrations |

**Prerequisites:** local Supabase (Docker) running for migration apply + type generation. Auth/DB already wired per Baseline.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- **`date_bought` diverges from PRD FR-018**, which defined "newly bought" as date-*added* recency. This plan makes `date_bought` the signal and demotes date-added to informational — S-07 must read `date_bought`. Confirm during S-07 planning.
- **`not_played` is a 5th status beyond the PRD's literal four** (FR-013 lists Playing now / Played / Completed / 100% completed). Added as the explicit default to represent the PRD's implied "cleared/unplayed" state and to serve as the recommender's unplayed-candidate signal.
- Type generation requires local Supabase up; generated types must be regenerated after future migrations or they drift.
- Production application of the migration is deferred to a later, deliberate step.

## Success Criteria (Summary)

- A user can only see/insert/update/delete their own rows; `anon` gets nothing — proven in SQL.
- A created entry survives a DB restart.
- `npm run db:types`, `npm run typecheck`, and `npm run lint` all pass; `src/types.ts` exposes the shared `LibraryEntry` type.
