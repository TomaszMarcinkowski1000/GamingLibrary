# Library-entry store — Implementation Plan

## Overview

Establish the foundational, user-isolated persistence layer for Gaming Library: a single `library_entries` Postgres table with per-user Row Level Security, plus a shared, schema-backed TypeScript entry type. This is roadmap foundation **F-01**. It is **not user-facing** — no API routes, no UI — and exists solely to unlock every downstream slice (S-01…S-07), which all read or write the library, and to de-risk the two NFRs this foundation owns: per-user isolation and persistence.

## Current State Analysis

- **Auth + Supabase SSR client are live.** `src/lib/supabase.ts:5` builds a cookie-based `createServerClient`; `src/middleware.ts:6` resolves `context.locals.user` (typed in `src/env.d.ts:3` as `User | null`). `auth.uid()` is therefore available inside Postgres for RLS predicates.
- **The data layer is empty.** No `src/types.ts`, no `src/db/`, and `supabase/migrations/` does not yet exist (only `config.toml`, `snippets/`, `.branches/`, `.temp/` under `supabase/`). This will be the project's first migration.
- **The `supabase` CLI is available** as a devDependency (`supabase@^2.23.4` in `package.json`), but there is no type-generation script and no generated DB types file.
- **Conventions are fixed** (CLAUDE.md): migrations named `YYYYMMDDHHmmss_short_description.sql`; **RLS mandatory with granular per-operation, per-role policies**; shared types in `src/types.ts`; `@/*` path alias maps to `./src/*`.
- **No `typecheck` script exists** yet; `@astrojs/check` is installed, so `astro check` is the type-check command.

## Desired End State

After this plan:

1. A `library_entries` table exists in Supabase with RLS enabled and four granular per-operation policies scoped to the `authenticated` role on `auth.uid() = user_id`. A user can only ever see/insert/update/delete their own rows; the `anon` role has no access.
2. Entries survive a database restart (persistence NFR), verified at the SQL level against local Supabase.
3. `src/db/database.types.ts` is generated from the schema, and `src/types.ts` exports an ergonomic `LibraryEntry` entity, Insert/Update DTOs, and the `PlayStatus` / `MetadataStatus` unions with label maps.
4. `createClient` is parameterized with the `Database` generic so downstream slices get typed queries for free.
5. `npm run typecheck` and `npm run lint` pass.

**Verification of end state:** the SQL isolation/persistence checks in Phase 1 pass; `npm run db:types` regenerates without diff drift; `npm run typecheck` and `npm run lint` are green.

### Key Discoveries:

- RLS predicate `auth.uid() = user_id` is the standard Supabase isolation pattern and is directly enabled by the existing cookie-auth client (`src/lib/supabase.ts:9`).
- Project rule (CLAUDE.md) **requires** per-operation, per-role policies — so a single `FOR ALL` policy is not acceptable; emit one policy each for SELECT/INSERT/UPDATE/DELETE.
- `supabase migration new <name>` auto-generates the `YYYYMMDDHHmmss_` prefix, satisfying the naming convention without manual timestamping.

## What We're NOT Doing

- No API routes, services (`src/lib/services/`), or UI — those belong to S-01 and later.
- No enrichment logic (F-02 / S-01 own writing `metadata_status`, `igdb_id`, and the IGDB fields).
- No title-search or filter indexes beyond `user_id` — added by S-05/S-06 when those queries exist.
- No `updated_at` column/trigger — deferred until the edit slice (S-02) needs it.
- No seed data and no production deploy of the migration in this change (apply locally; production apply rides with the first consuming slice or a deliberate deploy step).

## Implementation Approach

Two phases. Phase 1 lands the schema + RLS as the first migration and proves the two foundation NFRs (isolation, persistence) directly in SQL, since there is no app surface to test through yet. Phase 2 turns the schema into typed code: generate row types, hand-author the ergonomic domain types the roadmap calls for in `src/types.ts`, and thread the `Database` generic into the existing client so every downstream slice inherits typed queries.

## Critical Implementation Details

- **RLS correctness is the load-bearing risk.** Enable RLS *and* emit all four per-operation policies `TO authenticated`. INSERT needs `WITH CHECK (auth.uid() = user_id)`; UPDATE needs both `USING` and `WITH CHECK`; SELECT/DELETE need `USING`. Omitting `WITH CHECK` on INSERT/UPDATE would let a user write rows owned by someone else — the exact isolation failure this foundation exists to prevent.
- **Play status is stored as code-friendly slugs**, not the PRD display labels: `not_played` / `playing_now` / `played` / `completed` / `completed_100`. The column is `not null default 'not_played'`. The display labels ("Not played", "Playing now", "100% completed", …) live in a `PLAY_STATUS_LABELS` map in `src/types.ts`. This keeps DB values stable and code-safe while preserving the PRD's user-facing wording.
- **`not_played` is an explicit value + the default**, rather than a nullable "unset" column. This collapses "no status" and "never played" into one truthful state, makes every new entry (manual or photo auto-save) start honest, and gives the recommender a first-class "unplayed candidate" signal (US-03). FR-013's "clear status" maps to setting `not_played`. This adds a 5th value beyond the PRD's literal four — the PRD's implied "cleared" state made explicit. (Noted in Open Risks.)
- The distinct meanings: `playing_now` = actively in progress; `played` = played but inactive and unfinished (drives the recommender's "comfort"/previously-played bias); these are deliberately separate per FR-013.
- **Two distinct dates, per user clarification:** `created_at` (system timestamp) is the *date-added-to-library* — informational only. `date_bought` (nullable `date`) is the user's actual purchase date and is the signal the recommender's "newly bought" mode must read. This **diverges from PRD FR-018**, which defined "newly bought" as date-added recency; S-07 must read `date_bought`, not `created_at`. (Flagged in Open Risks.)

## Phase 1: Schema & RLS migration

### Overview

Create the first migration defining `library_entries` with constraints, a `user_id` index, RLS enabled, and four granular policies; apply it to local Supabase and verify cross-user isolation + persistence in SQL.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_create_library_entries.sql` (create via `supabase migration new create_library_entries` to get the timestamp prefix)

**Intent**: Define the single library-entry table, its value constraints, the per-user index, and the complete RLS policy set. This is the persistent, user-isolated store every slice builds on.

**Contract**: Table `public.library_entries` with columns:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `user_id` | `uuid` | `not null`, `references auth.users(id) on delete cascade` |
| `title` | `text` | `not null` |
| `platform` | `text` | `not null` |
| `play_status` | `text` | `not null default 'not_played'`; `check (play_status in ('not_played','playing_now','played','completed','completed_100'))` |
| `play_time_hours` | `integer` | nullable; `check (play_time_hours >= 0)` (FR-014) |
| `date_bought` | `date` | nullable; purchase date — recommender "newly bought" signal |
| `genre` | `text` | nullable (IGDB) |
| `length_hours` | `numeric` | nullable (IGDB overall length, hours) |
| `release_year` | `integer` | nullable (IGDB) |
| `developer` | `text` | nullable (IGDB) |
| `release_date` | `date` | nullable (IGDB) |
| `igdb_id` | `bigint` | nullable; IGDB external id for future re-enrichment |
| `metadata_status` | `text` | nullable; `check (metadata_status in ('matched','no_match'))`; null = not yet enriched |
| `created_at` | `timestamptz` | `not null default now()`; date-added (informational) |

Plus: `create index on public.library_entries (user_id);`, `alter table ... enable row level security;`, and four policies `to authenticated`:

```sql
create policy "Users select own entries" on public.library_entries
  for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own entries" on public.library_entries
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own entries" on public.library_entries
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own entries" on public.library_entries
  for delete to authenticated using (auth.uid() = user_id);
```

No policy is granted to `anon`, so unauthenticated access is denied by default.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly to local Supabase: `npx supabase db reset` (or `npx supabase migration up`)
- Table and policies exist: query `pg_policies` shows 4 policies on `library_entries`; `\d library_entries` shows all columns + constraints

#### Manual Verification:

- Cross-user isolation: as user A (a real `auth.users` row via the local Auth), insert a row; as user B, a `select * from library_entries` returns zero of A's rows
- INSERT guard: user B cannot insert a row with `user_id = A` (RLS `with check` rejects it)
- Persistence: after `supabase stop` / `supabase start` (or a container restart), A's row is still present
- `anon` role (no JWT) gets zero rows on select

**Implementation Note**: After Phase 1 automated checks pass, pause for manual confirmation that the SQL isolation/persistence checks succeeded before starting Phase 2.

---

## Phase 2: Shared types & DB-typed client

### Overview

Generate row-level DB types, author the ergonomic domain types in `src/types.ts`, add the generation + typecheck scripts, and thread the `Database` generic into the existing Supabase client.

### Changes Required:

#### 1. Type-generation + typecheck scripts

**File**: `package.json`

**Intent**: Make schema-accurate type generation and type checking one-command operations.

**Contract**: Add scripts `"db:types": "supabase gen types typescript --local > src/db/database.types.ts"` and `"typecheck": "astro check"`.

#### 2. Generated DB types

**File**: `src/db/database.types.ts`

**Intent**: Schema-derived row/insert/update types that stay honest to the migration; the source of truth the domain types reference.

**Contract**: Output of `npm run db:types` (requires local Supabase running). Committed as-is; regenerated after any future migration.

#### 3. Shared domain types

**File**: `src/types.ts`

**Intent**: The ergonomic, roadmap-named shared entry type plus status unions and label maps that UI/service code consumes, derived from the generated row types so they can't silently drift.

**Contract**:
- `LibraryEntry` = `Database["public"]["Tables"]["library_entries"]["Row"]`; `LibraryEntryInsert` / `LibraryEntryUpdate` from the matching `Insert` / `Update` types.
- `PLAY_STATUSES` const tuple `['not_played','playing_now','played','completed','completed_100']`; `PlayStatus = (typeof PLAY_STATUSES)[number]`; `PLAY_STATUS_LABELS: Record<PlayStatus, string>` mapping to the display labels ("Not played", "Playing now", "Played", "Completed", "100% completed").
- `METADATA_STATUSES` const tuple `['matched','no_match']`; `MetadataStatus = (typeof METADATA_STATUSES)[number]`.

#### 4. DB-typed Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Give downstream slices typed queries with zero extra effort by parameterizing the client with the schema.

**Contract**: Change `createServerClient(...)` to `createServerClient<Database>(...)`, importing `Database` from `@/db/database.types`. No behavioral change.

### Success Criteria:

#### Automated Verification:

- Types generate without error: `npm run db:types` (local Supabase up)
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- A throwaway `supabase.from("library_entries").select()` in a scratch context shows typed columns in the editor (autocomplete reflects the schema), then is discarded
- `src/types.ts` exports `LibraryEntry`, `PlayStatus`, `PLAY_STATUS_LABELS`, `MetadataStatus` and they resolve to the migration's shape

**Implementation Note**: After Phase 2 automated checks pass, pause for manual confirmation before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- None in this foundation (no business logic yet). Type correctness is enforced by `astro check`.

### Integration Tests:

- Deferred to S-01, which exercises create→read through the real client and is the first true integration of RLS via the app surface.

### Manual Testing Steps:

1. `npx supabase start` then `npx supabase db reset` — confirm migration applies.
2. Create two test users via local Auth; insert a row as each.
3. As user A's JWT, `select * from library_entries` — see only A's rows.
4. Attempt an insert with a foreign `user_id` as A — expect RLS rejection.
5. Restart the DB container; re-select — rows persist.
6. `npm run db:types && npm run typecheck && npm run lint` — all green.

## Performance Considerations

Target scale is small (single collector, 50+ entries). The `user_id` index covers every per-user query the foundation needs. No further indexing until search/filter slices (S-05/S-06) introduce those query shapes.

## Migration Notes

- This is the first migration; applying locally is non-destructive. `on delete cascade` on `user_id` means deleting an `auth.users` row removes its entries — acceptable for a single-tenant model.
- Production application of the migration is intentionally out of scope here; it rides with the first consuming slice or a deliberate deploy step.

## References

- Roadmap foundation: `context/foundation/roadmap.md` (F-01)
- PRD NFRs (isolation, persistence) + FR-008/FR-013/FR-014/FR-018: `context/foundation/prd.md`
- Existing auth client (RLS enabler): `src/lib/supabase.ts:5`, `src/middleware.ts:6`
- Conventions: `CLAUDE.md` (migrations, RLS, types)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & RLS migration

#### Automated

- [x] 1.1 Migration applies cleanly to local Supabase (`supabase db reset` / `migration up`) — 2699a9a
- [x] 1.2 Table + 4 policies exist (`pg_policies` shows 4; `\d library_entries` shows columns + constraints) — 2699a9a

#### Manual

- [x] 1.3 Cross-user isolation: user B sees zero of user A's rows — 2699a9a
- [x] 1.4 INSERT guard: user B cannot insert a row owned by user A — 2699a9a
- [x] 1.5 Persistence: A's row survives a DB restart — 2699a9a
- [x] 1.6 `anon` role gets zero rows on select — 2699a9a

### Phase 2: Shared types & DB-typed client

#### Automated

- [x] 2.1 Types generate without error (`npm run db:types`)
- [x] 2.2 Type checking passes (`npm run typecheck`)
- [x] 2.3 Linting passes (`npm run lint`)

#### Manual

- [x] 2.4 Typed `from("library_entries")` query shows schema-accurate autocomplete (scratch check, then discarded)
- [x] 2.5 `src/types.ts` exports `LibraryEntry`, `PlayStatus`, `PLAY_STATUS_LABELS`, `MetadataStatus` resolving to the migration shape
